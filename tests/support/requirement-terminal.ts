import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const wi = await import("../../src/server/services/work-item.service.ts");
try {
  const [role] = await db.select().from(s.role).where(eq(s.role.key, "ADMIN"));
  const [m] = await db.insert(s.member).values({ username: "terminal-owner", name: "终态验收", passwordHash: "isolated-no-login", status: "ACTIVE" }).returning();
  await db.insert(s.roleAssignment).values({ memberId: m!.id, roleId: role!.id, scopeType: "ORG" });
  const actor = (await loadActor(m!.id))!;
  const standard = await createProject(actor, { key: "STANDARD", name: "默认需求流程" });
  const customized = await createProject(actor, { key: "CUSTOM", name: "自定义流程" });
  const customEdges = await createProject(actor, { key: "EDGES", name: "自定义权限流程" });
  const cases = [];
  for (const project of [standard, customized, customEdges]) {
    let item = await wi.createWorkItem(actor, project.id, { type: "REQUIREMENT", title: project.key });
    for (const key of ["CONFIRMED", "SCHEDULED", "IN_PROGRESS", "DELIVERED", "VERIFIED"]) {
      item = await wi.transitionWorkItem(actor, item.id, { toStateKey: key, version: item.version });
    }
    assert.ok(item.completedAt, "新安装流程验收需求有完成时间");
    const [state] = await db.select().from(s.workflowState).where(eq(s.workflowState.id, item.statusId));
    assert.equal(state!.category, "TERMINAL");
    // 重建旧版未完成类别与时间，用实际迁移验证升级保护。
    await db.update(s.workflowState).set({ category: "IN_PROGRESS", color: "info" }).where(eq(s.workflowState.id, item.statusId));
    await db.update(s.workItem).set({ completedAt: null }).where(eq(s.workItem.id, item.id));
    cases.push(item);
  }
  await db.update(s.workflowState).set({ name: "待客户签字" }).where(eq(s.workflowState.id, cases[1]!.statusId));
  await db.update(s.workflowTransition).set({ requiresApproval: true }).where(eq(s.workflowTransition.workflowId, cases[2]!.workflowId));
  const migration = await readFile("drizzle/0085_requirement_verified_terminal.sql", "utf8");
  await sql.unsafe(migration);
  const upgraded = await wi.getWorkItem(actor, cases[0]!.id);
  assert.equal(upgraded.statusCategory, "TERMINAL");
  assert.ok(upgraded.completedAt);
  assert.equal(upgraded.version, cases[0]!.version + 1, "迁移变化使旧CAS失效");
  for (const item of cases.slice(1)) {
    const preserved = await wi.getWorkItem(actor, item.id);
    assert.equal(preserved.statusCategory, "IN_PROGRESS", "自定义状态/权限不被迁移覆盖");
    assert.equal(preserved.completedAt, null);
    assert.equal(preserved.version, item.version);
  }
  await sql.unsafe(migration);
  assert.equal((await wi.getWorkItem(actor, upgraded.id)).version, upgraded.version, "重跑幂等");
  const reopened = await wi.transitionWorkItem(actor, upgraded.id, { toStateKey: "IN_PROGRESS", version: upgraded.version });
  assert.equal(reopened.completedAt, null);
  console.log("requirement terminal migration passed");
} finally { await sql.end({ timeout: 5 }); }
