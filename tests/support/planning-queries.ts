import assert from "node:assert/strict";
import Fastify from "fastify";

// 必须是本轮随机隔离库，禁止脚本读取开发环境兜底配置。
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, workItem, workflow, workflowState, iteration } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const projectService = await import("../../src/server/services/project.service.ts");
const workItemService = await import("../../src/server/services/work-item.service.ts");
const planningService = await import("../../src/server/services/planning-view.service.ts");
const plans = await import("../../src/server/services/planning.service.ts");
const app = Fastify();

try {
  const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
  assert.ok(adminRole);
  const [admin] = await db.insert(member).values({ username: "planning-query-admin", name: "查询验收", email: "planning-query@example.invalid", passwordHash: "isolated-no-login", status: "ACTIVE" }).returning();
  assert.ok(admin);
  await db.insert(roleAssignment).values({ memberId: admin.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const actor = await loadActor(admin.id);
  assert.ok(actor);
  const project = await projectService.createProject(actor, { key: "QUERY", name: "隔离查询测试" });
  const expectedHigh: string[] = [];
  const expectedUnscheduled: string[] = [];
  for (let index = 1; index <= 31; index += 1) {
    const item = await workItemService.createWorkItem(actor, project.id, { type: "TASK", title: `搜索命中 ${index}`, priority: "HIGH" });
    expectedHigh.push(item.id); expectedUnscheduled.push(item.id);
  }
  const low = await workItemService.createWorkItem(actor, project.id, { type: "TASK", title: "搜索命中 low", priority: "LOW" });
  expectedUnscheduled.push(low.id);
  for (const dates of [{ startDate: "2026-11-05" }, { dueDate: "2026-11-07" }]) {
    const item = await workItemService.createWorkItem(actor, project.id, { type: "TASK", title: "搜索命中 已排期", priority: "HIGH", ...dates });
    expectedHigh.push(item.id);
  }
  await workItemService.createWorkItem(actor, project.id, { type: "TASK", title: "其他目标", priority: "HIGH", startDate: "2026-11-05", dueDate: "2026-11-07" });
  const deleted = await workItemService.createWorkItem(actor, project.id, { type: "TASK", title: "搜索命中 已删除", priority: "HIGH" });
  await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, deleted.id));

  const board = await workItemService.loadBoard(actor, project.id, 25, { q: "搜索命中", priority: "HIGH" });
  const column = board.find((entry) => entry.count > 0);
  assert.ok(column);
  assert.equal(column.count, 33);
  assert.equal(column.items.length, 25);
  const later = await workItemService.loadBoardColumn(actor, project.id, column.stateKey, 25, 25, { q: "搜索命中", priority: "HIGH" });
  assert.equal(later.count, 33);
  assert.equal(later.items.length, 8);
  assert.deepEqual([...column.items, ...later.items].map((item) => item.id).sort(), expectedHigh.sort());
  const noMatches = await workItemService.loadBoard(actor, project.id, 25, { q: "不存在" });
  assert.equal(noMatches.reduce((total, entry) => total + entry.count, 0), 0);

  const first = await planningService.table(actor, project.id, { unscheduled: true, page: 1, pageSize: 30 });
  const [expectedState] = await db.select().from(workflowState).where(eq(workflowState.id, first.rows[0]!.statusId));
  assert.ok(expectedState);
  assert.equal(first.rows[0]!.statusName, expectedState.name);
  assert.equal(first.rows[0]!.statusCategory, expectedState.category);
  assert.equal(first.rows[0]!.statusKey, expectedState.key);
  assert.equal(first.rows[0]!.assigneeName, null, "未指派工作项不能因关联查询丢失");
  const second = await planningService.table(actor, project.id, { unscheduled: true, page: 2, pageSize: 30 });
  assert.equal(first.total, 32); assert.equal(second.total, 32);
  assert.equal(first.rows.length, 30); assert.equal(second.rows.length, 2);
  assert.deepEqual([...first.rows, ...second.rows].map((item) => item.id).sort(), expectedUnscheduled.sort());
  assert.equal((await planningService.table(actor, project.id, { unscheduled: false })).total, 35);

  // 两套任务工作流复用状态 key：聚合总数和首屏/下一页必须覆盖同一集合。
  const original = await workItemService.getWorkItem(actor, low.id);
  const [sourceState] = await db.select().from(workflowState).where(eq(workflowState.id, original.statusId));
  assert.ok(sourceState);
  const [alternate] = await db.insert(workflow).values({ projectId: project.id, name: "备用任务流程", appliesToType: "TASK", isDefault: false, isBuiltin: false }).returning();
  assert.ok(alternate);
  const [alternateState] = await db.insert(workflowState).values({ workflowId: alternate.id, key: sourceState.key, name: "备用待办", category: "NOT_STARTED", color: "neutral", sortOrder: 0, wipLimit: 3 }).returning();
  assert.ok(alternateState);
  await db.update(workflowState).set({ wipLimit: 40 }).where(eq(workflowState.id, sourceState.id));
  const alternateIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const item = await workItemService.createWorkItem(actor, project.id, { type: "TASK", title: `搜索命中 备用 ${i}`, priority: "HIGH" });
    await db.update(workItem).set({ workflowId: alternate.id, statusId: alternateState.id }).where(eq(workItem.id, item.id));
    alternateIds.push(item.id);
  }
  const { boardQuerySchema } = await import("../../src/shared/schemas/work-item.ts");
  const filter = boardQuerySchema.parse({ type: "TASK", workflowId: alternate.id, q: "搜索命中", priority: "HIGH" });
  assert.equal(filter.type, "TASK"); assert.equal(filter.workflowId, alternate.id);
  const combined = await workItemService.loadBoard(actor, project.id, 25, { q: "搜索命中", priority: "HIGH", type: "TASK" });
  const combinedColumn = combined.find(c => c.stateKey === sourceState.key);
  assert.ok(combinedColumn);
  assert.equal(combined.filter(c => c.stateKey === sourceState.key).length, 1);
  assert.equal(combinedColumn.count, 36); assert.equal(combinedColumn.items.length, 25);
  assert.equal(combinedColumn.wipLimit, null, "混合列不冒用某一个工作流的 WIP 上限");
  const combinedPage = await workItemService.loadBoardColumn(actor, project.id, sourceState.key, 25, 25, { q: "搜索命中", priority: "HIGH", type: "TASK" });
  assert.equal(combinedPage.count, 36); assert.equal(combinedPage.items.length, 11);
  assert.deepEqual([...combinedColumn.items, ...combinedPage.items].map(i => i.id).sort(), [...expectedHigh, ...alternateIds].sort());
  const selected = await workItemService.loadBoard(actor, project.id, 2, filter);
  assert.equal(selected.length, 1); assert.equal(selected[0]!.count, 3); assert.equal(selected[0]!.items.length, 2);
  assert.equal(selected[0]!.wipLimit, 3);
  const selectedPage = await workItemService.loadBoardColumn(actor, project.id, sourceState.key, 2, 25, filter);
  assert.equal(selectedPage.count, 3);
  assert.deepEqual([...selected[0]!.items, ...selectedPage.items].map(i => i.id).sort(), alternateIds.sort());
  const inherited = await workItemService.createWorkItem(actor, project.id, { type: "SUBTASK", parentId: low.id, title: "继承父任务工作流" });
  const subtasks = await workItemService.loadBoard(actor, project.id, 25, { type: "SUBTASK" });
  assert.deepEqual(subtasks.flatMap(c => c.items).map(i => i.id), [inherited.id]);
  assert.equal(subtasks.reduce((n, c) => n + c.count, 0), 1);
  const alienProject = await projectService.createProject(actor, { key: "ALIEN", name: "其它项目" });
  assert.equal((await workItemService.loadBoard(actor, alienProject.id, 25, { workflowId: alternate.id })).length, 0);
  assert.equal((await workItemService.loadBoardColumn(actor, alienProject.id, sourceState.key, 0, 25, { workflowId: alternate.id })).count, 0);

  // 计划范围要同时作用于rows和total，且不能通过跨项目ID扩大结果集。
  const planIds: Record<string, string> = {};
  for (const kind of ["iteration", "milestone", "release", "module"] as const) {
    const plan = await plans.createPlan(actor, project.id, kind, { name: `${kind}范围`, ...(kind === "iteration" ? { startDate: "2026-11-26", endDate: "2026-12-02" } : {}) });
    planIds[`${kind}Id`] = plan.id;
  }
  const scoped = [];
  for (let i = 0; i < 3; i++) scoped.push(await workItemService.createWorkItem(actor, project.id, { title: `范围内${i}`, type: "TASK", priority: "HIGH", ...planIds }));
  await workItemService.createWorkItem(actor, project.id, { title: "仅迭代", type: "TASK", iterationId: planIds.iterationId });
  const [outsider] = await db.insert(member).values({ username: "scope-outsider", name: "无权限", passwordHash: "no-login", status: "ACTIVE" }).returning();
  const denied = await loadActor(outsider!.id);
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async req => { req.actor = req.headers["x-outsider"] ? denied! : actor; });
  app.setErrorHandler((error, _req, reply) => { const e = error as { code: string; httpStatus: number }; reply.status(e.httpStatus ?? 400).send({ code: e.code }); });
  await (await import("../../src/server/routes/work-items.ts")).registerWorkItemRoutes(app);
  const tableUrl = `/api/v1/projects/${project.id}/work-items?view=table&`;
  for (const [field, id] of Object.entries(planIds)) {
    const response = await app.inject({ method: "GET", url: tableUrl + new URLSearchParams({ [field]: id, pageSize: "2" }) });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().total, field === "iterationId" ? 4 : 3);
    assert.equal(response.json().rows.length, 2);
  }
  const scopeParams = new URLSearchParams({ ...planIds, pageSize: "2", page: "2", type: "TASK", priority: "HIGH" });
  const scopedPage = await app.inject({ method: "GET", url: tableUrl + scopeParams });
  assert.equal(scopedPage.json().total, 3); assert.deepEqual(scopedPage.json().rows.map((r: { id: string }) => r.id), [scoped[2]!.id]);
  assert.equal((await app.inject({ method: "GET", url: tableUrl + scopeParams + "&unscheduled=true" })).json().total, 3);
  const foreignPlan = await plans.createPlan(actor, alienProject.id, "module", { name: "外部模块" });
  assert.equal((await app.inject({ method: "GET", url: tableUrl + `moduleId=${foreignPlan.id}` })).json().total, 0);
  assert.equal((await app.inject({ method: "GET", url: tableUrl + `moduleId=${crypto.randomUUID()}` })).json().total, 0);
  assert.equal((await app.inject({ method: "GET", url: tableUrl + "moduleId=invalid" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: tableUrl + scopeParams, headers: { "x-outsider": "yes" } })).statusCode, 403);
  await db.update(iteration).set({ completedAt: new Date(), archivedAt: new Date() }).where(eq(iteration.id, planIds.iterationId!));
  assert.equal((await app.inject({ method: "GET", url: tableUrl + scopeParams })).json().total, 3, "归档与结束不丢失历史范围");
  await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, scoped[0]!.id));
  assert.equal((await app.inject({ method: "GET", url: tableUrl + scopeParams })).json().total, 2);
  console.log("planning query contracts passed");
} finally { await app.close(); await sql.end({ timeout: 5 }); }
