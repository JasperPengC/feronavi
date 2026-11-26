import "./_env.ts";
/** 隔离HTTP/MCP组合验收；模拟角色交接，不代表真人研究或外部交付证明。 */
import assert from "node:assert/strict";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import { createProject } from "../src/server/services/project.service.ts";
import * as roles from "../src/server/services/role.service.ts";
import * as tokens from "../src/server/services/token.service.ts";

assertIsolatedTestEnvironment();
await ensureInitialized();
const app = await buildApp({ logger: false });
let rpcId = 0, checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; console.log(`PASS ${name}`); }
async function rpc(token: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } }),
  });
  assert.notEqual(response.status, 429, "命中限流时停止，不重试");
  if (response.status !== 200) return { status: response.status, error: true, data: null };
  const envelope = await response.json();
  assert.equal(envelope.error, undefined);
  const result = envelope.result;
  return { status: response.status, error: !!result.isError, data: result.structuredContent ?? JSON.parse(result.content[0].text) };
}
async function call(token: string, name: string, args: Record<string, unknown>, expectedError?: string) {
  const result = await rpc(token, name, args);
  assert.equal(result.status, 200, `${name}: HTTP状态`);
  if (expectedError) { assert.equal(result.error, true, name); assert.equal(result.data.code, expectedError, name); }
  else assert.equal(result.error, false, `${name}: ${JSON.stringify(result.data)}`);
  return result.data.replayed !== undefined ? result.data.result : result.data;
}
const item = async (token: string, id: string) => (await call(token, "workitem.get", { workItemId: id })).workItem;
async function transition(token: string, id: string, state: string) {
  const detail = await call(token, "workitem.get", { workItemId: id });
  assert.ok(detail.allowedTransitions.some((edge: { toStateKey: string }) => edge.toStateKey === state));
  return call(token, "workitem.transition", { workItemId: id, version: detail.workItem.version, toStateKey: state });
}
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const allRoles = await db.select().from(role);
  const adminRole = allRoles.find(r => r.key === "ADMIN")!;
  const accounts = await db.insert(member).values(["admin", "product", "developer", "tester"].map(username => ({
    username: `handoff-${username}`, name: `组合验收 ${username}`, status: "ACTIVE", passwordHash: "isolated-no-password-login",
  }))).returning();
  const [adminMember, pmMember, devMember, qaMember] = accounts;
  // 仅凭据准备阶段授予管理员；业务验收前撤回，所有请求重新装载真实项目范围角色。
  const initial = await db.insert(roleAssignment).values(accounts.map(a => ({ memberId: a.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null }))).returning();
  const admin = (await loadActor(adminMember!.id))!;
  const project = await createProject(admin, { key: "HANDOFF", name: "独立角色完整迭代" });
  const outside = await createProject(admin, { key: "OUTSIDE", name: "范围反控" });
  const qaRole = await roles.createRole(admin, { slug: "handoff-qa", name: "组合验收测试", permissionKeys: ["api:read", "api:write", "test_case:manage", "test_plan:manage", "test_run:execute", "work_item:create", "work_item:update_own", "work_item:transition", "comment:create"] });
  const creds = [];
  for (const [account, key] of [[pmMember!, "PM"], [devMember!, "MEMBER"], [qaMember!, qaRole.key]] as const) {
    const credential = await tokens.createToken((await loadActor(account.id))!, { name: "项目范围HTTP验收", tier: "READ_WRITE", projectWhitelist: [project.id] });
    await roles.deleteRoleAssignment(admin, initial.find(r => r.memberId === account.id)!.id);
    const assigned = await roles.createRoleAssignment(admin, { memberId: account.id, roleId: key === qaRole.key ? qaRole.id : allRoles.find(r => r.key === key)!.id, scopeType: "PROJECT", scopeId: project.id });
    creds.push({ ...credential, memberId: account.id, assignment: assigned });
  }
  const [pm, dev, qa] = creds;
  for (const who of [pm!, dev!, qa!]) {
    const actor = (await loadActor(who.memberId))!;
    assert.equal(actor.grants.length, 1); assert.equal(actor.grants[0]!.scopeId, project.id);
  }
  check("三个独立账号仅在同一项目获得各自角色", true);
  await call(dev!.token, "workitem.list", { projectId: outside.id }, "NOT_FOUND");
  await call(dev!.token, "plan.createRelease", { projectId: project.id, name: "越权版本" }, "FORBIDDEN");
  check("开发令牌拒绝跨项目读取与计划管理", true);

  let req = await call(pm!.token, "workitem.create", { projectId: project.id, type: "REQUIREMENT", title: "多角色需求", description: "第一版验收规则" });
  for (const state of ["CONFIRMED", "SCHEDULED", "IN_PROGRESS"]) req = await transition(pm!.token, req.id, state);
  let task = await call(pm!.token, "workitem.create", { projectId: project.id, type: "TASK", title: "开发交接", parentId: req.id, assigneeId: devMember!.id });
  task = await transition(dev!.token, task.id, "IN_PROGRESS");
  await call(dev!.token, "workitem.update", { workItemId: req.id, expectedVersion: req.version, title: "越权改需求" }, "FORBIDDEN");
  task = await call(dev!.token, "workitem.update", { workItemId: task.id, expectedVersion: task.version, description: "负责人接手，已有项目内update_own权限" });
  check("负责人可编辑被指派任务，但不能编辑产品需求", true);
  const baseline = await call(qa!.token, "requirementChange.context", { workItemId: req.id });
  const tc = await call(qa!.token, "testCase.create", { projectId: project.id, title: "交接测试", status: "READY", requirements: [{ workItemId: req.id, revisionId: baseline.baseRevision.id }], steps: [{ action: "按最新规则验证", expected: "满足验收" }] });
  const context = await call(pm!.token, "requirementChange.context", { workItemId: req.id });
  let change = await call(pm!.token, "requirementChange.create", { workItemId: req.id, baseRevisionId: context.baseRevision.id, expectedWorkItemVersion: context.workItemVersion, impactFingerprint: context.impactFingerprint, title: "多角色需求", description: "第二版验收规则", reason: "测试边界调整" });
  check("需求变更识别开发任务与固定基线用例", change.impacts.some((i: { targetId: string }) => i.targetId === task.id) && change.impacts.some((i: { targetId: string }) => i.targetId === tc.id));
  await call(dev!.token, "requirementChange.decide", { workItemId: req.id, changeId: change.id, expectedVersion: change.version, decision: "APPROVE" }, "FORBIDDEN");
  change = await call(pm!.token, "requirementChange.decide", { workItemId: req.id, changeId: change.id, expectedVersion: change.version, decision: "APPROVE", note: "产品复核范围" });
  change = await call(pm!.token, "requirementChange.apply", { workItemId: req.id, changeId: change.id, expectedVersion: change.version, expectedWorkItemVersion: req.version });
  for (const [token, targetId] of [[dev!.token, task.id], [qa!.token, tc.id]] as const) {
    change = await call(token, "requirementChange.acknowledge", { workItemId: req.id, changeId: change.id, expectedVersion: change.version, impactId: change.impacts.find((i: { targetId: string }) => i.targetId === targetId).id, note: "已核对影响，按新规则处理" });
  }
  check("产品批准后开发与测试独立确认影响，保留最初用例基线", change.impacts.filter((i: { acknowledgedBy: string }) => [devMember!.id, qaMember!.id].includes(i.acknowledgedBy)).length === 2 && (await call(qa!.token, "testCase.get", { projectId: project.id, caseId: tc.id })).revision.requirements[0].revisionId === baseline.baseRevision.id);
  task = await item(dev!.token, task.id);
  const racing = await Promise.all(["修改A", "修改B"].map(title => rpc(dev!.token, "workitem.update", { workItemId: task.id, expectedVersion: task.version, title })));
  assert.equal(racing.filter(r => !r.error).length, 1, JSON.stringify(racing));
  check("同版本并发更新仅一个成功且另一个返回冲突", racing.some(r => r.data?.code === "VERSION_CONFLICT"));
  task = await item(dev!.token, task.id);
  const commentArgs = { workItemId: task.id, body: "实现已完成，交测试", idempotencyKey: "handoff-comment" };
  const comment = await call(dev!.token, "workitem.comment", commentArgs);
  assert.equal((await call(dev!.token, "workitem.comment", commentArgs)).id, comment.id);
  await transition(dev!.token, task.id, "DONE");
  check("开发完成与重复回写保留同一评论", true);

  let plan = await call(qa!.token, "testPlan.create", { projectId: project.id, title: "交接测试计划", build: "isolated-build-before", environment: "isolated-http", cases: [{ caseId: tc.id, revisionId: tc.currentRevisionId }] });
  await call(dev!.token, "testPlan.transition", { projectId: project.id, planId: plan.id, expectedVersion: plan.version, action: "START" }, "FORBIDDEN");
  plan = await call(qa!.token, "testPlan.transition", { projectId: project.id, planId: plan.id, expectedVersion: plan.version, action: "START" });
  let failed = await call(qa!.token, "testRun.start", { projectId: project.id, planId: plan.id, planCaseId: plan.cases[0].id, source: "AUTOMATION", sourceReference: "isolated-team-fixture" });
  failed = await call(qa!.token, "testRun.record", { projectId: project.id, runId: failed.id, expectedVersion: failed.version, results: [{ stepIndex: 0, status: "FAILED", actual: "模拟边界回归未满足；夹具结果" }] });
  failed = await call(qa!.token, "testRun.complete", { projectId: project.id, runId: failed.id, expectedVersion: failed.version });
  const defect = (await call(qa!.token, "testRun.createDefect", { projectId: project.id, runId: failed.id, title: "组合验收模拟缺陷" })).defect;
  assert.equal((await call(qa!.token, "testRun.createDefect", { projectId: project.id, runId: failed.id, title: "组合验收模拟缺陷" })).defect.id, defect.id);
  await call(pm!.token, "workitem.assign", { workItemId: defect.id, assigneeId: devMember!.id });
  await transition(dev!.token, defect.id, "IN_PROGRESS");
  await transition(dev!.token, defect.id, "FIXED");
  let retest = await call(qa!.token, "testRun.start", { projectId: project.id, planId: plan.id, planCaseId: plan.cases[0].id, retestOf: failed.id, build: "isolated-build-fixed", environment: "isolated-http", source: "AUTOMATION", sourceReference: "isolated-team-fixture" });
  retest = await call(qa!.token, "testRun.record", { projectId: project.id, runId: retest.id, expectedVersion: retest.version, results: [{ stepIndex: 0, status: "PASSED", actual: "模拟修复后边界满足；夹具结果" }] });
  retest = await call(qa!.token, "testRun.complete", { projectId: project.id, runId: retest.id, expectedVersion: retest.version });
  check("新构建复测继承原失败与缺陷，未自动关闭缺陷", retest.status === "PASSED" && retest.retestOf === failed.id && retest.build !== failed.build && retest.defects.some((d: { id: string }) => d.id === defect.id) && (await item(qa!.token, defect.id)).statusKey === "FIXED");
  await transition(qa!.token, defect.id, "VERIFIED");
  await transition(qa!.token, defect.id, "CLOSED");
  await call(qa!.token, "testRun.record", { projectId: project.id, runId: failed.id, expectedVersion: failed.version, results: [{ stepIndex: 0, status: "PASSED", actual: "不能覆盖旧失败" }] }, "BLOCKED_BY_PREREQUISITE");
  plan = await call(qa!.token, "testPlan.get", { projectId: project.id, planId: plan.id });
  await call(qa!.token, "testPlan.transition", { projectId: project.id, planId: plan.id, expectedVersion: plan.version, action: "COMPLETE" });
  await transition(pm!.token, req.id, "DELIVERED");
  await transition(pm!.token, req.id, "VERIFIED");
  check("测试单独验证并关闭缺陷，产品单独验收需求", (await item(pm!.token, req.id)).statusKey === "VERIFIED" && (await call(qa!.token, "testRun.get", { projectId: project.id, runId: failed.id })).status === "FAILED");
  const accepted = await item(pm!.token, req.id);
  check("需求验收进入终态并记录完成时间", accepted.statusCategory === "TERMINAL" && !!accepted.completedAt);
  await transition(pm!.token, req.id, "IN_PROGRESS");
  check("需求重开恢复处理中并清除完成时间", (await item(pm!.token, req.id)).completedAt === null);

  let transferred = await call(pm!.token, "workitem.create", { projectId: project.id, type: "TASK", title: "转派后权限", assigneeId: devMember!.id });
  await call(pm!.token, "workitem.assign", { workItemId: transferred.id, assigneeId: qaMember!.id });
  transferred = await item(dev!.token, transferred.id);
  await call(dev!.token, "workitem.update", { workItemId: transferred.id, expectedVersion: transferred.version, description: "原负责人不能继续编辑" }, "FORBIDDEN");
  const readOnlyItem = await call(pm!.token, "workitem.create", { projectId: project.id, type: "TASK", title: "撤权后负责人", assigneeId: devMember!.id });
  await roles.deleteRoleAssignment(admin, dev!.assignment.id);
  await roles.createRoleAssignment(admin, { memberId: devMember!.id, roleId: allRoles.find(r => r.key === "GUEST")!.id, scopeType: "PROJECT", scopeId: project.id });
  await call(dev!.token, "workitem.update", { workItemId: readOnlyItem.id, expectedVersion: readOnlyItem.version, title: "只读负责人不能写" }, "FORBIDDEN");
  check("转派与降为只读角色后旧负责人的编辑权限立即失效", true);
  await call(dev!.token, "workitem.comment", commentArgs, "FORBIDDEN");
  check("撤回角色后同令牌幂等重放立即被拒绝", true);
  await tokens.revokeToken(admin, qa!.row.id);
  const revoked = await rpc(qa!.token, "testRun.get", { projectId: project.id, runId: failed.id });
  check("撤销令牌后不能继续读历史执行", revoked.status === 401);
  const events = await sql`select distinct actor_id::text id from audit_entry where actor_id in (${pmMember!.id},${devMember!.id},${qaMember!.id})`;
  check("审计保留三个真实账号身份", events.length === 3);
  console.log(`team handoff passed: ${checks} checks`);
} finally { await app.close(); await sql.end({ timeout: 5 }); }
