import "./_env.ts";
/** 里程碑/模块归档后的关联保护与并发一致性；只在随机隔离库运行。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db, sql, inTransaction } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { DomainError } from "../src/shared/errors.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
const marker = randomUUID().replaceAll("-", "").slice(0, 8);
let checks = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); checks++; console.log(`OK ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, (error as Error).message); }
}
const blocked = (error: unknown) => error instanceof DomainError && error.code === "BLOCKED_BY_PREREQUISITE";
async function blockedConnections(pid: number, expected: number) {
  const deadline = Date.now() + 2000;
  let count = 0;
  while (count < expected && Date.now() < deadline) {
    const [row] = await sql<{ blocked: number }[]>`with recursive blocked_by_plan(pid) as (
      select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
      union
      select activity.pid from pg_stat_activity activity join blocked_by_plan blocker on blocker.pid = any(pg_blocking_pids(activity.pid))
    ) select count(*)::int as blocked from blocked_by_plan`;
    count = row!.blocked;
    if (count < expected) await delay(10);
  }
  return count;
}
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [adminRow] = await db.insert(member).values({
    username: `archive-${marker}`, name: "归档关联验收", status: "ACTIVE", passwordHash: await hashPassword(`isolated-${marker}-password`),
  }).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const project = await projects.createProject(admin, { key: `AR${marker.toUpperCase()}`, name: "归档关联隔离项目" });
  for (const kind of ["milestone", "module"] as const) {
    const field = kind === "milestone" ? "milestoneId" : "moduleId";
    const archived = (await plans.createPlan(admin, project.id, kind, { name: `已归档 ${kind}` }))!;
    await plans.archive(admin, archived.id, kind);
    await test(`${kind} 归档后不能新建关联工作项`, async () => {
      await assert.rejects(items.createWorkItem(admin, project.id, { type: "TASK", title: "归档后新增", [field]: archived.id }), blocked);
    });
    await test(`${kind} 归档后不能改入且失败不修改原记录`, async () => {
      const item = await items.createWorkItem(admin, project.id, { type: "TASK", title: "归档后改入" });
      await assert.rejects(items.updateWorkItem(admin, item.id, { version: item.version, [field]: archived.id }), blocked);
      const current = await items.getWorkItem(admin, item.id);
      assert.equal(current[field], null);
      assert.equal(current.version, item.version);
    });
    await test(`${kind} 恢复后可新建和修改关联，已有工作项仍阻止归档`, async () => {
      await plans.unarchive(admin, archived.id, kind);
      const linked = await items.createWorkItem(admin, project.id, { type: "TASK", title: "恢复后新增", [field]: archived.id });
      const item = await items.createWorkItem(admin, project.id, { type: "TASK", title: "恢复后改入" });
      const updated = await items.updateWorkItem(admin, item.id, { version: item.version, [field]: archived.id });
      assert.equal(linked[field], archived.id);
      assert.equal(updated![field], archived.id);
      await assert.rejects(plans.archive(admin, archived.id, kind), blocked);
    });
    await test(`${kind} 归档等待关联事务，提交后拒绝归档`, async () => {
      const plan = (await plans.createPlan(admin, project.id, kind, { name: `先挂接 ${kind}` }))!;
      let release!: () => void;
      let ready!: (pid: number) => void;
      let fail!: (error: unknown) => void;
      const readyPromise = new Promise<number>((resolve, reject) => { ready = resolve; fail = reject; });
      const commit = new Promise<void>(resolve => { release = resolve; });
      const attaching = inTransaction(async () => {
        const [{ pid }] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
        await items.createWorkItem(admin, project.id, { type: "TASK", title: "并发挂接", [field]: plan.id });
        ready(pid);
        await commit;
      });
      void attaching.catch(fail);
      const pid = await readyPromise;
      const archiving = plans.archive(admin, plan.id, kind).then(() => null, error => error);
      let waiting: number;
      try { waiting = await blockedConnections(pid, 1); }
      finally { release(); }
      await attaching;
      const error = await archiving;
      assert.equal(waiting, 1, "归档必须等待工作项关联持有的项目锁");
      assert.ok(blocked(error));
      assert.equal((await plans.get(admin, plan.id, kind)).archivedAt, null);
    });
    await test(`${kind} 新建和改入等待归档事务，提交后均拒绝`, async () => {
      const plan = (await plans.createPlan(admin, project.id, kind, { name: `先归档 ${kind}` }))!;
      const item = await items.createWorkItem(admin, project.id, { type: "TASK", title: "并发改入" });
      let release!: () => void;
      let ready!: (pid: number) => void;
      let fail!: (error: unknown) => void;
      const readyPromise = new Promise<number>((resolve, reject) => { ready = resolve; fail = reject; });
      const commit = new Promise<void>(resolve => { release = resolve; });
      const archiving = inTransaction(async () => {
        const [{ pid }] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
        await plans.archive(admin, plan.id, kind);
        ready(pid);
        await commit;
      });
      void archiving.catch(fail);
      const pid = await readyPromise;
      const writes = [
        items.createWorkItem(admin, project.id, { type: "TASK", title: "并发新增", [field]: plan.id }),
        items.updateWorkItem(admin, item.id, { version: item.version, [field]: plan.id }),
      ].map(operation => operation.then(() => null, error => error));
      let waiting: number;
      try { waiting = await blockedConnections(pid, 2); }
      finally { release(); }
      await archiving;
      const errors = await Promise.all(writes);
      assert.equal(waiting, 2, "新建和改入必须等待归档持有的项目锁");
      assert.ok(errors.every(blocked));
      assert.equal(await plans.countLinkedWorkItems(kind, plan.id), 0);
      assert.equal((await items.getWorkItem(admin, item.id)).version, item.version);
    });
  }
  console.log(`计划归档关联验收 ${checks}/${checks + failures.length}`);
  assert.deepEqual(failures, []);
} finally { await sql.end(); }
