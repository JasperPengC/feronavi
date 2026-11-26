import "./_env.ts";
/** 生命周期反控：共享 REST 服务、账号权限、跨项目目标、并发幂等与审计。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { setTimeout } from "node:timers/promises";
import { db, sql, inTransaction } from "../src/db/index.ts";
import { member, role, roleAssignment, workItem, workflowState, workflowTransition, activityEntry, auditEntry } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import { DomainError } from "../src/shared/errors.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import * as lifecycle from "../src/server/services/planning-lifecycle.service.ts";
import * as items from "../src/server/services/work-item.service.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { subscribe, type SseEvent } from "../src/server/services/events.service.ts";
import { prepareReadyRelease } from "../tests/support/release-ready-fixture.ts";

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
let checks = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`OK ${name}`); };
const rejects = async (name: string, fn: () => Promise<unknown>, code: string) => {
  await assert.rejects(fn, (error: unknown) => error instanceof DomainError && error.code === code, name); checks++; console.log(`OK ${name}`);
};
await ensureInitialized();
const app = await buildApp({ logger: false });
const signals: SseEvent[] = [];
const unsubscribe = subscribe(event => signals.push(event));
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
  const password = `Lifecycle-${marker}-password`;
  const [adminRow, memberRow] = await db.insert(member).values([
    { username: `lc-admin-${marker}`, email: `admin-${marker}@test.local`, name: "生命周期管理员", status: "ACTIVE", passwordHash: await hashPassword(password) },
    { username: `lc-member-${marker}`, email: `member-${marker}@test.local`, name: "生命周期成员", status: "ACTIVE", passwordHash: await hashPassword(password) },
  ]).returning();
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const inside = await projects.createProject(admin, { key: `LA${marker}`, name: "生命周期项目" });
  const outside = await projects.createProject(admin, { key: `LB${marker}`, name: "另一项目" });
  await db.insert(roleAssignment).values({ memberId: memberRow!.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: inside.id });
  const ordinary = (await loadActor(memberRow!.id))!;
  const createIteration = (name: string, projectId = inside.id, carryOver = true) => plans.createPlan(admin, projectId, "iteration", { name, startDate: "2026-11-19", endDate: "2026-11-29", carryOver });
  const source = (await createIteration("来源迭代"))!;
  const target = (await createIteration("目标迭代"))!;
  const foreign = (await createIteration("跨项目目标", outside.id))!;
  const task = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "待结转任务", iterationId: source.id });
  const terminal = (await db.select().from(workflowState).where(and(eq(workflowState.workflowId, task.workflowId), eq(workflowState.category, "TERMINAL"))))[0]!;
  const finished = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "已完成任务保留原迭代", iterationId: source.id });
  await db.update(workItem).set({ statusId: terminal.id, completedAt: new Date() }).where(eq(workItem.id, finished.id));
  await rejects("可见普通成员不能完成迭代", () => lifecycle.complete(ordinary, source.id, "iteration", { targetIterationId: target.id }), "FORBIDDEN");
  await rejects("可见普通成员不能归档迭代", () => lifecycle.setArchived(ordinary, source.id, "iteration", true), "FORBIDDEN");
  await rejects("未完成计划不能归档", () => lifecycle.setArchived(admin, source.id, "iteration", true), "BLOCKED_BY_PREREQUISITE");
  await rejects("服务层直接调用也拒绝跨项目结转", () => lifecycle.complete(admin, source.id, "iteration", { targetIterationId: foreign.id }), "VALIDATION");
  check("失败后来源迭代和工作项保持原值", !(await plans.get(admin, source.id, "iteration")).completedAt && (await items.getWorkItem(admin, task.id)).iterationId === source.id);
  const finishedTarget = (await createIteration("已经完成目标"))!;
  await lifecycle.complete(admin, finishedTarget.id, "iteration");
  await rejects("不能结转到已完成迭代", () => lifecycle.complete(admin, source.id, "iteration", { targetIterationId: finishedTarget.id }), "BLOCKED_BY_PREREQUISITE");
  const concurrent = await Promise.all([lifecycle.complete(admin, source.id, "iteration", { targetIterationId: target.id }), lifecycle.complete(admin, source.id, "iteration", { targetIterationId: target.id })]);
  check("并发完成只有一次实际结转", concurrent.filter(row => row.alreadyCompleted).length === 1 && concurrent.reduce((sum, row) => sum + row.movedCount, 0) === 1 && (await items.getWorkItem(admin, task.id)).version === task.version + 1);
  check("终态工作项不会结转", (await items.getWorkItem(admin, finished.id)).iterationId === source.id);
  check("结转提交后发送一次工作项变更信号", signals.filter(event => event.event === "workitem.changed" && event.data.id === task.id && (event.data.changedFields as string[]).includes("iterationId")).length === 1);
  const events = await db.select().from(activityEntry).where(and(eq(activityEntry.targetId, source.id), eq(activityEntry.action, "plan.iteration.completed")));
  const audits = await db.select().from(auditEntry).where(and(eq(auditEntry.targetId, source.id), eq(auditEntry.action, "plan.iteration.completed")));
  check("重复完成只记录一次完成活动与审计", events.length === 1 && audits.length === 1);
  const persisted = await plans.get(admin, source.id, "iteration") as unknown as { completionResult?: { movedCount: number; targetIterationId: string; movedWorkItemIds: string[] } };
  check("首次完成结转收据持久化供后续回读", persisted.completionResult?.movedCount === 1 && persisted.completionResult.targetIterationId === target.id && persisted.completionResult.movedWorkItemIds[0] === task.id);
  const noCarry = (await createIteration("不自动结转", inside.id, false))!;
  const retained = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "保留历史归属", iterationId: noCarry.id });
  await rejects("禁用结转时不能提供目标误导调用者", () => lifecycle.complete(admin, noCarry.id, "iteration", { targetIterationId: target.id }), "VALIDATION");
  await lifecycle.complete(admin, noCarry.id, "iteration");
  check("关闭结转可完成迭代并保留工作项归属", (await items.getWorkItem(admin, retained.id)).iterationId === noCarry.id);
  await rejects("仍有未完成项时不能归档已完成迭代", () => lifecycle.setArchived(admin, noCarry.id, "iteration", true), "BLOCKED_BY_PREREQUISITE");
  await items.updateWorkItem(admin, retained.id, { version: retained.version, title: "历史归属保留且可更新内容", iterationId: noCarry.id });
  const movedOut = await items.getWorkItem(admin, retained.id);
  await items.updateWorkItem(admin, retained.id, { version: movedOut.version, iterationId: null });
  check("关闭结转的历史迭代移出未完成项后可归档", !!(await lifecycle.setArchived(admin, noCarry.id, "iteration", true)).archivedAt);
  const version = (await plans.createPlan(admin, inside.id, "release", { name: "有未完成任务版本" }))!;
  await items.createWorkItem(admin, inside.id, { type: "TASK", title: "阻止完成版本", releaseId: version.id });
  await rejects("版本未完成项阻止结束", () => lifecycle.complete(admin, version.id, "release"), "BLOCKED_BY_PREREQUISITE");
  await rejects("普通成员不能完成版本", () => lifecycle.complete(ordinary, version.id, "release"), "FORBIDDEN");

  // 持有完成事务直到三种并发写入实际阻塞，随后提交；不能只测试重复完成。
  for (const kind of ["iteration", "release"] as const) {
    const closing = kind === "iteration" ? (await createIteration("并发完成迭代"))! : (await plans.createPlan(admin, inside.id, kind, { name: "并发完成版本" }))!;
    const unrelated = await items.createWorkItem(admin, inside.id, { type: "TASK", title: `并发关联 ${kind}` });
    const association = kind === "iteration" ? "iterationId" : "releaseId";
    if (kind === "release") await prepareReadyRelease(admin, inside.id, closing.id);
    let releaseCommit!: () => void;
    let ready!: (pid: number) => void;
    const readyPromise = new Promise<number>(resolve => { ready = resolve; });
    const commitPromise = new Promise<void>(resolve => { releaseCommit = resolve; });
    const closingPromise = inTransaction(async () => {
      const [{ pid }] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
      await lifecycle.complete(admin, closing.id, kind);
      ready(pid);
      await commitPromise;
    });
    const pid = await readyPromise;
    const writes = [
      items.createWorkItem(admin, inside.id, { type: "TASK", title: "完成期间新增", [association]: closing.id }),
      items.updateWorkItem(admin, unrelated.id, { version: unrelated.version, [association]: closing.id }),
      plans.updatePlan(admin, closing.id, kind, { name: "完成期间改名" }),
    ].map(operation => operation.then(() => null, error => error));
    try {
      const deadline = Date.now() + 5000;
      let blocked = 0;
      while (blocked < writes.length && Date.now() < deadline) {
        const [row] = await sql<{ blocked: number }[]>`with recursive blocked_by_plan(pid) as (
          select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
          union
          select activity.pid from pg_stat_activity activity join blocked_by_plan blocker on blocker.pid = any(pg_blocking_pids(activity.pid))
        ) select count(*)::int as blocked from blocked_by_plan`;
        blocked = row.blocked;
        if (blocked < writes.length) await setTimeout(10);
      }
      check(`${kind} 完成与新增、关联、更新持有同一项目锁`, blocked === writes.length);
    } finally { releaseCommit(); }
    await closingPromise;
    const errors = await Promise.all(writes);
    check(`${kind} 完成提交后拒绝三种并发写入`, errors.every(error => error instanceof DomainError && error.code === "BLOCKED_BY_PREREQUISITE"));
    await lifecycle.setArchived(admin, closing.id, kind, true);
    await rejects(`${kind} 归档后拒绝新工作项关联`, () => items.createWorkItem(admin, inside.id, { type: "TASK", title: "不能关联归档计划", [association]: closing.id }), "BLOCKED_BY_PREREQUISITE");
  }

  const terminalRelease = (await plans.createPlan(admin, inside.id, "release", { name: "已完成任务版本" }))!;
  const releaseItem = await items.createWorkItem(admin, inside.id, { type: "TASK", title: "已完成版本任务", releaseId: terminalRelease.id });
  await db.update(workItem).set({ statusId: terminal.id, completedAt: new Date() }).where(eq(workItem.id, releaseItem.id));
  await rejects("版本工作项已完成但缺候选仍拒绝结束", () => lifecycle.complete(admin, terminalRelease.id, "release"), "BLOCKED_BY_PREREQUISITE");
  await prepareReadyRelease(admin, inside.id, terminalRelease.id);
  await lifecycle.complete(admin, terminalRelease.id, "release");
  check("版本允许终态工作项保留并归档", !!(await lifecycle.setArchived(admin, terminalRelease.id, "release", true)).archivedAt);
  // 兼容历史/导入工作流中的终态出边；不能用重开绕过计划关闭约束。
  const initial = (await db.select().from(workflowState).where(eq(workflowState.id, task.statusId)))[0]!;
  await db.insert(workflowTransition).values({ workflowId: task.workflowId, fromStateId: terminal.id, toStateId: initial.id, allowedRoleIds: [] }).onConflictDoNothing();
  await rejects("归档版本中的终态工作项不能重开", () => items.transitionWorkItem(admin, releaseItem.id, { version: releaseItem.version, toStateKey: initial.key }), "BLOCKED_BY_PREREQUISITE");

  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
  const login = await fetch(`${process.env.BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: admin.username, password }) });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const headers = { "content-type": "application/json", "x-csrf-token": decodeURIComponent(loginBody.csrfToken), cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  const rest = async (path: string, method = "GET", body?: object) => {
    const response = await fetch(`${process.env.BASE}/api/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.notEqual(response.status, 429, "REST 限流：停止本轮，不重试");
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  };
  const detail = await rest(`/iterations/${target.id}`);
  const list = await rest(`/projects/${inside.id}/iterations`);
  check("计划详情与列表返回真实未完成项计数", detail.pendingWorkItemCount === 1 && list.find((row: { id: string }) => row.id === target.id)?.pendingWorkItemCount === 1 && list.find((row: { id: string }) => row.id === source.id)?.pendingWorkItemCount === 0);
  for (const kind of ["iteration", "release"] as const) {
    const fields = kind === "iteration" ? { startDate: "2026-12-01", endDate: "2026-12-14" } : {};
    const created = await rest(`/projects/${inside.id}/${kind}s`, "POST", { name: `REST ${kind}`, ...fields });
    if (kind === "release") await prepareReadyRelease(admin, inside.id, created.id);
    const completed = await rest(`/${kind}s/${created.id}/complete`, "POST", {});
    const repeated = await rest(`/${kind}s/${created.id}/complete`, "POST", {});
    const archived = await rest(`/${kind}s/${created.id}/archive`, "POST", {});
    const hidden = await rest(`/projects/${inside.id}/${kind}s`);
    const all = await rest(`/projects/${inside.id}/${kind}s?archived=true`);
    const restored = await rest(`/${kind}s/${created.id}/unarchive`, "POST", {});
    check(`REST ${kind} 完成/归档/恢复与 MCP 共用行为`, completed.completedAt === repeated.completedAt && repeated.alreadyCompleted && archived.archivedAt && !hidden.some((row: { id: string }) => row.id === created.id) && all.some((row: { id: string }) => row.id === created.id) && restored.archivedAt === null && restored.completedAt === completed.completedAt && restored.completionResult?.completedAt === completed.completedAt);
  }
  check("迁移增加归档字段未影响原工作项", (await db.select().from(workItem).where(eq(workItem.id, task.id)))[0]!.iterationId === target.id);
  console.log(`计划生命周期验收 ${checks}/${checks}`);
} catch (error) { console.error(error); throw error; }
finally { unsubscribe(); await app.close(); await sql.end({ timeout: 5 }); }
