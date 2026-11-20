import "./_env.ts";
/** 真实 HTTP MCP 项目管理闭环；临时账号/项目、契约、确认、档位、范围和策略反控。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, mcpClient } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import * as policies from "../src/server/services/mcp-client.service.ts";
import * as progress from "../src/server/services/milestone-detail.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const required = ["project.create", "project.update", "project.setStatus", "project.listMemberRoles", "project.addMember", "project.updateMember", "project.removeMember", "member.list", "plan.getIterationCapacity", "plan.setIterationCapacity", "plan.listMilestoneProgress", "plan.addMilestoneProgress", "plan.deleteMilestoneProgress"];
let checks = 0, rpcId = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
await ensureInitialized();
const app = await buildApp({ logger: false });
async function rpc(token: string, method: string, params: object = {}) {
  const response = await fetch(`${process.env.BASE}/api/v1/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  assert.notEqual(response.status, 429, "MCP 限流：停止本轮，不重试");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result;
}
async function call(token: string, name: string, args: Record<string, unknown>, error?: string) {
  const result = await rpc(token, "tools/call", { name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true, name); assert.equal(data.code, error, JSON.stringify(data)); }
  else { assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`); assert.deepEqual(result.structuredContent, data); }
  return data;
}
try {
  await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
  const roles = await db.select().from(role);
  const adminRole = roles.find(row => row.key === "ADMIN")!;
  const memberRole = roles.find(row => row.key === "MEMBER")!;
  const guestRole = roles.find(row => row.key === "GUEST")!;
  const [adminRow, ordinaryRow] = await db.insert(member).values([
    { username: `pm-admin-${marker}`, name: "项目管理管理员", status: "ACTIVE", passwordHash: "isolated-service-fixture" },
    { username: `pm-member-${marker}`, name: "项目管理成员", status: "ACTIVE", passwordHash: "isolated-service-fixture" },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const global = await tokens.createToken(admin, { name: "项目管理全账号", tier: "READ_WRITE", projectWhitelist: [] });
  const allRead = await tokens.createToken(admin, { name: "项目管理全账号只读", tier: "READ_ONLY", projectWhitelist: [] });
  const listed = await rpc(global.token, "tools/list");
  check("13项项目管理能力公开严格输入输出契约", required.every(name => listed.tools.some((tool: { name: string; inputSchema: { additionalProperties?: boolean }; outputSchema?: { additionalProperties?: boolean } }) => tool.name === name && tool.inputSchema.additionalProperties === false && tool.outputSchema?.additionalProperties === false)));

  await call(global.token, "project.create", { key: `PM${marker}`, name: "项目闭环", userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
  await call(global.token, "project.create", { key: `PM${marker}`, name: "项目闭环", userConfirmed: "true" }, "VALIDATION");
  await call(allRead.token, "project.create", { key: `PM${marker}`, name: "项目闭环", userConfirmed: true }, "FORBIDDEN");
  const project = await call(global.token, "project.create", { key: `PM${marker}`, name: "项目闭环", userConfirmed: true });
  const outside = await projects.createProject(admin, { key: `PO${marker}`, name: "另一项目" });
  const scoped = await tokens.createToken(admin, { name: "项目管理限定项目", tier: "READ_WRITE", projectWhitelist: [project.id] });
  const read = await tokens.createToken(admin, { name: "项目管理限定只读", tier: "READ_ONLY", projectWhitelist: [project.id] });
  const scope = { projectId: project.id };
  const confirm = { ...scope, userConfirmed: true };
  check("MCP创建项目可回读自动复制工作流", (await call(read.token, "project.get", scope)).workflows.length > 0);
  await call(scoped.token, "project.create", { key: `PX${marker}`, name: "不能越过白名单创建", userConfirmed: true }, "FORBIDDEN");
  await call(scoped.token, "member.list", {}, "FORBIDDEN");
  const directory = await call(allRead.token, "member.list", {});
  check("全账号令牌可发现待加入组织成员", directory.members.some((row: { id: string }) => row.id === ordinaryRow!.id));
  const [globalClient] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, global.row.id));
  for (const [name, args] of [["member.list", {}], ["project.create", { key: `PD${marker}`, name: "策略禁止创建", userConfirmed: true }]] as const) {
    await policies.replaceClientPolicies(admin, globalClient!.id, [{ toolName: name, effect: "DENY" }]);
    await call(global.token, name, args, "FORBIDDEN");
  }
  await policies.replaceClientPolicies(admin, globalClient!.id, []);
  check("组织级成员发现与项目创建遵循工具DENY", !(await projects.listVisibleFor(admin, { page: 1, pageSize: 100 })).items.some(row => row.key === `PD${marker}`));
  const roleList = await call(scoped.token, "project.listMemberRoles", scope);
  check("项目成员管理可发现可分配角色ID", roleList.roles.some((row: { id: string }) => row.id === memberRole.id));

  await call(scoped.token, "project.update", { ...confirm, name: "更新后的项目", description: "MCP验收描述" });
  const updated = await call(read.token, "project.get", scope);
  check("项目更新后服务与MCP都可复读", updated.name === "更新后的项目" && (await projects.getProjectDetail(admin, project.id)).description === "MCP验收描述");
  await call(scoped.token, "project.update", { ...confirm, key: "RENAMED" }, "VALIDATION");
  await call(scoped.token, "project.setStatus", { ...confirm, statusKey: "ACTIVE" });
  check("项目状态流转可回读当前状态", (await call(read.token, "project.get", scope)).status.key === "ACTIVE");
  await call(scoped.token, "project.setStatus", { ...confirm, statusKey: "PLANNED" }, "VALIDATION");

  const add = { ...confirm, memberId: ordinaryRow!.id, roleIds: [memberRole.id] };
  await call(scoped.token, "project.addMember", add);
  check("新增项目成员后名单可回读", (await call(read.token, "project.members", scope)).members.some((row: { id: string }) => row.id === ordinaryRow!.id));
  await call(scoped.token, "project.updateMember", { ...add, roleIds: [guestRole.id] });
  const assigned = await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, ordinaryRow!.id));
  check("成员换角色复读且旧授权被清除", assigned.length === 1 && assigned[0]!.roleId === guestRole.id);
  const ordinary = (await loadActor(ordinaryRow!.id))!;
  const ordinaryToken = await tokens.createToken(ordinary, { name: "访客读写档位反控", tier: "READ_WRITE", projectWhitelist: [project.id] });
  await call(ordinaryToken.token, "project.update", { ...confirm, name: "访客不可修改" }, "FORBIDDEN");
  await call(ordinaryToken.token, "project.addMember", add, "FORBIDDEN");
  await call(ordinaryToken.token, "project.listMemberRoles", scope, "FORBIDDEN");
  check("读写令牌仍受账号项目权限约束", (await call(read.token, "project.get", scope)).name === "更新后的项目");

  const iteration = (await plans.createPlan(admin, project.id, "iteration", { name: "容量迭代", startDate: "2026-11-19", endDate: "2026-11-30" }))!;
  const foreignIteration = (await plans.createPlan(admin, outside.id, "iteration", { name: "越界迭代", startDate: "2026-11-19", endDate: "2026-11-30" }))!;
  const capacity = { ...confirm, iterationId: iteration.id, memberId: ordinaryRow!.id, capacityPoints: 13 };
  await call(ordinaryToken.token, "plan.setIterationCapacity", capacity, "FORBIDDEN");
  await call(scoped.token, "plan.setIterationCapacity", capacity);
  check("迭代容量写入后读取真实数值", (await call(read.token, "plan.getIterationCapacity", { ...scope, iterationId: iteration.id })).members.some((row: { memberId: string; capacityPoints: number }) => row.memberId === ordinaryRow!.id && row.capacityPoints === 13));
  await call(scoped.token, "plan.setIterationCapacity", { ...capacity, capacityHours: 8 }, "VALIDATION");
  await call(scoped.token, "plan.getIterationCapacity", { ...scope, iterationId: foreignIteration.id }, "NOT_FOUND");
  await call(global.token, "plan.setIterationCapacity", { ...capacity, iterationId: foreignIteration.id }, "NOT_FOUND");
  check("显式项目不能夹带另一项目迭代", !(await plans.getIterationCapacity(admin, foreignIteration.id)).members.some(row => row.memberId === ordinaryRow!.id));

  const milestone = (await plans.createPlan(admin, project.id, "milestone", { name: "结构化进展里程碑" }))!;
  const foreignMilestone = (await plans.createPlan(admin, outside.id, "milestone", { name: "越界进展里程碑" }))!;
  const foreignProgress = (await progress.addProgressUpdate(admin, foreignMilestone.id, { summary: "必须保留的其他项目记录" }))!;
  const progressInput = { ...confirm, milestoneId: milestone.id, summary: "已完成联调", nextSteps: "准备发布", blockers: "等待评审" };
  await call(ordinaryToken.token, "plan.addMilestoneProgress", progressInput, "FORBIDDEN");
  const note = await call(scoped.token, "plan.addMilestoneProgress", progressInput);
  const notes = await call(read.token, "plan.listMilestoneProgress", { ...scope, milestoneId: milestone.id });
  check("里程碑结构化进展写后复读三个字段", notes.updates.some((row: { id: string; summary: string; nextSteps: string; blockers: string }) => row.id === note.id && row.summary === progressInput.summary && row.nextSteps === progressInput.nextSteps && row.blockers === progressInput.blockers));
  await call(scoped.token, "plan.listMilestoneProgress", { ...scope, milestoneId: foreignMilestone.id }, "NOT_FOUND");
  await call(global.token, "plan.addMilestoneProgress", { ...progressInput, milestoneId: foreignMilestone.id }, "NOT_FOUND");
  await call(scoped.token, "plan.deleteMilestoneProgress", { ...confirm, milestoneId: milestone.id, progressUpdateId: foreignProgress.id }, "NOT_FOUND");
  check("删除进展不能夹带其他项目记录", (await progress.milestoneDetail(admin, foreignMilestone.id)).progressUpdates.some(row => row.id === foreignProgress.id));

  const writeCases = [
    ["project.update", { ...confirm, name: "被阻止的修改" }], ["project.setStatus", { ...confirm, statusKey: "COMPLETED" }],
    ["project.addMember", add], ["project.updateMember", add], ["project.removeMember", { ...confirm, memberId: ordinaryRow!.id }],
    ["plan.setIterationCapacity", capacity], ["plan.addMilestoneProgress", progressInput],
    ["plan.deleteMilestoneProgress", { ...confirm, milestoneId: milestone.id, progressUpdateId: note.id }],
  ] as const;
  for (const [name, args] of writeCases) {
    await call(scoped.token, name, { ...args, userConfirmed: false }, "COMMAND_CONFIRMATION_REQUIRED");
    await call(read.token, name, args, "FORBIDDEN");
    await call(scoped.token, name, { ...args, projectId: outside.id }, "NOT_FOUND");
  }
  check("全部8项项目写操作校验确认、只读和项目白名单", true);
  const [client] = await db.select().from(mcpClient).where(eq(mcpClient.tokenId, scoped.row.id));
  for (const [name, args] of writeCases) {
    await policies.replaceClientPolicies(admin, client!.id, [{ toolName: name, effect: "DENY" }]);
    await call(scoped.token, name, args, "FORBIDDEN");
  }
  await policies.replaceClientPolicies(admin, client!.id, []);
  check("全部新增项目写工具执行工具级DENY", true);
  await call(scoped.token, "plan.deleteMilestoneProgress", { ...confirm, milestoneId: milestone.id, progressUpdateId: note.id });
  check("删除结构化进展后读取确认消失", (await call(read.token, "plan.listMilestoneProgress", { ...scope, milestoneId: milestone.id })).updates.length === 0);
  await call(scoped.token, "project.removeMember", { ...confirm, memberId: ordinaryRow!.id });
  check("移除项目成员后名单和权限指派同时消失", !(await call(read.token, "project.members", scope)).members.some((row: { id: string }) => row.id === ordinaryRow!.id) && (await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, ordinaryRow!.id))).length === 0);
  await call(scoped.token, "project.updateMember", add, "NOT_FOUND");
  check("更新已移除成员不会隐式重新加入", !(await call(read.token, "project.members", scope)).members.some((row: { id: string }) => row.id === ordinaryRow!.id));
  console.log(`MCP项目管理闭环 ${checks}/${checks}`);
} finally { await app.close(); await sql.end({ timeout: 5 }); }
