import assert from "node:assert/strict";

assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, workItem, workflowState } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const { createWorkItem } = await import("../../src/server/services/work-item.service.ts");
const service = await import("../../src/server/services/workbench.service.ts");

try {
  const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
  assert.ok(adminRole);
  const [admin, other] = await db.insert(member).values(["admin", "other"].map((name) => ({ username: `workbench-${name}`, name, email: `workbench-${name}@example.invalid`, passwordHash: "isolated-no-login", status: "ACTIVE" as const }))).returning();
  assert.ok(admin); assert.ok(other);
  await db.insert(roleAssignment).values({ memberId: admin.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const actor = await loadActor(admin.id), outsider = await loadActor(other.id);
  assert.ok(actor); assert.ok(outsider);
  const project = await createProject(actor, { key: "WBGROUP", name: "工作台分组查询测试" });
  const [dates] = await sql`select ((now() at time zone 'Asia/Shanghai')::date - 1)::text as yesterday, ((now() at time zone 'Asia/Shanghai')::date + 2)::text as soon`;
  assert.ok(dates);
  const ids: string[] = [];
  for (let index = 0; index < 65; index++) {
    const item = await createWorkItem(actor, project.id, { type: "TASK", title: `工作台项 ${index + 1}`, assigneeId: admin.id, dueDate: index < 33 ? dates.yesterday : dates.soon });
    ids.push(item.id);
  }
  const deleted = await createWorkItem(actor, project.id, { type: "TASK", title: "已删除项", assigneeId: admin.id, dueDate: dates.yesterday });
  await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, deleted.id));

  const overview = await service.workbench(actor);
  const { validatedToolOutput } = await import("../../src/server/application/tool-contracts.ts");
  assert.equal(overview.groups[0]?.count, 65);
  assert.equal(overview.groups[1]?.count, 65);
  assert.equal(overview.groups[2]?.count, 33);
  assert.equal(overview.groups[3]?.count, 32);
  assert.ok(overview.groups.every((group) => group.items.length <= 8));
  for (const key of ["assignedToMe", "createdByMe"] as const) {
    const first = await service.workbenchGroup(actor, key, { page: 1, pageSize: 50 });
    const second = await service.workbenchGroup(actor, key, { page: 2, pageSize: 50 });
    assert.equal(first.count, 65); assert.equal(second.count, 65);
    assert.equal(first.items.length, 50); assert.equal(second.items.length, 15);
    assert.deepEqual([...first.items, ...second.items].map((item) => item.id).sort(), [...ids].sort());
    assert.equal((await service.workbenchGroup(outsider, key, { page: 1, pageSize: 50 })).count, 0);
  }
  const overdue = await service.workbenchGroup(actor, "overdue", { page: 1, pageSize: 50 });
  assert.equal(overdue.count, 33);
  assert.deepEqual(overdue.items.map((item) => item.id).sort(), ids.slice(0, 33).sort());
  const soon = await service.workbenchGroup(actor, "dueSoon", { page: 1, pageSize: 50 });
  assert.equal(soon.count, 32);
  assert.deepEqual(soon.items.map((item) => item.id).sort(), ids.slice(33).sort());
  assert.equal((await service.workbenchGroup(actor, "createdByMe", { page: 3, pageSize: 50 })).items.length, 0);
  const [firstItem] = await db.select().from(workItem).where(eq(workItem.id, ids[0]!));
  assert.ok(firstItem);
  const [closed] = await db.insert(workflowState).values({ workflowId: firstItem.workflowId, key: "CUSTOM_ARCHIVED", name: "自定义终态", category: "TERMINAL", color: "gray" }).returning();
  assert.ok(closed);
  await db.update(workItem).set({ statusId: closed.id }).where(eq(workItem.projectId, project.id));
  for (const category of ["TERMINAL", "DONE", "CANCELLED"]) {
    await db.update(workflowState).set({ category }).where(eq(workflowState.id, closed.id));
    assert.equal((await service.workbenchGroup(actor, "overdue")).count, 0, `${category}不能成为逾期工作`);
    assert.equal((await service.workbenchGroup(actor, "dueSoon")).count, 0, `${category}不能成为临期工作`);
  }
  assert.equal((await service.workbenchGroup(actor, "assignedToMe")).count, 65, "历史指派项仍保留");
  await db.update(workItem).set({ statusId: firstItem.statusId, dueDate: null }).where(eq(workItem.id, firstItem.id));
  const reopened = await service.workbench(actor);
  const attention = (reopened as unknown as { attentionItems: { id: string }[] }).attentionItems;
  assert.deepEqual(attention.map(x => x.id), [firstItem.id], "最早的未完成任务不能被八条新终态预览挤掉");
  assert.equal((await service.workbench(outsider) as unknown as { attentionItems: unknown[] }).attentionItems.length, 0, "关注列表遵守项目范围");
  await db.update(workItem).set({ dueDate: dates.soon }).where(eq(workItem.id, firstItem.id));
  const reopenedSoon = await service.workbenchGroup(actor, "dueSoon", { pageSize: 1 });
  assert.equal(reopenedSoon.count, 1);
  assert.equal(reopenedSoon.items[0]?.id, firstItem.id);
  validatedToolOutput({ name: "workbench.get" }, reopened);
  console.log("workbench group contracts passed");
} finally { await sql.end({ timeout: 5 }); }
