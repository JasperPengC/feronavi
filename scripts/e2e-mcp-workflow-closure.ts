import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
/** 真实 HTTP MCP：必填字段流转、审批字段持久化、评论回复写后回读。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, workflowState, workflowTransition, approvalRequest, auditEntry, idempotencyKey, activityEntry, mcpToolPolicy } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import * as comments from "../src/server/services/comment.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as lifecycle from "../src/server/services/planning-lifecycle.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { prepareReadyRelease } from "../tests/support/release-ready-fixture.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
let checks = 0, rpcId = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
async function rpc(token: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } }) });
  assert.notEqual(response.status, 429, "MCP 限流，停止本轮");
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.error, undefined, JSON.stringify(envelope.error));
  return envelope.result;
}
async function call(token: string, name: string, args: Record<string, unknown>, error?: string) {
  const result = await rpc(token, name, args);
  const data = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true, name); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(result.structuredContent, data); }
  return data;
}

try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const password = `Workflow-${marker}-password`;
  const [adminRow] = await db.insert(member).values({ username: `mcp-flow-${marker.toLowerCase()}`, email: `${marker}@workflow.test`, name: "流程闭环验收", status: "ACTIVE", passwordHash: await hashPassword(password) }).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const project = await projects.createProject(admin, { key: `WC${marker}`, name: "工作流与评论闭环" });
  const outside = await projects.createProject(admin, { key: `WO${marker}`, name: "范围反控" });
  const rw = await tokens.createToken(admin, { name: "流程读写", tier: "READ_WRITE", projectWhitelist: [project.id] });
  const ro = await tokens.createToken(admin, { name: "流程只读", tier: "READ_ONLY", projectWhitelist: [project.id] });
  const task = await items.createWorkItem(admin, project.id, { type: "TASK", title: "直接工具必填字段" });
  const states = await db.select().from(workflowState).where(eq(workflowState.workflowId, task.workflowId));
  const ongoing = states.find(state => state.key === "IN_PROGRESS")!;
  const terminal = states.find(state => state.key === "DONE")!;
  await db.update(workflowTransition).set({ requiredFields: ["reason", "evidence"] }).where(and(eq(workflowTransition.workflowId, task.workflowId), eq(workflowTransition.fromStateId, task.statusId), eq(workflowTransition.toStateId, ongoing.id)));
  const discovered = await call(rw.token, "workitem.get", { workItemId: task.id });
  check("工具可发现真实迁移必填字段", discovered.allowedTransitions.some((edge: { toStateKey: string; requiredFields: string[] }) => edge.toStateKey === "IN_PROGRESS" && edge.requiredFields.includes("reason") && edge.requiredFields.includes("evidence")));
  const missing = await call(rw.token, "workitem.transition", { workItemId: task.id, toStateKey: "IN_PROGRESS", version: task.version }, "VALIDATION");
  check("缺必填字段拒绝且不改状态", missing.details.requiredFields.includes("reason") && (await items.getWorkItem(admin, task.id)).statusId === task.statusId);
  await call(rw.token, "workitem.transition", { workItemId: task.id, toStateKey: "IN_PROGRESS", version: task.version, fields: "invalid" }, "VALIDATION");
  const fields = { reason: "已检查前置条件", evidence: { result: "PASS", checks: 2 } };
  const changed = await call(rw.token, "workitem.transition", { workItemId: task.id, toStateKey: "IN_PROGRESS", version: task.version, fields });
  const verified = (await call(ro.token, "workitem.get", { workItemId: task.id })).workItem;
  check("直接工具携带字段完成流转并复读版本", changed.statusId === ongoing.id && verified.statusId === ongoing.id && verified.version === task.version + 1);
  await call(ro.token, "workitem.transition", { workItemId: task.id, toStateKey: "DONE", version: verified.version, fields }, "FORBIDDEN");

  const collabTask = await items.createWorkItem(admin, project.id, { type: "TASK", title: "协作命令必填字段" });
  const command = { resourceType: "WORK_ITEM", resourceId: collabTask.id, action: "workitem.transition", input: { toStateKey: "IN_PROGRESS", version: collabTask.version, fields }, userConfirmed: true };
  await call(rw.token, "collab.command", { ...command, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(rw.token, "collab.command", { ...command, input: { ...command.input, fields: ["invalid"] } }, "VALIDATION");
  await call(rw.token, "collab.command", command);
  check("协作命令携带相同字段完成流转", (await call(ro.token, "workitem.get", { workItemId: collabTask.id })).workItem.statusId === ongoing.id);

  await db.update(workflowTransition).set({ requiredFields: ["reason", "evidence"], requiresApproval: true, approverRoleKeys: ["ADMIN"] }).where(and(eq(workflowTransition.workflowId, task.workflowId), eq(workflowTransition.fromStateId, ongoing.id), eq(workflowTransition.toStateId, terminal.id)));
  const request = await call(rw.token, "workitem.transition", { workItemId: task.id, toStateKey: "DONE", version: verified.version, fields }, "BLOCKED_BY_PREREQUISITE");
  const approvalId = request.details.approvalId;
  const approval = (await call(ro.token, "approval.list", { workItemId: task.id })).approvals.find((row: { id: string }) => row.id === approvalId);
  assert.deepEqual(approval?.transitionFields, fields);
  check("审批申请保存原必填字段供审批人回读", approval?.status === "PENDING");
  const approved = await call(rw.token, "approval.approve", { approvalId, comment: "验证完成", idempotencyKey: `approve-${marker}` });
  const finalItem = (await call(ro.token, "workitem.get", { workItemId: task.id })).workItem;
  const finalApproval = (await call(ro.token, "approval.list", { workItemId: task.id })).approvals.find((row: { id: string }) => row.id === approvalId);
  check("审批通过复用申请字段完成终态流转", approved.result.status === "APPROVED" && finalApproval.status === "APPROVED" && finalItem.statusId === terminal.id && finalItem.version === verified.version + 1);
  const repeated = await call(rw.token, "approval.approve", { approvalId, comment: "验证完成", idempotencyKey: `approve-${marker}` });
  check("审批重复调用复用幂等结果且不二次流转", repeated.replayed && (await items.getWorkItem(admin, task.id)).version === finalItem.version);
  assert.deepEqual((await db.select().from(approvalRequest).where(eq(approvalRequest.id, approvalId)))[0]?.transitionFields, fields);
  check("数据库保留原审批字段", true);

  const login = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: adminRow!.username, password }) });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const headers = { "content-type": "application/json", "x-csrf-token": decodeURIComponent(loginBody.csrfToken), cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  const rest = async (path: string, method = "GET", body?: object, status = 200) => {
    const response = await fetch(`${process.env.BASE}/api/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.notEqual(response.status, 429, "REST 限流：停止本轮，不重试");
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const restItem = await rest(`/work-items/${collabTask.id}`);
  const restFields = { reason: "平台端字段快照", evidence: { result: "PASS", source: "REST" } };
  const restRequest = await rest(`/work-items/${collabTask.id}/transition`, "POST", { toStateKey: "DONE", version: restItem.version, fields: restFields }, 422);
  assert.equal(restRequest.code, "BLOCKED_BY_PREREQUISITE");
  const restApprovalId = restRequest.details.approvalId;
  const restApproval = (await rest(`/work-items/${collabTask.id}/approvals`)).approvals.find((row: { id: string }) => row.id === restApprovalId);
  assert.deepEqual(restApproval.transitionFields, restFields);
  check("REST 申请保留同一必填字段快照", restApproval.status === "PENDING");
  const restApproved = await rest(`/approvals/${restApprovalId}/approve`, "POST", { comment: "平台端验收通过" });
  const restFinal = await rest(`/work-items/${collabTask.id}`);
  check("REST 审批通过完成终态并复读", restApproved.approval.status === "APPROVED" && restFinal.statusId === terminal.id && restFinal.version === restItem.version + 1);

  const pendingTask = await items.createWorkItem(admin, project.id, { type: "TASK", title: "幂等协作审批" });
  const pendingStarted = await items.transitionWorkItem(admin, pendingTask.id, { toStateKey: "IN_PROGRESS", version: pendingTask.version, fields });
  const pendingKey = `pending-${marker}`;
  const pendingCommand = { resourceType: "WORK_ITEM", resourceId: pendingTask.id, action: "workitem.transition", input: { toStateKey: "DONE", version: pendingStarted.version, fields }, userConfirmed: true, idempotencyKey: pendingKey };
  const invalidKey = `invalid-${marker}`;
  await call(rw.token, "collab.command", { ...pendingCommand, input: { ...pendingCommand.input, fields: {} }, idempotencyKey: invalidKey }, "VALIDATION");
  check("非法申请仍返回错误且不保存审批或幂等结果", (await db.select().from(approvalRequest).where(eq(approvalRequest.workItemId, pendingTask.id))).length === 0 && (await db.select().from(idempotencyKey).where(eq(idempotencyKey.key, invalidKey))).length === 0);
  const pendingResult = await rpc(rw.token, "collab.command", pendingCommand);
  const pendingBody = JSON.parse(pendingResult.content[0].text);
  const pendingId = pendingBody.result?.approvalId ?? pendingBody.details?.approvalId;
  const [storedPending] = await db.select().from(approvalRequest).where(eq(approvalRequest.id, pendingId));
  assert.ok(storedPending, "带幂等键的协作审批必须持久化申请，不能随等待审批异常回滚");
  assert.deepEqual(storedPending.transitionFields, fields);
  assert.notEqual(pendingResult.isError, true, JSON.stringify(pendingBody));
  assert.deepEqual(pendingResult.structuredContent, pendingBody);
  assert.equal(pendingBody.result.status, "PENDING_APPROVAL");
  const replayedPending = await call(rw.token, "collab.command", pendingCommand);
  assert.deepEqual(replayedPending.result, pendingBody.result);
  const pendingRows = await db.select().from(approvalRequest).where(eq(approvalRequest.workItemId, pendingTask.id));
  const pendingAudit = await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, pendingTask.id), eq(auditEntry.action, "approval.requested")));
  const commandAudit = await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, pendingTask.id), eq(auditEntry.action, "collab.command.workitem.transition")));
  const commandActivity = await db.select().from(activityEntry).where(and(eq(activityEntry.targetId, pendingTask.id), eq(activityEntry.action, "collab.command.workitem.transition")));
  const [storedKey] = await db.select().from(idempotencyKey).where(and(eq(idempotencyKey.key, pendingKey), eq(idempotencyKey.actorId, admin.memberId), eq(idempotencyKey.scope, "collab.command")));
  check("幂等协作申请持久化字段、审批记录和审计且重放不重复写入", replayedPending.replayed && pendingRows.length === 1 && pendingAudit.length === 1 && commandAudit.length === 1 && commandActivity.length === 1 && storedKey?.state === "DONE");
  const pendingRead = (await call(ro.token, "workitem.get", { workItemId: pendingTask.id })).workItem;
  check("等待审批时工作项仍在原状态和版本", pendingRead.statusId === ongoing.id && pendingRead.version === pendingStarted.version);
  await db.insert(mcpToolPolicy).values({ tokenId: rw.row.id, toolName: "workitem.transition", effect: "DENY" });
  await call(rw.token, "collab.command", pendingCommand, "FORBIDDEN");
  await db.delete(mcpToolPolicy).where(and(eq(mcpToolPolicy.tokenId, rw.row.id), eq(mcpToolPolicy.toolName, "workitem.transition")));
  await call(rw.token, "collab.command", { ...pendingCommand, input: { ...pendingCommand.input, fields: { ...fields, reason: "不同申请" } } }, "CONFLICT");
  await call(rw.token, "approval.approve", { approvalId: pendingId, comment: "幂等申请验收", idempotencyKey: `approve-pending-${marker}` });
  const pendingFinal = (await call(ro.token, "workitem.get", { workItemId: pendingTask.id })).workItem;
  const afterApprovalReplay = await call(rw.token, "collab.command", pendingCommand);
  const persistedApproved = (await db.select().from(approvalRequest).where(eq(approvalRequest.id, pendingId)))[0];
  const approvedAudit = await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, pendingTask.id), eq(auditEntry.action, "approval.approved")));
  const terminalAudit = await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, pendingTask.id), eq(auditEntry.action, "work_item.transitioned")));
  check("幂等申请审批后终态持久化，重放不重提申请或流转", pendingFinal.statusId === terminal.id && pendingFinal.version === pendingStarted.version + 1 && persistedApproved?.status === "APPROVED" && afterApprovalReplay.replayed && approvedAudit.length === 1 && terminalAudit.length === 2);

  const restCommandTask = await items.createWorkItem(admin, project.id, { type: "TASK", title: "REST协作待审结果" });
  const restCommandStarted = await items.transitionWorkItem(admin, restCommandTask.id, { toStateKey: "IN_PROGRESS", version: restCommandTask.version, fields });
  await rest(`/collaboration/rooms/WORK_ITEM/${restCommandTask.id}/join`, "POST", { clientId: `rest-${marker}` });
  const restCommandPending = await rest(`/collaboration/rooms/WORK_ITEM/${restCommandTask.id}/commands`, "POST", { action: "workitem.transition", input: { toStateKey: "DONE", version: restCommandStarted.version, fields }, userConfirmed: true });
  const [restStoredPending] = await db.select().from(approvalRequest).where(eq(approvalRequest.id, restCommandPending.approvalId));
  assert.deepEqual(restStoredPending?.transitionFields, fields);
  check("REST协作命令接受待审批结果并持久化字段", restCommandPending.status === "PENDING_APPROVAL" && restStoredPending?.status === "PENDING" && (await rest(`/work-items/${restCommandTask.id}`)).version === restCommandStarted.version);
  await rest(`/approvals/${restCommandPending.approvalId}/approve`, "POST", { comment: "REST协作验收" });
  const restCommandFinal = await rest(`/work-items/${restCommandTask.id}`);
  const restCommandAudit = await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, restCommandTask.id), eq(auditEntry.action, "approval.approved")));
  check("REST协作申请可批准并保留审计和终态", restCommandFinal.statusId === terminal.id && restCommandFinal.version === restCommandStarted.version + 1 && restCommandAudit.length === 1);

  const finishedRelease = await plans.createPlan(admin, project.id, "release", { name: "阻断重开版本" });
  const releasedTask = await items.updateWorkItem(admin, pendingTask.id, { version: pendingFinal.version, releaseId: finishedRelease.id });
  await prepareReadyRelease(admin, project.id, finishedRelease.id);
  await lifecycle.complete(admin, finishedRelease.id, "release");
  await db.insert(workflowTransition).values({ workflowId: pendingTask.workflowId, fromStateId: terminal.id, toStateId: ongoing.id, allowedRoleIds: [] }).onConflictDoNothing();
  const blockedKey = `blocked-${marker}`;
  const ordinaryBlocked = await call(rw.token, "collab.command", { ...pendingCommand, input: { toStateKey: "IN_PROGRESS", version: releasedTask.version }, idempotencyKey: blockedKey }, "BLOCKED_BY_PREREQUISITE");
  check("普通前置条件阻断仍抛错且不缓存成功结果", ordinaryBlocked.details.field === "releaseId" && (await db.select().from(idempotencyKey).where(eq(idempotencyKey.key, blockedKey))).length === 0 && (await items.getWorkItem(admin, pendingTask.id)).statusId === terminal.id);

  const top = (await call(rw.token, "workitem.comment", { workItemId: task.id, body: "验收结论" })).result;
  const reply = (await call(rw.token, "workitem.comment", { workItemId: task.id, parentId: top.id, body: "回复验证通过" })).result;
  const roots = await call(ro.token, "workitem.comments", { workItemId: task.id });
  const replies = await call(ro.token, "workitem.comments", { workItemId: task.id, parentId: top.id });
  check("顶层读取不混入回复，指定父评论可复读刚写的回复", roots.comments.some((row: { id: string }) => row.id === top.id) && !roots.comments.some((row: { id: string }) => row.id === reply.id) && replies.comments.length === 1 && replies.comments[0].id === reply.id && replies.comments[0].body === "回复验证通过");
  const otherTask = await items.createWorkItem(admin, outside.id, { type: "TASK", title: "禁止项目任务" });
  const otherTop = await comments.createComment(admin, { targetType: "WORK_ITEM", targetId: otherTask.id, body: "禁止父评论" });
  await comments.createComment(admin, { targetType: "WORK_ITEM", targetId: otherTask.id, body: "不能泄露回复", parentId: otherTop!.id });
  await call(rw.token, "workitem.comments", { workItemId: otherTask.id, parentId: otherTop!.id }, "NOT_FOUND");
  check("伪装可见工作项不能读取其他项目父评论的回复", (await call(ro.token, "workitem.comments", { workItemId: task.id, parentId: otherTop!.id })).comments.length === 0);
  await call(rw.token, "workitem.comments", { workItemId: task.id, parentId: "invalid" }, "VALIDATION");
  console.log(`MCP 与 REST 工作流及评论闭环 ${checks}/${checks}`);
} finally { await app.close(); await sql.end(); }
