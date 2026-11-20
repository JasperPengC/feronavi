import "./_env.ts";
/** 真实 HTTP MCP：自动化、SLA、通知偏好的业务闭环与令牌边界；不发送公告。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, mcpToolPolicy, announcement } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as automation from "../src/server/services/automation.service.ts";
import * as sla from "../src/server/services/sla.service.ts";
import { ALL_TOOLS } from "../src/server/application/capabilities/tools.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 6);
let checks = 0, rpcId = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
async function call(token: string, name: string, args: Record<string, unknown>, error?: string) {
  if (ALL_TOOLS.find(tool => tool.name === name)?.kind === "write" && !Object.hasOwn(args, "userConfirmed")) args = { ...args, userConfirmed: true };
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  assert.notEqual(response.status, 429, "MCP 限流，停止本轮");
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.error, undefined, JSON.stringify(envelope.error));
  const result = envelope.result;
  const data = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true, name); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(result.structuredContent, data); }
  return data;
}

try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const password = `Operations-${marker}-password`;
  const [adminRow] = await db.insert(member).values({ username: `mcp-ops-${marker}`, email: `${marker}@operations.test`, name: "运维闭环验收", status: "ACTIVE", passwordHash: await hashPassword(password) }).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const project = await projects.createProject(admin, { key: `OP${marker.toUpperCase()}`, name: "运维闭环" });
  const outside = await projects.createProject(admin, { key: `OO${marker.toUpperCase()}`, name: "范围反控" });
  const rw = await tokens.createToken(admin, { name: "项目读写", tier: "READ_WRITE", projectWhitelist: [project.id] });
  const ro = await tokens.createToken(admin, { name: "项目只读", tier: "READ_ONLY", projectWhitelist: [project.id] });
  const account = await tokens.createToken(admin, { name: "账号读写", tier: "READ_WRITE" });
  const accountRead = await tokens.createToken(admin, { name: "账号只读", tier: "READ_ONLY" });
  const task = await items.createWorkItem(admin, project.id, { type: "TASK", title: "自动化条件样本", priority: "MEDIUM" });
  const outsideTask = await items.createWorkItem(admin, outside.id, { type: "TASK", title: "范围外样本" });
  const outsidePlan = await plans.createPlan(admin, outside.id, "milestone", { name: "范围外里程碑" });
  const ruleInput = { name: "试运行规则", trigger: "WORK_ITEM_UPDATED", enabled: true, conditions: { all: [{ field: "priority", op: "eq", value: "MEDIUM" }] }, actions: [{ type: "SET_FIELD", field: "priority", value: "HIGH" }] };
  const rule = (await call(rw.token, "automation.createRule", { projectId: project.id, ...ruleInput })).result;
  const ref = { projectId: project.id, ruleId: rule.id };
  check("规则创建可回读", (await call(ro.token, "automation.listRules", { projectId: project.id })).rules.some((row: { id: string }) => row.id === rule.id));
  const dry = await call(ro.token, "automation.dryRun", { ...ref, workItemId: task.id });
  check("试运行匹配条件且不执行动作", dry.matched === true && (await items.getWorkItem(admin, task.id)).priority === "MEDIUM" && (await call(ro.token, "automation.listRuns", { projectId: project.id })).runs.length === 0);
  await call(rw.token, "automation.updateRule", { ...ref, enabled: false, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(ro.token, "automation.updateRule", { ...ref, enabled: false, userConfirmed: true }, "FORBIDDEN");
  await call(rw.token, "automation.updateRule", { ...ref, enabled: false, userConfirmed: true, unexpected: true }, "VALIDATION");
  const changed = await call(rw.token, "automation.updateRule", { ...ref, name: "已修改规则", conditions: { all: [{ field: "priority", op: "eq", value: "LOW" }] }, userConfirmed: true });
  check("规则更新后试运行反映新条件", changed.name === "已修改规则" && !(await call(ro.token, "automation.dryRun", { ...ref, workItemId: task.id })).matched);
  const disabled = await call(rw.token, "automation.disableRule", { ...ref, userConfirmed: true });
  check("停用规则并复读状态", disabled.enabled === false && (await call(ro.token, "automation.listRules", { projectId: project.id })).rules.find((row: { id: string }) => row.id === rule.id).enabled === false);
  const externalRule = await automation.createRule(admin, outside.id, ruleInput);
  await call(rw.token, "automation.updateRule", { projectId: project.id, ruleId: externalRule.id, enabled: false, userConfirmed: true }, "NOT_FOUND");
  await call(rw.token, "automation.deleteRule", { projectId: project.id, ruleId: externalRule.id, userConfirmed: true }, "NOT_FOUND");
  await call(rw.token, "automation.dryRun", { ...ref, workItemId: outsideTask.id }, "NOT_FOUND");
  const externalAction = { type: "SET_FIELD", field: "milestoneId", value: outsidePlan.id };
  await call(rw.token, "automation.updateRule", { ...ref, actions: [externalAction], userConfirmed: true }, "NOT_FOUND");
  await call(rw.token, "automation.createRule", { projectId: project.id, ...ruleInput, actions: [externalAction] }, "NOT_FOUND");
  await call(account.token, "automation.updateRule", { ...ref, actions: [externalAction], userConfirmed: true }, "NOT_FOUND");
  await call(account.token, "automation.createRule", { projectId: project.id, ...ruleInput, actions: [externalAction] }, "NOT_FOUND");
  check("规则资源、工作项及嵌套计划均受项目范围约束", (await automation.listRules(admin, outside.id)).find(row => row.id === externalRule.id)?.enabled === true);

  const command = { resourceType: "AUTOMATION", resourceId: rule.id, action: "automation.updateRule", input: { name: "协作已更新" }, userConfirmed: true };
  await call(rw.token, "collab.command", { ...command, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(rw.token, "collab.command", { ...command, input: { actions: [externalAction] } }, "NOT_FOUND");
  await call(account.token, "collab.command", { ...command, input: { actions: [externalAction] } }, "NOT_FOUND");
  await db.insert(mcpToolPolicy).values({ tokenId: rw.row.id, toolName: "automation.updateRule", effect: "DENY" });
  await call(rw.token, "automation.updateRule", { ...ref, name: "不应写入", userConfirmed: true }, "FORBIDDEN");
  await call(rw.token, "collab.command", command, "FORBIDDEN");
  await db.delete(mcpToolPolicy).where(and(eq(mcpToolPolicy.tokenId, rw.row.id), eq(mcpToolPolicy.toolName, "automation.updateRule")));
  check("直接工具与协作命令共用确认和工具策略", (await automation.listRules(admin, project.id)).find(row => row.id === rule.id)?.name === "已修改规则");
  const collabUpdated = await call(rw.token, "collab.command", command);
  const collabDry = await call(rw.token, "collab.command", { ...command, action: "automation.dryRun", input: { workItemId: task.id } });
  const collabDisabled = await call(rw.token, "collab.command", { ...command, action: "automation.disableRule", input: {} });
  check("协作修改、试运行与停用均执行同一业务", collabUpdated.result.name === "协作已更新" && collabDry.result.matched === false && collabDisabled.result.enabled === false);
  const disposable = await automation.createRule(admin, project.id, { ...ruleInput, enabled: false });
  await call(rw.token, "collab.command", { ...command, resourceId: disposable.id, action: "automation.deleteRule", input: {} });
  await call(rw.token, "automation.deleteRule", { ...ref, userConfirmed: true });
  check("直接与协作删除后列表不再返回规则", (await call(ro.token, "automation.listRules", { projectId: project.id })).rules.length === 0);

  const policyInput = { projectId: project.id, name: "工作时 SLA", responseMinutes: 30, resolveMinutes: 240, calendar: { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, userConfirmed: true };
  await call(ro.token, "sla.createPolicy", policyInput, "FORBIDDEN");
  await call(rw.token, "sla.createPolicy", { ...policyInput, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(rw.token, "sla.createPolicy", { ...policyInput, responseMinutes: 0 }, "VALIDATION");
  const policy = await call(rw.token, "sla.createPolicy", policyInput);
  const policyRef = { projectId: project.id, policyId: policy.id };
  check("SLA创建后可列表与详情复读", (await call(ro.token, "sla.listPolicies", { projectId: project.id })).policies.some((row: { id: string }) => row.id === policy.id) && (await call(ro.token, "sla.getPolicy", policyRef)).resolveMinutes === 240);
  await call(rw.token, "sla.updatePolicy", { ...policyRef, resolveMinutes: 5, userConfirmed: true }, "VALIDATION");
  const updatedPolicy = await call(rw.token, "sla.updatePolicy", { ...policyRef, resolveMinutes: 360, enabled: false, userConfirmed: true });
  check("SLA修改校验合并时限并可停用", updatedPolicy.resolveMinutes === 360 && (await call(ro.token, "sla.getPolicy", policyRef)).enabled === false);
  const externalPolicy = await sla.createPolicy(admin, outside.id, { name: "范围外SLA", responseMinutes: 30, resolveMinutes: 60 });
  for (const name of ["sla.getPolicy", "sla.updatePolicy", "sla.deletePolicy"]) await call(rw.token, name, { projectId: project.id, policyId: externalPolicy.id, ...(name !== "sla.getPolicy" ? { userConfirmed: true } : {}) }, "NOT_FOUND");
  check("SLA伪装项目ID不能读取或修改其他项目策略", (await sla.listPolicies(admin, outside.id)).length === 1);
  await call(rw.token, "sla.deletePolicy", { ...policyRef, userConfirmed: true });
  check("SLA删除后列表及详情一致", (await call(ro.token, "sla.listPolicies", { projectId: project.id })).policies.length === 0);
  await call(ro.token, "sla.getPolicy", policyRef, "NOT_FOUND");

  await call(rw.token, "notification.getPrefs", {}, "FORBIDDEN");
  await call(rw.token, "notification.setPrefs", { categoryPrefs: { ASSIGN: { email: false } } }, "FORBIDDEN");
  await call(rw.token, "announcement.list", {}, "FORBIDDEN");
  check("全账号工具拒绝项目受限令牌", (await call(accountRead.token, "notification.getPrefs", {})).digestFrequency === "OFF");
  await call(account.token, "notification.setPrefs", { categoryPrefs: { ASSIGN: { inApp: false, email: true }, TRANSITION: { inApp: false, email: false } }, digestFrequency: "DAILY" });
  await call(account.token, "notification.setPrefs", { categoryPrefs: { ASSIGN: { email: false } } });
  let preferences = await call(accountRead.token, "notification.getPrefs", {});
  assert.deepEqual(preferences.categoryPrefs, { ASSIGN: { inApp: false, email: false }, TRANSITION: { inApp: false, email: false } });
  check("MCP偏好只改传入渠道并保留其他类别与摘要频率", preferences.digestFrequency === "DAILY");

  const login = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: adminRow!.username, password }) });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const headers = { "content-type": "application/json", "x-csrf-token": decodeURIComponent(loginBody.csrfToken), cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  const rest = async (path: string, method = "GET", body?: object, status = 200) => {
    const response = await fetch(`${process.env.BASE}/api/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  await rest("/notification-preferences", "PUT", { categoryPrefs: { TRANSITION: { email: true } } });
  preferences = await call(accountRead.token, "notification.getPrefs", {});
  assert.deepEqual(preferences.categoryPrefs, { ASSIGN: { inApp: false, email: false }, TRANSITION: { inApp: false, email: true } });
  check("REST偏好修改与MCP回读共享逐渠道合并", (await rest("/notification-preferences")).categoryPrefs.ASSIGN.inApp === false);
  await Promise.all([
    rest("/notification-preferences", "PUT", { categoryPrefs: { ASSIGN: { email: true } } }),
    rest("/notification-preferences", "PUT", { categoryPrefs: { TRANSITION: { inApp: true } } }),
  ]);
  preferences = await call(accountRead.token, "notification.getPrefs", {});
  check("并发偏好更新锁行合并，不丢失独立修改", preferences.categoryPrefs.ASSIGN.email === true && preferences.categoryPrefs.TRANSITION.inApp === true);
  const restPolicy = await sla.createPolicy(admin, project.id, { name: "REST时限校验", responseMinutes: 30, resolveMinutes: 60 });
  await rest(`/projects/${project.id}/sla-policies/${restPolicy.id}`, "PATCH", { resolveMinutes: 5 }, 400);
  check("REST与MCP拒绝相同的无效SLA时限", (await sla.listPolicies(admin, project.id)).find(row => row.id === restPolicy.id)?.resolveMinutes === 60);

  const [activeAnnouncement, revokedAnnouncement] = await db.insert(announcement).values([
    { authorId: admin.memberId, title: "本地公告样本", body: "没有发送通知", audience: { roleKeys: ["ADMIN"] }, deliveredCount: 0 },
    { authorId: admin.memberId, title: "已撤回样本", body: "没有发送通知", revokedAt: new Date(), deliveredCount: 0 },
  ]).returning();
  const active = await call(accountRead.token, "announcement.list", {});
  const all = await call(accountRead.token, "announcement.list", { includeRevoked: true });
  check("公告列表默认隐藏撤回，显式读取可复核撤回状态", active.announcements.some((row: { id: string }) => row.id === activeAnnouncement!.id) && !active.announcements.some((row: { id: string }) => row.id === revokedAnnouncement!.id) && all.announcements.find((row: { id: string }) => row.id === revokedAnnouncement!.id).revokedAt !== null);
  console.log(`MCP 运维业务闭环 ${checks}/${checks}`);
} finally { await app.close(); await sql.end(); }
