import "./_env.ts";
/** 容量关闭约束：真实 REST、数据库回读及两种持锁顺序的并发竞争。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { db, sql, inTransaction } from "../src/db/index.ts";
import { member, role, roleAssignment, projectMembership, iterationCapacity } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as lifecycle from "../src/server/services/planning-lifecycle.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, value: unknown) => {
  results.push({ name, ok: !!value });
  console.log(`${value ? "OK" : "FAIL"} ${name}`);
};
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function waitForBlocked(rootPid: number, count: number, finished: () => boolean) {
  const deadline = Date.now() + 5000;
  let pids: number[] = [];
  while (Date.now() < deadline) {
    const rows = await sql<{ pid: number }[]>`with recursive blocked_by_capacity(pid) as (
      select pid from pg_stat_activity where ${rootPid} = any(pg_blocking_pids(pid))
      union
      select activity.pid from pg_stat_activity activity join blocked_by_capacity blocker on blocker.pid = any(pg_blocking_pids(activity.pid))
    ) select pid from blocked_by_capacity`;
    pids = rows.map(row => row.pid);
    if (pids.length >= count || finished()) break;
    await setTimeout(10);
  }
  return pids;
}

await ensureInitialized();
const app = await buildApp({ logger: false });
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
  const password = `Capacity-${marker}-password`;
  const passwordHash = await hashPassword(password);
  const [adminRow, ordinaryRow, outsiderRow] = await db.insert(member).values([
    { username: `cap-admin-${marker}`, email: `cap-admin-${marker}@test.local`, name: "容量管理员", status: "ACTIVE", passwordHash },
    { username: `cap-member-${marker}`, email: `cap-member-${marker}@test.local`, name: "容量普通成员", status: "ACTIVE", passwordHash },
    { username: `cap-outsider-${marker}`, email: `cap-outsider-${marker}@test.local`, name: "项目外成员", status: "ACTIVE", passwordHash },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const project = await projects.createProject(admin, { key: `CP${marker}`, name: "容量生命周期项目" });
  await db.insert(projectMembership).values({ projectId: project.id, memberId: ordinaryRow!.id, roleId: memberRole!.id });
  await db.insert(roleAssignment).values({ memberId: ordinaryRow!.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: project.id });
  const createIteration = async (name: string) => (await plans.createPlan(admin, project.id, "iteration", { name, startDate: "2026-11-19", endDate: "2026-11-29" }))!;
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
  const login = async (username: string) => {
    const response = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    return { "content-type": "application/json", "x-csrf-token": decodeURIComponent(data.csrfToken), cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  };
  const adminHeaders = await login(admin.username);
  const ordinaryHeaders = await login(ordinaryRow!.username);
  const request = async (path: string, method: string, body: object, headers = adminHeaders) => {
    const response = await fetch(`${process.env.BASE}/api/v1${path}`, { method, headers, body: JSON.stringify(body) });
    assert.notEqual(response.status, 429, "REST 限流：停止本轮，不重试");
    return { status: response.status, body: await response.json() };
  };
  const put = (id: string, body: object, memberId = admin.memberId, headers = adminHeaders) => request(`/iterations/${id}/capacity/${memberId}`, "PUT", body, headers);
  const capacity = async (id: string) => (await db.select().from(iterationCapacity).where(and(eq(iterationCapacity.iterationId, id), eq(iterationCapacity.memberId, admin.memberId))))[0];
  const open = await createIteration("容量校验与关闭");
  const zero = await put(open.id, { capacityPoints: 0 });
  check("开放迭代可保存零容量点数且真实写入", zero.status === 200 && zero.body.ok && Number((await capacity(open.id))?.capacityPoints) === 0);
  const hours = await put(open.id, { capacityPoints: null, capacityHours: 12.5 });
  const hourRow = await capacity(open.id);
  check("容量可切换为小时且清空点数", hours.status === 200 && Number(hourRow?.capacityHours) === 12.5 && hourRow?.capacityPoints === null);
  for (const body of [{ capacityPoints: 2, capacityHours: 3 }, {}, { capacityPoints: null, capacityHours: null }, { capacityPoints: -1 }, { capacityHours: 1000000 }]) {
    const response = await put(open.id, body);
    check(`非法容量仍按原规则拒绝 ${JSON.stringify(body)}`, response.status === 400 && response.body.code === "VALIDATION");
  }
  const outsider = await put(open.id, { capacityPoints: 3 }, outsiderRow!.id);
  check("不能给项目外成员设置容量", outsider.status === 400 && outsider.body.code === "VALIDATION");
  const denied = await put(open.id, { capacityPoints: 3 }, ordinaryRow!.id, ordinaryHeaders);
  check("可见普通项目成员没有容量管理权限", denied.status === 403 && denied.body.code === "FORBIDDEN");
  await lifecycle.complete(admin, open.id, "iteration");
  const completed = await put(open.id, { capacityPoints: 99 });
  check("已完成迭代拒绝容量更新", completed.status === 422 && completed.body.code === "BLOCKED_BY_PREREQUISITE");
  check("已完成迭代的容量保持关闭前历史值", Number((await capacity(open.id))?.capacityHours) === 12.5 && (await capacity(open.id))?.capacityPoints === null);
  await lifecycle.setArchived(admin, open.id, "iteration", true);
  const archived = await put(open.id, { capacityPoints: 100 });
  check("已归档迭代拒绝容量更新", archived.status === 422 && archived.body.code === "BLOCKED_BY_PREREQUISITE");

  // 完成先持有项目锁：容量请求必须实际等待，提交后重读关闭状态并拒绝。
  const completing = await createIteration("完成先持锁");
  assert.equal((await put(completing.id, { capacityPoints: 7 })).status, 200);
  const completionReady = gate<number>();
  const releaseCompletion = gate<void>();
  const completion = inTransaction(async () => {
    const [{ pid }] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await lifecycle.complete(admin, completing.id, "iteration");
    completionReady.resolve(pid);
    await releaseCompletion.promise;
  });
  void completion.catch(completionReady.reject);
  const completionPid = await completionReady.promise;
  let writeFinished = false;
  const lateWrite = put(completing.id, { capacityPoints: 99 }).finally(() => { writeFinished = true; });
  try {
    const blocked = await waitForBlocked(completionPid, 1, () => writeFinished);
    check("完成先持锁时容量 REST 请求实际等待同一事务", blocked.length === 1 && !writeFinished);
  } finally { releaseCompletion.resolve(); }
  await completion;
  const lateResult = await lateWrite;
  check("完成提交后并发容量请求被拒绝", lateResult.status === 422 && lateResult.body.code === "BLOCKED_BY_PREREQUISITE");
  check("完成竞争后数据库容量没有被覆盖", Number((await capacity(completing.id))?.capacityPoints) === 7);

  // 容量先获得项目锁，暂时阻塞在真实容量行锁上：完成必须排在容量事务之后。
  const updating = await createIteration("容量先持锁");
  assert.equal((await put(updating.id, { capacityPoints: 5 })).status, 200);
  const rowReady = gate<number>();
  const releaseRow = gate<void>();
  const rowBlocker = inTransaction(async () => {
    const [{ pid }] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await db.select().from(iterationCapacity).where(and(eq(iterationCapacity.iterationId, updating.id), eq(iterationCapacity.memberId, admin.memberId))).for("update");
    rowReady.resolve(pid);
    await releaseRow.promise;
  });
  void rowBlocker.catch(rowReady.reject);
  const rowPid = await rowReady.promise;
  let capacityFinished = false;
  let closeFinished = false;
  const firstWrite = put(updating.id, { capacityPoints: 9 }).finally(() => { capacityFinished = true; });
  let followingClose: ReturnType<typeof request> | undefined;
  try {
    const blockedWrite = await waitForBlocked(rowPid, 1, () => capacityFinished);
    assert.equal(blockedWrite.length, 1, "测试前置：容量写入实际阻塞在容量行锁");
    followingClose = request(`/iterations/${updating.id}/complete`, "POST", {}).finally(() => { closeFinished = true; });
    const blockedBoth = await waitForBlocked(rowPid, 2, () => closeFinished);
    check("容量先持锁时完成请求实际排在容量事务之后", blockedBoth.length === 2 && !closeFinished && !capacityFinished);
  } finally { releaseRow.resolve(); }
  await rowBlocker;
  const firstResult = await firstWrite;
  const closeResult = await followingClose;
  check("容量先提交后完成成功且保留最终容量", firstResult.status === 200 && closeResult?.status === 200 && Number((await capacity(updating.id))?.capacityPoints) === 9 && !!(await plans.get(admin, updating.id, "iteration")).completedAt);
  console.log(`容量生命周期验收 ${results.filter(result => result.ok).length}/${results.length}`);
  assert.equal(results.filter(result => !result.ok).length, 0, "容量生命周期存在未通过检查");
} finally { await app.close(); await sql.end({ timeout: 5 }); }
