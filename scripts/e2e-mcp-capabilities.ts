import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
/** 真实隔离数据库 + HTTP MCP：能力发现、资源范围和业务写后回读。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, workItem, idea, mcpClient } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as ideas from "../src/server/services/idea.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { COLLAB_COMMANDS } from "../src/shared/collab-commands.ts";
import { readFile } from "node:fs/promises";
import { ALL_TOOLS } from "../src/server/application/capabilities/tools.ts";
import { assistantCapabilities } from "../src/server/services/assistant-capabilities.ts";
import { assistantRegistry, ASSISTANT_READ_TOOLS, ASSISTANT_WRITE_TOOLS } from "../src/server/services/assistant-tool-catalogue.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const required = ["meta.capabilities", "meta.tool", "project.context", "workitem.children", "idea.list", "idea.get", "idea.update",
  "plan.getIteration", "plan.updateIteration", "plan.getRelease", "plan.updateRelease",
  "plan.completeIteration", "plan.archiveIteration", "plan.unarchiveIteration", "plan.completeRelease", "plan.archiveRelease", "plan.unarchiveRelease",
  "plan.getModule", "plan.listModules", "plan.updateModule", "plan.archiveModule", "plan.unarchiveModule", "plan.updateMilestone", "plan.archiveMilestone", "plan.unarchiveMilestone"];
let checks = 0;
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
let rpcId = 0;
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  assert.notEqual(response.status, 429, "MCP 限流：停止本轮，不重试");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result;
}
async function call(token: string, name: string, args: Record<string, unknown>, error?: string) {
  const result = await rpc(token, "tools/call", { name, arguments: error === "VALIDATION" && !Object.hasOwn(args, "userConfirmed") ? args : confirmedTestArgs(name, args) });
  const data = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true, name); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(result.structuredContent, data); }
  return data;
}
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [adminRow] = await db.insert(member).values({ username: `mcp-cap-${marker}`, email: `${marker}@mcp.test`, name: "MCP 能力验收", status: "ACTIVE", passwordHash: await hashPassword(`test-${marker}-password`) }).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const inside = await projects.createProject(admin, { key: `CA${marker}`, name: "允许项目" });
  const outside = await projects.createProject(admin, { key: `CB${marker}`, name: "禁止项目" });
  const rw = await tokens.createToken(admin, { name: "范围读写", tier: "READ_WRITE", projectWhitelist: [inside.id] });
  const ro = await tokens.createToken(admin, { name: "范围只读", tier: "READ_ONLY", projectWhitelist: [inside.id] });
  // 子动作策略必须在协作包装和幂等缓存之外执行。
  await call(rw.token, "ping", {});
  const [policyClient] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, rw.row.id));
  const policyPlan = (await plans.createPlan(admin, inside.id, "milestone", { name: "策略验证房间" }))!;
  await policies.replaceClientPolicies(admin, policyClient!.id, [{ toolName: "plan.createMilestone", effect: "DENY" }]);
  await call(rw.token, "collab.command", { resourceType: "PLAN", resourceId: policyPlan.id, action: "plan.createMilestone", input: { name: "不得绕过禁用" }, userConfirmed: true }, "FORBIDDEN");
  check("collab.command 不能绕过子工具 DENY", !(await plans.list(admin, inside.id, "milestone")).some(row => row.name === "不得绕过禁用"));
  const deniedInspect = await call(rw.token, "collab.inspect", { resourceType: "PLAN", resourceId: policyPlan.id });
  check("协作能力发现排除策略禁用子动作", !deniedInspect.actions.includes("plan.createMilestone") && deniedInspect.domainTools.includes("plan.createMilestone"));
  await policies.replaceClientPolicies(admin, policyClient!.id, []);
  const listed = await rpc(rw.token, "tools/list");
  const baseline = JSON.parse(await readFile(new URL("../tests/fixtures/mcp-capability-baseline.json", import.meta.url), "utf8")) as { names: string[] };
  const names = ALL_TOOLS.map(tool => tool.name);
  assert.deepEqual(listed.tools.map((tool: { name: string }) => tool.name).sort(), [...names].sort());
  check("恢复前全部工具名称保留且HTTP目录与唯一注册表完全一致", baseline.names.every(name => names.includes(name)) && new Set(names).size === names.length);
  assert.equal(assistantCapabilities(), ALL_TOOLS);
  const assistantTools = await assistantRegistry();
  const expectedAssistant = ALL_TOOLS.filter(tool => ASSISTANT_READ_TOOLS.has(tool.name) || ASSISTANT_WRITE_TOOLS.has(tool.name));
  assert.deepEqual(assistantTools, expectedAssistant);
  check("助手目录复用唯一注册表的同一工具实例", assistantTools.every(tool => ALL_TOOLS.find(item => item.name === tool.name) === tool));
  const accepted = await policies.replaceClientPolicies(admin, policyClient!.id, names.map(toolName => ({ toolName, effect: "ALLOW" })));
  assert.deepEqual(accepted.map(policy => policy.toolName).sort(), [...names].sort());
  await assert.rejects(() => policies.replaceClientPolicies(admin, policyClient!.id, [{ toolName: "missing.registry.tool", effect: "DENY" }]), { code: "VALIDATION" });
  await policies.replaceClientPolicies(admin, policyClient!.id, []);
  check("真实策略持久化接受全部同源工具且拒绝未知名称", true);
  check("缺失业务能力全部公开并声明输出契约", required.every(name => listed.tools.some((tool: { name: string; outputSchema?: object }) => tool.name === name && tool.outputSchema)));
  const capabilities = await call(rw.token, "meta.capabilities", {});
  check("能力发现返回令牌项目范围与已注册工具", capabilities.projectWhitelist.length === 1 && capabilities.projectWhitelist[0] === inside.id && required.every(name => capabilities.tools.some((tool: { name: string }) => tool.name === name)));
  const readOnlyCapabilities = await call(ro.token, "meta.capabilities", {});
  check("只读令牌发现明确标记写工具不可用", readOnlyCapabilities.tools.some((tool: { name: string; allowed: boolean }) => tool.name === "idea.get" && tool.allowed) && readOnlyCapabilities.tools.filter((tool: { kind: string }) => tool.kind === "write").every((tool: { allowed: boolean }) => !tool.allowed));
  const contract = await call(rw.token, "meta.tool", { name: "idea.update" });
  check("单工具发现可得到可执行输入契约", contract.tool.name === "idea.update" && contract.tool.inputSchema.required.includes("ideaId") && contract.tool.outputSchema.type === "object");
  await call(rw.token, "meta.tool", { name: "does.not.exist" }, "NOT_FOUND");
  await call(rw.token, "meta.tool", { name: "idea.get", extra: true }, "VALIDATION");
  const context = await call(rw.token, "project.context", { projectId: inside.id });
  check("项目上下文复用真实项目、成员、工作流和字段", context.project.id === inside.id && context.members.some((m: { id: string }) => m.id === admin.memberId) && context.workflow.workflows.length > 0 && context.fields.fields.length > 0);
  check("项目上下文恢复自定义字段、模块及有界工作项", Array.isArray(context.customFields.definitions) && Array.isArray(context.modules) && Array.isArray(context.workItems.items) && context.workItems.pageSize === 20);
  await call(rw.token, "project.context", { projectId: outside.id }, "NOT_FOUND");
  for (const toolName of ["project.get", "project.members", "meta.workflow", "meta.fields", "plan.listIterations", "plan.listReleases", "plan.listMilestones", "customField.definitions", "plan.listModules", "workitem.list"]) {
    await policies.replaceClientPolicies(admin, policyClient!.id, [{ toolName, effect: "DENY" }]);
    await call(rw.token, "project.context", { projectId: inside.id }, "FORBIDDEN");
  }
  check("项目上下文不能绕过任一组成工具策略", true);
  await policies.replaceClientPolicies(admin, policyClient!.id, []);

  const { result: parent } = await call(rw.token, "workitem.create", { projectId: inside.id, type: "REQUIREMENT", title: "父需求" });
  const { result: child } = await call(rw.token, "workitem.create", { projectId: inside.id, type: "SUBTASK", title: "子任务", parentId: parent.id, startDate: "2026-11-19", estimateHours: 8 });
  const outsideParent = await items.createWorkItem(admin, outside.id, { type: "REQUIREMENT", title: "禁止父需求" });
  const children = await call(rw.token, "workitem.children", { workItemId: parent.id });
  check("子项读取保留真实父子层级", children.parent.id === parent.id && children.children.length === 1 && children.children[0].id === child.id);
  const updatedChild = await call(rw.token, "workitem.update", { workItemId: child.id, expectedVersion: child.version, estimatePoints: 5, estimateHours: 13, startDate: "2026-11-20" });
  const verifiedChild = (await call(ro.token, "workitem.get", { workItemId: child.id })).workItem;
  check("MCP 工作项支持排期与两种估算并保持版本", Number(verifiedChild.estimatePoints) === 5 && Number(verifiedChild.estimateHours) === 13 && verifiedChild.startDate === "2026-11-20" && updatedChild.version === child.version + 1);
  await call(rw.token, "workitem.children", { workItemId: outsideParent.id }, "NOT_FOUND");

  const ideaRow = await ideas.createIdea(admin, inside.id, { title: "能力验收想法" });
  const outsideIdea = await ideas.createIdea(admin, outside.id, { title: "禁止想法" });
  await call(rw.token, "idea.update", { ideaId: ideaRow!.id, description: "已评审", status: "UNDER_REVIEW" });
  const readIdea = await call(ro.token, "idea.get", { ideaId: ideaRow!.id });
  const ideaList = await call(ro.token, "idea.list", { projectId: inside.id, status: "UNDER_REVIEW", pageSize: 1 });
  check("想法更新后详情和筛选列表可回读", readIdea.description === "已评审" && readIdea.voteCount === 0 && ideaList.total === 1 && ideaList.items[0].id === ideaRow!.id);
  await call(ro.token, "idea.update", { ideaId: ideaRow!.id, title: "只读不应写入" }, "FORBIDDEN");
  await call(rw.token, "idea.update", { ideaId: outsideIdea!.id, title: "越权写入" }, "NOT_FOUND");
  await call(rw.token, "idea.get", { ideaId: outsideIdea!.id }, "NOT_FOUND");
  await call(rw.token, "idea.list", { projectId: outside.id }, "NOT_FOUND");
  await call(rw.token, "idea.update", { ideaId: ideaRow!.id, status: "INVALID" }, "VALIDATION");

  for (const kind of ["iteration", "release"] as const) {
    const suffix = kind === "iteration" ? "Iteration" : "Release";
    const idField = `${kind}Id`;
    const fields = kind === "iteration" ? { startDate: "2026-11-19", endDate: "2026-11-29" } : { releaseDate: "2026-11-29" };
    const plan = await plans.createPlan(admin, inside.id, kind, { name: `${kind} 原名`, ...fields });
    const denied = await plans.createPlan(admin, outside.id, kind, { name: "禁止计划", ...fields });
    await call(rw.token, `plan.update${suffix}`, { [idField]: plan!.id, name: `${kind} 已更新` });
    const read = await call(ro.token, `plan.get${suffix}`, { [idField]: plan!.id });
    check(`${kind} 真实更新并回读`, read.id === plan!.id && read.name === `${kind} 已更新`);
    await call(ro.token, `plan.update${suffix}`, { [idField]: plan!.id, name: "只读不应写入" }, "FORBIDDEN");
    await call(rw.token, `plan.get${suffix}`, { [idField]: denied!.id }, "NOT_FOUND");
    await call(rw.token, `plan.update${suffix}`, { [idField]: denied!.id, name: "越权写入" }, "NOT_FOUND");
    if (kind === "iteration") {
      const task = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "过滤唯一标记", iterationId: plan!.id });
      await items.createWorkItem(admin, inside.id, { type: "TASK", title: "过滤唯一标记其他迭代" });
      const filtered = await call(rw.token, "workitem.list", { projectId: inside.id, iterationId: plan!.id, q: "过滤唯一标记" });
      check("工作项筛选在数据库分页前组合迭代与关键词", filtered.total === 1 && filtered.items[0].id === task.id);
      await call(rw.token, "workitem.list", { projectId: inside.id, iterationId: denied!.id }, "NOT_FOUND");
      const next = await plans.createPlan(admin, inside.id, kind, { name: "下一迭代", startDate: "2026-11-30", endDate: "2026-12-14" });
      await call(rw.token, "plan.completeIteration", { iterationId: plan!.id }, "BLOCKED_BY_PREREQUISITE");
      await call(rw.token, "plan.completeIteration", { iterationId: plan!.id, targetIterationId: denied!.id }, "NOT_FOUND");
      await call(rw.token, "plan.completeIteration", { iterationId: plan!.id, targetIterationId: plan!.id }, "VALIDATION");
      const complete = await call(rw.token, "plan.completeIteration", { iterationId: plan!.id, targetIterationId: next!.id });
      const repeat = await call(rw.token, "plan.completeIteration", { iterationId: plan!.id, targetIterationId: next!.id });
      const saved = (await db.select().from(workItem).where(eq(workItem.id, task.id)))[0]!;
      check("完成迭代结转任务并增加版本；重复完成不再写入", complete.completedAt && complete.movedCount === 1 && repeat.alreadyCompleted && repeat.movedCount === 0 && saved.iterationId === next!.id && saved.version === task.version + 1);
    } else {
      const complete = await call(rw.token, "plan.completeRelease", { releaseId: plan!.id });
      const repeat = await call(rw.token, "plan.completeRelease", { releaseId: plan!.id });
      check("空版本可完成且重复完成幂等", complete.completedAt && repeat.alreadyCompleted && repeat.completedAt === complete.completedAt);
    }
    await call(ro.token, `plan.complete${suffix}`, { [idField]: plan!.id }, "FORBIDDEN");
    await call(rw.token, `plan.archive${suffix}`, { [idField]: denied!.id }, "NOT_FOUND");
    await call(rw.token, `plan.archive${suffix}`, { [idField]: plan!.id });
    const archived = await call(ro.token, `plan.get${suffix}`, { [idField]: plan!.id });
    const visible = await call(ro.token, `plan.list${suffix}s`, { projectId: inside.id });
    const all = await call(ro.token, `plan.list${suffix}s`, { projectId: inside.id, includeArchived: true });
    check(`${kind} 归档后默认列表隐藏，详情和显式归档列表保留`, archived.archivedAt && !visible[`${kind}s`].some((row: { id: string }) => row.id === plan!.id) && all[`${kind}s`].some((row: { id: string }) => row.id === plan!.id));
    await call(rw.token, `plan.unarchive${suffix}`, { [idField]: plan!.id });
    const restored = await call(ro.token, `plan.get${suffix}`, { [idField]: plan!.id });
    check(`${kind} 恢复归档保留完成时间`, restored.archivedAt === null && restored.completedAt === archived.completedAt);
  }

  for (const kind of ["milestone", "module"] as const) {
    const suffix = kind === "milestone" ? "Milestone" : "Module";
    const idField = `${kind}Id`;
    const plan = (await plans.createPlan(admin, inside.id, kind, { name: `直接 ${kind}` }))!;
    const foreign = (await plans.createPlan(admin, outside.id, kind, { name: `禁止 ${kind}` }))!;
    await call(rw.token, `plan.update${suffix}`, { [idField]: plan.id, name: "没有确认", userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    await call(rw.token, `plan.update${suffix}`, { [idField]: plan.id, name: "没有确认" }, "VALIDATION");
    await call(ro.token, `plan.update${suffix}`, { [idField]: plan.id, name: "只读", userConfirmed: true }, "FORBIDDEN");
    await call(rw.token, `plan.get${suffix}`, { [idField]: foreign.id }, "NOT_FOUND");
    await call(rw.token, `plan.update${suffix}`, { [idField]: foreign.id, name: "越权", userConfirmed: true }, "NOT_FOUND");
    if (kind === "module") {
      await call(rw.token, "plan.updateModule", { moduleId: plan.id, parentId: foreign.id, userConfirmed: true }, "NOT_FOUND");
      await call(rw.token, "collab.command", { resourceType: "PLAN", resourceId: plan.id, action: "plan.updateModule", input: { parentId: foreign.id }, userConfirmed: true }, "NOT_FOUND");
      await call(rw.token, "plan.updateModule", { moduleId: plan.id, parentId: plan.id, userConfirmed: true }, "VALIDATION");
    }
    await call(rw.token, `plan.update${suffix}`, { [idField]: plan.id, name: `${kind} 已更新`, userConfirmed: true });
    const read = await call(ro.token, `plan.get${suffix}`, { [idField]: plan.id });
    check(`${kind} 直接工具更新回读并执行确认及范围守卫`, (kind === "milestone" ? read.milestone : read).name === `${kind} 已更新`);
    const linked = await items.createWorkItem(admin, inside.id, { type: "TASK", title: `关联 ${kind}`, [idField]: plan.id });
    await call(rw.token, `plan.archive${suffix}`, { [idField]: plan.id, userConfirmed: true }, "BLOCKED_BY_PREREQUISITE");
    await items.updateWorkItem(admin, linked.id, { version: linked.version, [idField]: null });
    await call(rw.token, `plan.archive${suffix}`, { [idField]: plan.id, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    await call(rw.token, `plan.archive${suffix}`, { [idField]: plan.id, userConfirmed: true });
    const visible = await call(ro.token, `plan.list${suffix}s`, { projectId: inside.id });
    const all = await call(ro.token, `plan.list${suffix}s`, { projectId: inside.id, includeArchived: true });
    const restored = await call(rw.token, `plan.unarchive${suffix}`, { [idField]: plan.id, userConfirmed: true });
    check(`${kind} 归档关联保护、列表过滤和恢复`, !visible[`${kind}s`].some((row: { id: string }) => row.id === plan.id) && all[`${kind}s`].some((row: { id: string }) => row.id === plan.id) && restored.archivedAt === null);
  }

  for (const kind of ["milestone", "iteration", "release", "module"] as const) {
    const suffix = kind[0]!.toUpperCase() + kind.slice(1);
    const fields = kind === "iteration" ? { startDate: "2026-12-01", endDate: "2026-12-14" } : {};
    const command = (resourceId: string, action: string, input: object = {}, userConfirmed = true, error?: string, idempotencyKey?: string) => call(rw.token, "collab.command", { resourceType: "PLAN", resourceId, action: `plan.${action}${suffix}`, input, userConfirmed, ...(idempotencyKey ? { idempotencyKey } : {}) }, error);
    const created = (await command(policyPlan.id, "create", { name: `协作 ${kind}`, ...fields })).result;
    await command(created.id, "update", { name: "未确认更名" }, false, "COMMAND_CONFIRMATION_REQUIRED");
    await command(created.id, "update", { name: "替换目标", [`${kind}Id`]: created.id }, true, "VALIDATION");
    const renamed = await command(created.id, "update", { name: `协作 ${kind} 已更新` }, true, undefined, `plan-update-${kind}`);
    const replay = await command(created.id, "update", { name: `协作 ${kind} 已更新` }, true, undefined, `plan-update-${kind}`);
    check(`${kind} 协作创建更新并幂等重放`, renamed.result.name === `协作 ${kind} 已更新` && replay.replayed);
    await policies.replaceClientPolicies(admin, policyClient!.id, [{ toolName: `plan.update${suffix}`, effect: "DENY" }]);
    await command(created.id, "update", { name: `协作 ${kind} 已更新` }, true, "FORBIDDEN", `plan-update-${kind}`);
    await policies.replaceClientPolicies(admin, policyClient!.id, []);
    if (kind === "iteration" || kind === "release") {
      if (kind === "iteration") {
        const foreign = (await plans.createPlan(admin, outside.id, kind, { name: "禁止结转目标", ...fields }))!;
        await command(created.id, "complete", { targetIterationId: foreign.id }, true, "NOT_FOUND");
      }
      await command(created.id, "complete", {}, false, "COMMAND_CONFIRMATION_REQUIRED");
      await command(created.id, "complete");
    }
    await command(created.id, "archive", {}, false, "COMMAND_CONFIRMATION_REQUIRED");
    const archived = await command(created.id, "archive");
    const restored = await command(created.id, "unarchive");
    check(`${kind} 协作生命周期遵循确认与领域服务`, archived.result.archivedAt && restored.result.archivedAt === null && (kind === "iteration" || kind === "release" ? !!restored.result.completionResult : true));
  }
  const planInspect = await call(rw.token, "collab.inspect", { resourceType: "PLAN", resourceId: policyPlan.id });
  check("协作能力声明完整PLAN生命周期", COLLAB_COMMANDS.PLAN.every(action => planInspect.actions.includes(action) && planInspect.domainTools.includes(action)));
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, rw.row.id));
  await policies.replaceClientPolicies(admin, client!.id, [{ toolName: "idea.update", effect: "DENY" }]);
  await call(rw.token, "idea.update", { ideaId: ideaRow!.id, title: "策略禁止写入" }, "FORBIDDEN");
  check("新增工具进入策略目录且 DENY 阻止写入", (await db.select().from(idea).where(eq(idea.id, ideaRow!.id)))[0]!.title === "能力验收想法");
  const deniedCapabilities = await call(rw.token, "meta.capabilities", {});
  check("能力发现纳入工具级 DENY", deniedCapabilities.tools.some((tool: { name: string; allowed: boolean }) => tool.name === "idea.update" && !tool.allowed));
  check("禁止项目工作项未被改动", (await db.select().from(workItem).where(eq(workItem.id, outsideParent.id)))[0]!.title === "禁止父需求");
  console.log(`MCP 能力验收 ${checks}/${checks}`);
} finally { await app.close(); await sql.end(); }
