import assert from "node:assert/strict";

// 必须是本轮随机隔离库，禁止脚本读取开发环境兜底配置。
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, workItem } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const projectService = await import("../../src/server/services/project.service.ts");
const workItemService = await import("../../src/server/services/work-item.service.ts");
const planningService = await import("../../src/server/services/planning-view.service.ts");

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
  const second = await planningService.table(actor, project.id, { unscheduled: true, page: 2, pageSize: 30 });
  assert.equal(first.total, 32); assert.equal(second.total, 32);
  assert.equal(first.rows.length, 30); assert.equal(second.rows.length, 2);
  assert.deepEqual([...first.rows, ...second.rows].map((item) => item.id).sort(), expectedUnscheduled.sort());
  assert.equal((await planningService.table(actor, project.id, { unscheduled: false })).total, 35);
  console.log("planning query contracts passed");
} finally { await sql.end({ timeout: 5 }); }
