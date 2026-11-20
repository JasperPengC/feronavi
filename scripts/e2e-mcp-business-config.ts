import "./_env.ts";
/** 项目模板与工作流配置、确认门槛及角色范围的真实 HTTP MCP 验收。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, mcpClient } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as workflows from "../src/server/services/workflow-config.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const app = await buildApp({ logger: false });
const marker = randomUUID().replaceAll("-", "").slice(0, 10);
let id = 0, checks = 0;
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.error, undefined); return body.result;
}
async function call(token: string, name: string, args: object, error?: string) {
  const response = await rpc(token, "tools/call", { name, arguments: args });
  const data = JSON.parse(response.content[0].text);
  if (error) { assert.equal(response.isError, true); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(response.structuredContent, data); }
  return data;
}
const check = (name: string, ok: unknown) => { assert.ok(ok, name); checks++; console.log(`OK ${name}`); };
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: `content-${marker}`, name: "内容验收", email: `${marker}@content.test`, status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(person!.id))!;
  const inside = await projects.createProject(actor, { key: `CI${marker}`, name: "内容闭环" });
  const outside = await projects.createProject(actor, { key: `CO${marker}`, name: "范围外" });
  const rw = await tokens.createToken(actor, { name: "内容读写", tier: "READ_WRITE", projectWhitelist: [inside.id] });
  const ro = await tokens.createToken(actor, { name: "内容只读", tier: "READ_ONLY", projectWhitelist: [inside.id] });
  const global = await tokens.createToken(actor, { name: "模板配置", tier: "READ_WRITE", projectWhitelist: [] });
  const required = ["projectTemplate.list", "projectTemplate.get", "projectTemplate.create", "projectTemplate.update", "projectTemplate.delete", "project.createFromTemplate", "workflow.list", "workflow.create", "workflow.update", "workflow.listStates", "workflow.addState", "workflow.updateState", "workflow.archiveState", "workflow.listTransitions", "workflow.addTransition", "workflow.updateTransition", "workflow.removeTransition"];
  const names = (await rpc(rw.token, "tools/list")).tools.map((t: { name: string }) => t.name);
  check("模板工作流配置契约完整", required.every(name => names.includes(name)));
  const globalRO = await tokens.createToken(actor, { name: "模板只读", tier: "READ_ONLY", projectWhitelist: [] });
  const templateInput = { name: "项目交付模板", payload: { milestones: [{ name: "验收里程碑" }], iterations: [{ name: "首轮迭代", startDate: "2026-11-20", endDate: "2026-11-30" }], workItems: [{ title: "模板内任务", type: "TASK" }] }, userConfirmed: true };
  await call(rw.token, "projectTemplate.create", templateInput, "FORBIDDEN");
  const template = await call(global.token, "projectTemplate.create", templateInput);
  check("模板列表和详情可发现", (await call(global.token, "projectTemplate.list", {})).templates.some((r: { id: string }) => r.id === template.id) && (await call(global.token, "projectTemplate.get", { templateId: template.id })).payload.workItems.length === 1);
  await call(global.token, "projectTemplate.update", { templateId: template.id, name: "已确认模板", userConfirmed: true });
  check("模板修改持久化", (await call(global.token, "projectTemplate.get", { templateId: template.id })).name === "已确认模板");
  const created = await call(global.token, "project.createFromTemplate", { key: `T${marker.slice(0, 6)}`, name: "模板生成项目", templateId: template.id, userConfirmed: true });
  check("模板真实创建项目计划与任务", created.failures.length === 0 && created.applied.milestones === 1 && created.applied.iterations === 1 && created.applied.workItems === 1 && (await call(global.token, "workitem.list", { projectId: created.project.id })).total === 1);
  const [globalClient] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, global.row.id));
  const templateWrites: [string, Record<string, unknown>][] = [
    ["projectTemplate.create", templateInput],
    ["projectTemplate.update", { templateId: template.id, name: "禁止修改", userConfirmed: true }],
    ["projectTemplate.delete", { templateId: template.id, userConfirmed: true }],
    ["project.createFromTemplate", { key: `N${marker.slice(0, 6)}`, name: "禁止创建", templateId: template.id, userConfirmed: true }],
  ];
  for (const [name, args] of templateWrites) {
    await call(globalRO.token, name, args, "FORBIDDEN");
    await call(rw.token, name, args, "FORBIDDEN");
    await call(global.token, name, { ...args, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    const { userConfirmed: _confirmed, ...missing } = args;
    await call(global.token, name, missing, "VALIDATION");
    await policies.replaceClientPolicies(actor, globalClient!.id, [{ toolName: name, effect: "DENY" }]);
    await call(global.token, name, args, "FORBIDDEN");
    await policies.replaceClientPolicies(actor, globalClient!.id, []);
  }
  check("模板全部写操作确认档位策略范围反控", (await call(global.token, "projectTemplate.get", { templateId: template.id })).name === "已确认模板");
  await call(global.token, "projectTemplate.delete", { templateId: template.id, userConfirmed: true });
  check("模板删除不影响已生成业务", !(await call(global.token, "projectTemplate.list", {})).templates.some((r: { id: string }) => r.id === template.id) && (await call(global.token, "workitem.list", { projectId: created.project.id })).total === 1);
  const projectScope = { projectId: inside.id };
  const flow = await call(rw.token, "workflow.create", { ...projectScope, name: "验收自定义流程", appliesToType: "TASK", userConfirmed: true });
  const flowScope = { ...projectScope, workflowId: flow.id };
  check("工作流创建后目录可读", (await call(ro.token, "workflow.list", projectScope)).workflows.some((r: { id: string }) => r.id === flow.id));
  await call(rw.token, "workflow.update", { ...flowScope, name: "已确认流程", userConfirmed: true });
  const start = await call(rw.token, "workflow.addState", { ...flowScope, key: "WAIT", name: "待处理", category: "NOT_STARTED", userConfirmed: true });
  const terminal = await call(rw.token, "workflow.addState", { ...flowScope, key: "FINISHED", name: "完成", category: "TERMINAL", userConfirmed: true });
  await call(rw.token, "workflow.updateState", { ...flowScope, stateId: start.id, name: "待验收", sortOrder: 1, wipLimit: 5, userConfirmed: true });
  check("状态修改回读", (await call(ro.token, "workflow.listStates", flowScope)).states.some((r: { id: string; wipLimit: number }) => r.id === start.id && r.wipLimit === 5));
  const edge = await call(rw.token, "workflow.addTransition", { ...flowScope, fromStateId: start.id, toStateId: terminal.id, userConfirmed: true });
  await call(rw.token, "workflow.updateTransition", { ...flowScope, transitionId: edge.id, requiresApproval: true, approverRoleKeys: ["ADMIN"], userConfirmed: true });
  check("迁移审批配置回读", (await call(ro.token, "workflow.listTransitions", flowScope)).transitions.some((r: { id: string; requiresApproval: boolean }) => r.id === edge.id && r.requiresApproval));
  const foreignFlow = (await workflows.listWorkflows(actor, outside.id))[0]!;
  await call(rw.token, "workflow.listStates", { ...projectScope, workflowId: foreignFlow.id }, "NOT_FOUND");
  await call(global.token, "workflow.update", { ...projectScope, workflowId: foreignFlow.id, name: "不得混入其他项目", userConfirmed: true }, "NOT_FOUND");
  check("流程ID实际归属不能由projectId伪装", (await workflows.listWorkflows(actor, outside.id))[0]!.name === foreignFlow.name);
  const [scopedPerson] = await db.insert(member).values({ username: `scope-${marker}`, name: "项目管理员", status: "ACTIVE", passwordHash: await hashPassword(`scope-${marker}-password`) }).returning();
  const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
  await db.insert(roleAssignment).values([
    { memberId: scopedPerson!.id, roleId: adminRole!.id, scopeType: "PROJECT", scopeId: inside.id },
    { memberId: scopedPerson!.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: outside.id },
  ]);
  const scopedActor = (await loadActor(scopedPerson!.id))!;
  const scopedToken = await tokens.createToken(scopedActor, { name: "项目角色验收", tier: "READ_WRITE", projectWhitelist: [] });
  const scopedFlow = await call(scopedToken.token, "workflow.create", { ...projectScope, name: "项目角色可管理", appliesToType: "TASK", userConfirmed: true });
  await call(scopedToken.token, "workflow.update", { ...projectScope, workflowId: scopedFlow.id, name: "项目权限正向", userConfirmed: true });
  check("项目级管理员可创建修改实际项目工作流", (await call(scopedToken.token, "workflow.list", projectScope)).workflows.some((row: { id: string; name: string }) => row.id === scopedFlow.id && row.name === "项目权限正向"));
  await call(scopedToken.token, "workflow.list", { projectId: outside.id }, "FORBIDDEN");
  await call(scopedToken.token, "workflow.create", { projectId: outside.id, name: "越权流程", appliesToType: "TASK", userConfirmed: true }, "FORBIDDEN");
  await call(scopedToken.token, "workflow.update", { projectId: outside.id, workflowId: foreignFlow.id, name: "越权修改", userConfirmed: true }, "FORBIDDEN");
  await call(scopedToken.token, "projectTemplate.list", {}, "FORBIDDEN");
  check("项目角色不能借用其他项目或组织管理权限", (await workflows.listWorkflows(actor, outside.id))[0]!.name === foreignFlow.name);
  const builtin = (await workflows.listWorkflows(actor))[0]!;
  await assert.rejects(workflows.addState(actor, builtin.id, { key: "ILLEGAL", name: "不可更改内置", category: "NOT_STARTED" }), (e: unknown) => (e as { code: string }).code === "FORBIDDEN");
  check("服务层也阻止修改内置状态模板", true);
  const writes: [string, Record<string, unknown>][] = [
    ["workflow.create", { ...projectScope, name: "禁止创建", appliesToType: "TASK", userConfirmed: true }],
    ["workflow.update", { ...flowScope, name: "禁止更新", userConfirmed: true }],
    ["workflow.addState", { ...flowScope, key: "ILLEGAL", name: "禁止状态", category: "IN_PROGRESS", userConfirmed: true }],
    ["workflow.updateState", { ...flowScope, stateId: start.id, name: "禁止修改", userConfirmed: true }],
    ["workflow.archiveState", { ...flowScope, stateId: start.id, userConfirmed: true }],
    ["workflow.addTransition", { ...flowScope, fromStateId: start.id, toStateId: terminal.id, userConfirmed: true }],
    ["workflow.updateTransition", { ...flowScope, transitionId: edge.id, requiresApproval: false, userConfirmed: true }],
    ["workflow.removeTransition", { ...flowScope, transitionId: edge.id, userConfirmed: true }],
  ];
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, rw.row.id));
  for (const [name, args] of writes) {
    await call(ro.token, name, args, "FORBIDDEN");
    await call(rw.token, name, { ...args, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    const { userConfirmed: _c, ...missing } = args;
    await call(rw.token, name, missing, "VALIDATION");
    await call(rw.token, name, { ...args, projectId: outside.id }, "NOT_FOUND");
    await policies.replaceClientPolicies(actor, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(rw.token, name, args, "FORBIDDEN");
    await policies.replaceClientPolicies(actor, client!.id, []);
  }
  check("流程写操作确认档位策略范围反控", true);
  await call(rw.token, "workflow.removeTransition", { ...flowScope, transitionId: edge.id, userConfirmed: true });
  await call(rw.token, "workflow.archiveState", { ...flowScope, stateId: terminal.id, userConfirmed: true });
  check("移除迁移归档状态后列表一致", (await call(ro.token, "workflow.listTransitions", flowScope)).transitions.length === 0 && !(await call(ro.token, "workflow.listStates", flowScope)).states.some((r: { id: string }) => r.id === terminal.id));
  console.log(`MCP业务配置闭环 ${checks}/${checks}`);
} finally { await app.close(); await sql.end({ timeout: 5 }); }
