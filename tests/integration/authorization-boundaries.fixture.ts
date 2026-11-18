import assert from "node:assert/strict";
import Fastify from "fastify";
import type { Actor } from "../../src/server/permission/actor.ts";
// 不读取 .env；只有本次隔离 runner 随机创建的库能运行此夹具。
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, department, team, workItem, comment, page, idea, milestone, iteration, release, module: moduleTable, approvalRequest } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { can } = await import("../../src/server/permission/engine.ts");
const projectService = await import("../../src/server/services/project.service.ts");
const workItems = await import("../../src/server/services/work-item.service.ts");
const planning = await import("../../src/server/services/planning.service.ts");
const { registerPlanningRoutes } = await import("../../src/server/routes/planning.ts");
const { TOOLS, WRITE_TOOLS } = await import("../../src/server/mcp/server.ts");
const { projectForMcpResource } = await import("../../src/server/services/mcp-resource.service.ts");
const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const permissionContext = (actor: Actor) => ({ memberId: actor.memberId, memberTeamIds: new Set<string>(), memberProjectIds: new Set<string>() });

async function makeMember(username: string) {
  const [row] = await db.insert(member).values({ username, name: username, passwordHash: "isolated-no-login", status: "ACTIVE" }).returning();
  return row!;
}
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [readerRole] = await db.select().from(role).where(eq(role.key, "GUEST"));
  assert.ok(adminRole && readerRole);
  const admin = await makeMember("boundary-admin");
  await db.insert(roleAssignment).values({ memberId: admin.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const actor = (await loadActor(admin.id))!;
  const [deptA, deptB] = await db.insert(department).values([{ name: "部门 A" }, { name: "部门 B" }]).returning();
  const [deptChild] = await db.insert(department).values({ name: "部门 A 子部门", parentId: deptA!.id }).returning();
  const projectA = await projectService.createProject(actor, { key: "BOUNDARYA", name: "A", departmentId: deptA!.id });
  const projectB = await projectService.createProject(actor, { key: "BOUNDARYB", name: "B", departmentId: deptB!.id });
  const projectChild = await projectService.createProject(actor, { key: "BOUNDARYCHILD", name: "A child", departmentId: deptChild!.id });
  const itemA = (await workItems.createWorkItem(actor, projectA.id, { type: "TASK", title: "A original" }))!;
  const itemB = (await workItems.createWorkItem(actor, projectB.id, { type: "TASK", title: "B original" }))!;

  const emptyUser = await makeMember("boundary-empty");
  const [emptyRole] = await db.insert(role).values({ key: "custom:empty-boundary", name: "empty" }).returning();
  await db.insert(roleAssignment).values([
    { memberId: emptyUser.id, roleId: emptyRole!.id, scopeType: "ORG", scopeId: null },
    { memberId: emptyUser.id, roleId: adminRole.id, scopeType: "PROJECT", scopeId: projectA.id },
  ]);
  const emptyActor = (await loadActor(emptyUser.id))!;
  assert.equal(emptyActor.rolePermissions!.get(emptyRole!.key)!.size, 0);
  assert.equal(can(emptyActor, "work_item:update_any", { projectId: projectB.id }, permissionContext(emptyActor)), false);
  await assert.rejects(workItems.updateWorkItem(emptyActor, itemB.id, { version: itemB.version, title: "forbidden" }), errorCode("FORBIDDEN"));

  const departmentUser = await makeMember("boundary-department");
  await db.insert(roleAssignment).values([
    { memberId: departmentUser.id, roleId: adminRole.id, scopeType: "DEPARTMENT", scopeId: deptA!.id },
    { memberId: departmentUser.id, roleId: readerRole.id, scopeType: "DEPARTMENT", scopeId: deptB!.id },
  ]);
  const departmentActor = (await loadActor(departmentUser.id))!;
  assert.equal(can(departmentActor, "work_item:update_any", { projectId: projectA.id }, permissionContext(departmentActor)), true);
  assert.equal(can(departmentActor, "work_item:update_any", { projectId: projectChild.id }, permissionContext(departmentActor)), true);
  assert.equal(can(departmentActor, "work_item:update_any", { projectId: projectB.id }, permissionContext(departmentActor)), false);
  await assert.rejects(workItems.updateWorkItem(departmentActor, itemB.id, { version: itemB.version, title: "forbidden" }), errorCode("FORBIDDEN"));

  const [teamA, teamB] = await db.insert(team).values([{ name: "team A" }, { name: "team B" }]).returning();
  const [teamChild] = await db.insert(team).values({ name: "team child", parentId: teamA!.id }).returning();
  await db.insert(roleAssignment).values([
    { memberId: departmentUser.id, roleId: adminRole.id, scopeType: "TEAM", scopeId: teamA!.id },
    { memberId: departmentUser.id, roleId: readerRole.id, scopeType: "TEAM", scopeId: teamB!.id },
  ]);
  const teamActor = (await loadActor(departmentUser.id))!;
  assert.equal(can(teamActor, "work_item:update_any", { projectId: null, teamId: teamChild!.id }, permissionContext(teamActor)), true);
  assert.equal(can(teamActor, "work_item:update_any", { projectId: null, teamId: teamB!.id }, permissionContext(teamActor)), false);

  const reader = await makeMember("boundary-reader");
  await db.insert(roleAssignment).values({ memberId: reader.id, roleId: readerRole.id, scopeType: "ORG", scopeId: null });
  const readerActor = (await loadActor(reader.id))!;
  let requestActor = readerActor;
  const app = Fastify();
  app.decorate("csrfProtection", async () => {});
  app.addHook("preHandler", async (req) => { req.actor = requestActor; });
  app.setErrorHandler((error, _req, reply) => { const err = error as { httpStatus: number; code: string }; reply.status(err.httpStatus ?? 500).send({ code: err.code }); });
  await registerPlanningRoutes(app);
  try {
    for (const kind of ["milestone", "iteration", "release", "module"] as const) {
      const row = await planning.createPlan(actor, projectA.id, kind, { name: `original-${kind}`, ...(kind === "iteration" ? { startDate: "2026-11-01", endDate: "2026-11-30" } : {}) });
      assert.ok(row);
      requestActor = readerActor;
      const denied = await app.inject({ method: "PATCH", url: `/api/v1/${kind}s/${row.id}`, payload: { name: "forbidden" } });
      assert.equal(denied.statusCode, 403, `${kind}: ${denied.body}`);
      assert.equal((await planning.get(actor, row.id, kind)).name, `original-${kind}`);
      requestActor = actor;
      const allowed = await app.inject({ method: "PATCH", url: `/api/v1/${kind}s/${row.id}`, payload: { name: `updated-${kind}` } });
      assert.equal(allowed.statusCode, 200, `${kind}: ${allowed.body}`);
      assert.equal((await planning.get(actor, row.id, kind)).name, `updated-${kind}`);
      await assert.rejects(planning.updatePlan(actor, row.id, kind, { projectId: projectB.id }), errorCode("VALIDATION"));
    }
  } finally { await app.close(); }

  const [commentB] = await db.insert(comment).values({ targetType: "WORK_ITEM", targetId: itemB.id, authorId: actor.memberId, body: "comment B" }).returning();
  const [pageB] = await db.insert(page).values({ projectId: projectB.id, title: "page B", slug: "page-b" }).returning();
  const [ideaB] = await db.insert(idea).values({ projectId: projectB.id, title: "idea B", submittedByMemberId: actor.memberId }).returning();
  const [milestoneB] = await db.insert(milestone).values({ projectId: projectB.id, name: "milestone B" }).returning();
  const [iterationB] = await db.insert(iteration).values({ projectId: projectB.id, name: "iteration B", startDate: "2026-11-01", endDate: "2026-11-30" }).returning();
  const [releaseB] = await db.insert(release).values({ projectId: projectB.id, name: "release B" }).returning();
  const [moduleB] = await db.insert(moduleTable).values({ projectId: projectB.id, name: "module B" }).returning();
  const [approvalB] = await db.insert(approvalRequest).values({ workItemId: itemB.id, workflowId: itemB.workflowId, fromStateId: itemB.statusId, toStateId: itemB.statusId, requestedBy: actor.memberId }).returning();
  for (const [kind, id] of [["workItem", itemB.id], ["comment", commentB!.id], ["page", pageB!.id], ["idea", ideaB!.id], ["milestone", milestoneB!.id], ["iteration", iterationB!.id], ["release", releaseB!.id], ["module", moduleB!.id], ["approval", approvalB!.id]] as const) {
    assert.equal(await projectForMcpResource(kind, id), projectB.id, kind);
  }
  const ctx = { actor, token: { memberId: actor.memberId, tokenId: "unused-direct-handler", tier: "ADMIN" as const, projectWhitelist: [projectA.id] } };
  const tool = (name: string) => [...TOOLS, ...WRITE_TOOLS].find((entry) => entry.name === name)!;
  const deniedCalls: [string, Record<string, unknown>][] = [
    ["workitem.create", { projectId: projectB.id, type: "TASK", title: "blocked" }],
    ["workitem.update", { workItemId: itemB.id, expectedVersion: itemB.version, title: "blocked" }],
    ["workitem.assign", { workItemId: itemB.id }],
    ["workitem.transition", { workItemId: itemB.id, toStateKey: "DONE", version: itemB.version }],
    ["workitem.comment", { workItemId: itemB.id, body: "blocked" }],
    ["workitem.link", { fromWorkItemId: itemA.id, toWorkItemId: itemB.id, type: "RELATES_TO" }],
    ["comment.update", { commentId: commentB!.id, body: "blocked" }],
    ["comment.delete", { commentId: commentB!.id }],
    ["idea.submit", { projectId: projectB.id, title: "blocked" }],
    ["idea.vote", { ideaId: ideaB!.id }], ["idea.promote", { ideaId: ideaB!.id }],
    ["page.create", { projectId: projectB.id, title: "blocked" }], ["page.update", { pageId: pageB!.id, title: "blocked", expectedRevisionId: pageB!.currentRevisionId, userConfirmed: true }],
    ["plan.createMilestone", { projectId: projectB.id, name: "blocked" }],
    ["plan.createIteration", { projectId: projectB.id, name: "blocked", startDate: "2026-11-01", endDate: "2026-11-30" }],
    ["plan.createRelease", { projectId: projectB.id, name: "blocked" }], ["plan.createModule", { projectId: projectB.id, name: "blocked" }],
    ["sla.pause", { workItemId: itemB.id }], ["sla.resume", { workItemId: itemB.id }],
    ["approval.approve", { approvalId: approvalB!.id }], ["approval.reject", { approvalId: approvalB!.id }],
    ["automation.createRule", { projectId: projectB.id, name: "blocked", trigger: "WORK_ITEM_CREATED", actions: [{ type: "NOTIFY" }] }],
    ["workitem.create", { projectId: projectA.id, type: "TASK", title: "blocked", milestoneId: milestoneB!.id }],
  ];
  for (const [name, args] of deniedCalls) await assert.rejects(tool(name).handler(ctx, args), errorCode("NOT_FOUND"), name);
  for (const name of ["notification.list", "notification.markRead"]) await assert.rejects(tool(name).handler(ctx, {}), errorCode("FORBIDDEN"));
  await assert.rejects(tool("announcement.send").handler(ctx, { title: "blocked", body: "blocked" }), errorCode("FORBIDDEN"));
  for (const extra of [{ statusId: itemA.statusId }, { projectId: projectB.id }, { reporterId: reader.id }]) {
    await assert.rejects(tool("workitem.update").handler(ctx, { workItemId: itemA.id, expectedVersion: itemA.version, ...extra }), errorCode("VALIDATION"));
    await assert.rejects(workItems.updateWorkItem(actor, itemA.id, { version: itemA.version, ...extra }), errorCode("VALIDATION"));
  }
  await tool("workitem.update").handler(ctx, { workItemId: itemA.id, expectedVersion: itemA.version, title: "allowed update" });
  assert.equal((await workItems.getWorkItem(actor, itemA.id)).title, "allowed update");
  const [unchanged] = await db.select().from(workItem).where(eq(workItem.id, itemB.id));
  assert.equal(unchanged!.title, "B original");
  console.log("authorization boundary contracts passed");
} finally { await sql.end({ timeout: 5 }); }
