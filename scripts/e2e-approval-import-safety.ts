import "./_env.ts";
/** 审批范围/并发决定与批次回滚权限；只在随机隔离库运行。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { approvalRequest, member, role, roleAssignment, rolePermission, workflowState, workflowTransition, importBatch, workItem } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import * as approvals from "../src/server/services/approval.service.ts";
import * as imports from "../src/server/services/import.service.ts";
import { lockProjectTree } from "../src/server/services/project-tree.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const marker = randomUUID().replaceAll("-", "").slice(0, 6);
let checks = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); checks++; console.log(`OK ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, (error as Error).message); }
}
const denied = (p: Promise<unknown>) => assert.rejects(p, (error: unknown) => (error as { code?: string }).code === "FORBIDDEN");
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const passwordHash = await hashPassword(`isolated-${marker}-password`);
  const [adminRow, userRow] = await db.insert(member).values(["admin", "user"].map(name => ({ username: `safe-${name}-${marker}`, name, status: "ACTIVE", passwordHash }))).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const a = await projects.createProject(admin, { key: `SA${marker.toUpperCase()}`, name: "审批角色来源项目" });
  const b = await projects.createProject(admin, { key: `SB${marker.toUpperCase()}`, name: "目标审批项目" });
  const [reviewerRole, basicRole] = await db.insert(role).values([
    { key: `reviewer-${marker}`, name: "审批角色" }, { key: `basic-${marker}`, name: "创建与流转" },
  ]).returning();
  await db.insert(rolePermission).values([
    { roleId: reviewerRole!.id, permissionKey: "work_item:transition" },
    { roleId: basicRole!.id, permissionKey: "work_item:transition" },
    { roleId: basicRole!.id, permissionKey: "work_item:create" },
  ]);
  await db.insert(roleAssignment).values([
    { memberId: userRow!.id, roleId: reviewerRole!.id, scopeType: "PROJECT", scopeId: a.id },
    { memberId: userRow!.id, roleId: basicRole!.id, scopeType: "PROJECT", scopeId: b.id },
  ]);
  const user = (await loadActor(userRow!.id))!;
  async function pending(title: string, roleKey = reviewerRole!.key) {
    const item = await items.createWorkItem(admin, b.id, { type: "TASK", title });
    const [target] = await db.select().from(workflowState).where(and(eq(workflowState.workflowId, item.workflowId), eq(workflowState.key, "IN_PROGRESS")));
    await db.update(workflowTransition).set({ allowedRoleIds: [], requiresApproval: true, approverRoleKeys: [roleKey] })
      .where(and(eq(workflowTransition.workflowId, item.workflowId), eq(workflowTransition.fromStateId, item.statusId), eq(workflowTransition.toStateId, target!.id)));
    const request = await approvals.requestApproval(admin, item, { fromStateId: item.statusId, toStateId: target!.id, approverRoleKeys: [roleKey] });
    return { item, request, target: target! };
  }
  await test("A项目审批角色不能拒绝B项目审批", async () => {
    const { request } = await pending("跨项目拒绝");
    await denied(approvals.decide(user, request.id, "reject"));
  });
  await test("A项目审批角色不能批准B项目审批", async () => {
    const { request } = await pending("跨项目批准");
    await denied(approvals.decide(user, request.id, "approve"));
  });
  await test("受角色限制的迁移边只认目标项目有效角色", async () => {
    const { item, target } = await pending("跨项目迁移边");
    await db.update(workflowTransition).set({ allowedRoleIds: [reviewerRole!.key], requiresApproval: false })
      .where(and(eq(workflowTransition.workflowId, item.workflowId), eq(workflowTransition.fromStateId, item.statusId), eq(workflowTransition.toStateId, target.id)));
    await denied(items.transitionWorkItem(user, item.id, { toStateKey: target.key, version: item.version }));
  });
  await test("approve/reject并发只有一个决定成功且状态与工作项一致", async () => {
    const { item, request, target } = await pending("审批竞态", "ADMIN");
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const holding = db.transaction(async () => { await lockProjectTree(b.id); locked(); await gate; });
    await ready;
    const approve = approvals.decide(admin, request.id, "approve");
    await delay(100);
    const reject = approvals.decide(admin, request.id, "reject");
    await delay(100); release(); await holding;
    const results = await Promise.allSettled([approve, reject]);
    const stored = (await db.select().from(approvalRequest).where(eq(approvalRequest.id, request.id)))[0]!;
    const current = await items.getWorkItem(admin, item.id);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1, `并发结果 ${results.map(result => result.status)}；审批 ${stored.status}`);
    assert.equal(current.statusId === target.id, stored.status === "APPROVED");
  });
  async function imported(owner = admin) {
    const batch = await imports.createBatch(owner, b.id, { filename: "权限验收.csv", buffer: Buffer.from(`标题\n回滚权限-${randomUUID()}\n`), source: "CSV" });
    await imports.setMapping(owner, batch.batch.id, { fieldMap: { 标题: "title" } });
    await imports.dryRun(owner, batch.batch.id);
    const result = await imports.confirm(owner, batch.batch.id); assert.equal(result.created, 1);
    return batch.batch.id;
  }
  await test("仅有create不能回滚同项目他人的批次", async () => {
    const id = await imported(); await denied(imports.rollback(user, id));
    assert.equal((await db.select().from(importBatch).where(eq(importBatch.id, id)))[0]!.status, "SUCCEEDED");
  });
  await test("批次创建者也须具有工作项删除权限", async () => {
    const id = await imported(user); await denied(imports.rollback(user, id));
  });
  await test("有删除与项目管理权限者仍可回滚，且软删记录可核对", async () => {
    const id = await imported(); const result = await imports.rollback(admin, id); assert.equal(result.removed, 1);
    const rows = await db.select().from(workItem).where(eq(workItem.projectId, b.id)); assert.ok(rows.some(row => row.deletedAt));
    assert.equal((await imports.rollback(admin, id)).alreadyRolledBack, true);
  });
  console.log(`审批与导入安全验收 ${checks}/${checks + failures.length}`);
  assert.deepEqual(failures, []);
} finally { await sql.end(); }
