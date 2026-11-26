import "./_env.ts";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { iteration, member, role, roleAssignment, workItem, workflowState } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import { createProject } from "../src/server/services/project.service.ts";
import * as plans from "../src/server/services/planning.service.ts";
import { createWorkItem, updateWorkItem } from "../src/server/services/work-item.service.ts";
import { createToken } from "../src/server/services/token.service.ts";
import { datasetRegistry } from "../src/server/services/system-backup/registry.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { prepareReadyRelease } from "../tests/support/release-ready-fixture.ts";

let passed = 0, failed = 0;
const check = async (name: string, run: () => Promise<void>) => {
  try { await run(); passed++; console.log(`OK ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
};
type Completion = { id: string; projectId: string; completedAt: string; targetIterationId: string | null; carriedOverCount: number | null; remainingCount: number | null };
const completeIteration = (actor: Parameters<typeof plans.get>[0], id: string, input: object = {}) =>
  (plans as unknown as { completeIteration: (actor: Parameters<typeof plans.get>[0], id: string, input: object) => Promise<Completion> }).completeIteration(actor, id, input);
const completeRelease = (actor: Parameters<typeof plans.get>[0], id: string) =>
  (plans as unknown as { completeRelease: (actor: Parameters<typeof plans.get>[0], id: string) => Promise<Completion> }).completeRelease(actor, id);

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [admin] = await db.insert(member).values({ username: "lifecycle-admin", email: "lifecycle@test.invalid", name: "计划验收", passwordHash: await hashPassword("lifecycle-password-12345"), status: "ACTIVE" }).returning();
  await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(admin!.id))!;
  const reader = { ...actor, permissions: new Set<string>(), rolePermissions: new Map([["READER", new Set<string>()]]), grants: [{ roleKey: "READER", scopeType: "ORG" as const, scopeId: null }] };
  const p = await createProject(actor, { key: "LIFECYCLE", name: "迭代闭环" });
  const outside = await createProject(actor, { key: "LIFECYCLE2", name: "项目外" });
  const makeIteration = (name: string, projectId = p.id, carryOver = true) => plans.createPlan(actor, projectId, "iteration", { name, startDate: "2026-11-01", endDate: "2026-11-14", carryOver }) as Promise<typeof iteration.$inferSelect>;
  const makeItem = async (title: string, iterationId: string | null = null, releaseId: string | null = null) => (await createWorkItem(actor, p.id, { title, type: "TASK", iterationId, releaseId }))!;

  await check("结束迭代只结转未完成项，并发与重复返回首个稳定统计", async () => {
    const source = await makeIteration("source"), target = await makeIteration("target");
    const pending = await makeItem("pending", source.id), done = await makeItem("done", source.id), canceled = await makeItem("canceled", source.id), deleted = await makeItem("deleted", source.id);
    const [terminal] = await db.insert(workflowState).values({ workflowId: done.workflowId, key: "CUSTOM_FINISHED", name: "自定义终态", category: "TERMINAL", color: "#777777", sortOrder: 99 }).returning();
    await db.update(workItem).set({ statusId: terminal!.id }).where(eq(workItem.id, done.id));
    await db.update(workItem).set({ statusId: terminal!.id }).where(eq(workItem.id, canceled.id));
    await db.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, deleted.id));
    const results = await Promise.all(Array.from({ length: 4 }, () => completeIteration(actor, source.id, { targetIterationId: target.id })));
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(results[0]!.carriedOverCount, 1); assert.equal(results[0]!.remainingCount, 0);
    const rows = await db.select().from(workItem).where(eq(workItem.projectId, p.id));
    assert.equal(rows.find((row) => row.id === pending.id)!.iterationId, target.id);
    assert.equal(rows.find((row) => row.id === pending.id)!.version, 2);
    for (const id of [done.id, canceled.id, deleted.id]) assert.equal(rows.find((row) => row.id === id)!.iterationId, source.id);
    await db.update(workItem).set({ iterationId: null }).where(eq(workItem.id, pending.id));
    assert.deepEqual(await completeIteration(actor, source.id, {}), results[0]);
    const [events] = await sql`select count(*)::int as n from activity_entry where target_id = ${source.id} and action = 'plan.iteration.completed'`;
    assert.equal(events!.n, 1);
    await assert.rejects(() => completeIteration(reader, source.id, {}), { code: "FORBIDDEN" });
    await assert.rejects(() => makeItem("closed-iteration-create", source.id), { code: "BLOCKED_BY_PREREQUISITE" });
    await assert.rejects(() => updateWorkItem(actor, pending.id, { version: 2, iterationId: source.id }), { code: "BLOCKED_BY_PREREQUISITE" });
  });
  await check("结转目标拒绝跨项目、自身、结束和归档且不结束源迭代", async () => {
    const source = await makeIteration("invalid-source"), foreign = await makeIteration("foreign", outside.id), ended = await makeIteration("ended"), archived = await makeIteration("archived");
    await makeItem("invalid-target-item", source.id);
    await completeIteration(actor, ended.id);
    await completeIteration(actor, archived.id);
    await plans.archive(actor, archived.id, "iteration");
    for (const targetIterationId of [source.id, foreign.id]) await assert.rejects(() => completeIteration(actor, source.id, { targetIterationId }), { code: "VALIDATION" });
    for (const targetIterationId of [ended.id, archived.id]) await assert.rejects(() => completeIteration(actor, source.id, { targetIterationId }), { code: "BLOCKED_BY_PREREQUISITE" });
    await assert.rejects(() => completeIteration(actor, source.id), { code: "BLOCKED_BY_PREREQUISITE" });
    assert.equal((await plans.get(actor, source.id, "iteration")).completedAt, null);
  });
  await check("明确回待规划与carryOver=false保留原迭代", async () => {
    const backlog = await makeIteration("backlog"), keep = await makeIteration("keep", p.id, false);
    const b = await makeItem("backlog-item", backlog.id), k = await makeItem("keep-item", keep.id);
    const returned = await completeIteration(actor, backlog.id, { targetIterationId: null });
    assert.equal(returned.carriedOverCount, 1);
    assert.equal((await db.select().from(workItem).where(eq(workItem.id, b.id)))[0]!.iterationId, null);
    const retained = await completeIteration(actor, keep.id);
    assert.equal(retained.carriedOverCount, 0); assert.equal(retained.remainingCount, 1);
    assert.equal((await db.select().from(workItem).where(eq(workItem.id, k.id)))[0]!.iterationId, keep.id);
  });
  for (const stage of ["iteration", "activity_entry"]) await check(`结束迭代 ${stage} 故障回滚结转和完成`, async () => {
    const source = await makeIteration(`fault-${stage}`), target = await makeIteration(`fault-target-${stage}`), item = await makeItem(`fault-item-${stage}`, source.id);
    await sql.unsafe(`create function lifecycle_fail() returns trigger language plpgsql as $$ begin raise exception 'injected lifecycle fault'; end $$;
      create trigger lifecycle_fault before ${stage === "iteration" ? "update" : "insert"} on ${stage} for each row execute function lifecycle_fail()`);
    try { await assert.rejects(() => completeIteration(actor, source.id, { targetIterationId: target.id })); }
    finally { await sql.unsafe(`drop trigger lifecycle_fault on ${stage}; drop function lifecycle_fail()`); }
    assert.equal((await plans.get(actor, source.id, "iteration")).completedAt, null);
    const [unchanged] = await db.select().from(workItem).where(eq(workItem.id, item.id));
    assert.equal(unchanged!.iterationId, source.id); assert.equal(unchanged!.version, 1);
    assert.equal((await completeIteration(actor, source.id, { targetIterationId: target.id })).carriedOverCount, 1);
  });
  await check("结束与新增关联并发后不会留下未完成项挂到已结束迭代", async () => {
    const source = await makeIteration("create-race"), target = await makeIteration("create-race-target");
    const [completion, created] = await Promise.allSettled([completeIteration(actor, source.id, { targetIterationId: target.id }), makeItem("racing-item", source.id)]);
    assert.equal(completion.status, "fulfilled");
    if (created.status === "fulfilled") assert.equal((await db.select().from(workItem).where(eq(workItem.id, created.value.id)))[0]!.iterationId, target.id);
    else assert.equal(created.reason.code, "BLOCKED_BY_PREREQUISITE");
  });
  await check("并发状态流转等待后按最新状态判定未完成项", async () => {
    for (const finishing of [true, false]) {
      const source = await makeIteration(`state-race-${finishing}`), target = await makeIteration(`state-race-target-${finishing}`);
      const item = await makeItem(`state-race-item-${finishing}`, source.id);
      const [terminal] = await db.select().from(workflowState).where(and(eq(workflowState.workflowId, item.workflowId), eq(workflowState.category, "TERMINAL")));
      if (!finishing) await db.update(workItem).set({ statusId: terminal!.id }).where(eq(workItem.id, item.id));
      const blocker = await sql.reserve();
      let completion: Promise<Completion> | undefined;
      let committed = false;
      try {
        await blocker.unsafe('begin');
        await blocker`update work_item set status_id = ${finishing ? terminal!.id : item.statusId} where id = ${item.id}`;
        const [owner] = await blocker`select pg_backend_pid() as pid`;
        completion = completeIteration(actor, source.id, { targetIterationId: target.id });
        const deadline = Date.now() + 5000;
        for (;;) {
          const [waiting] = await blocker`select exists(select 1 from pg_stat_activity where ${owner!.pid} = any(pg_blocking_pids(pid))) as blocked`;
          if (waiting!.blocked) break;
          assert.ok(Date.now() < deadline, "结束请求必须进入工作项锁等待");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await blocker.unsafe('commit');
        committed = true;
        const result = await completion;
        assert.equal(result.carriedOverCount, finishing ? 0 : 1);
        const [after] = await db.select().from(workItem).where(eq(workItem.id, item.id));
        assert.equal(after!.iterationId, finishing ? source.id : target.id);
      } finally { if (!committed) await blocker.unsafe('rollback'); blocker.release(); await completion?.catch(() => {}); }
    }
  });
  await check("完成后归档仍能天然幂等回放首个统计", async () => {
    const source = await makeIteration("completed-archive-replay");
    const first = await completeIteration(actor, source.id);
    await plans.archive(actor, source.id, "iteration");
    assert.deepEqual(await completeIteration(actor, source.id), first);
  });
  await check("迭代与版本归档可恢复、有引用阻断、归档后禁止新关联", async () => {
    for (const kind of ["iteration", "release"] as const) {
      const row = kind === "iteration" ? await makeIteration("archive-cycle") : await plans.createPlan(actor, p.id, kind, { name: "archive-cycle" });
      await assert.rejects(() => plans.archive(actor, row!.id, kind), { code: "BLOCKED_BY_PREREQUISITE" });
      if (kind === "release") await prepareReadyRelease(actor, p.id, row!.id);
      if (kind === "iteration") await completeIteration(actor, row!.id); else await completeRelease(actor, row!.id);
      await plans.archive(actor, row!.id, kind);
      assert.ok(!(await plans.list(actor, p.id, kind)).some((item) => item.id === row!.id));
      assert.ok((await plans.list(actor, p.id, kind, { includeArchived: true })).some((item) => item.id === row!.id));
      await assert.rejects(() => kind === "iteration" ? makeItem("archived-link", row!.id) : makeItem("archived-link", null, row!.id), { code: "BLOCKED_BY_PREREQUISITE" });
      await plans.unarchive(actor, row!.id, kind);
      await assert.rejects(() => kind === "iteration" ? makeItem("linked-block", row!.id) : makeItem("linked-block", null, row!.id), { code: "BLOCKED_BY_PREREQUISITE" });
      await plans.archive(actor, row!.id, kind);
    }
  });
  await check("归档等待中的创建与更新挂载会在项目锁内重验", async () => {
    for (const kind of ["iteration", "release"] as const) {
      const row = kind === "iteration" ? await makeIteration("archive-race") : (await plans.createPlan(actor, p.id, "release", { name: "archive-race" }))!;
      if (kind === "release") await prepareReadyRelease(actor, p.id, row.id);
      if (kind === "iteration") await completeIteration(actor, row.id); else await completeRelease(actor, row.id);
      const item = await makeItem(`archive-race-existing-${kind}`);
      const blocker = await sql.reserve();
      let committed = false;
      const operations: Promise<unknown>[] = [];
      try {
        await blocker.unsafe('begin');
        await blocker`select id from project where id = ${p.id} for update`;
        operations.push(plans.archive(actor, row.id, kind));
        const waitForBlocked = async (minimum: number) => {
          const deadline = Date.now() + 5000;
          for (;;) {
            const [waiting] = await blocker`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
            if (waiting!.n >= minimum) return;
            assert.ok(Date.now() < deadline, "请求必须进入项目锁等待");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        await waitForBlocked(1);
        operations.push(kind === "iteration" ? makeItem("archive-race-create", row.id) : makeItem("archive-race-create", null, row.id));
        operations.push(updateWorkItem(actor, item.id, { version: 1, [kind === "iteration" ? "iterationId" : "releaseId"]: row.id }));
        await waitForBlocked(3);
        await blocker.unsafe('commit'); committed = true;
        const results = await Promise.allSettled(operations);
        assert.equal(results[0]!.status, "fulfilled");
        for (const result of results.slice(1)) {
          assert.equal(result.status, "rejected");
          if (result.status === "rejected") assert.equal(result.reason.code, "BLOCKED_BY_PREREQUISITE");
        }
        assert.equal(await plans.countLinkedWorkItems(kind, row.id), 0);
      } finally { if (!committed) await blocker.unsafe('rollback'); blocker.release(); await Promise.allSettled(operations); }
    }
  });
  await check("版本完成拒绝未完成项，完成后稳定回放且禁止新关联", async () => {
    const row = (await plans.createPlan(actor, p.id, "release", { name: "release-complete" }))!;
    const item = await makeItem("release-pending", null, row.id);
    await assert.rejects(() => completeRelease(actor, row.id), { code: "BLOCKED_BY_PREREQUISITE" });
    const [terminal] = await db.select().from(workflowState).where(and(eq(workflowState.workflowId, item.workflowId), eq(workflowState.category, "TERMINAL")));
    await db.update(workItem).set({ statusId: terminal!.id }).where(eq(workItem.id, item.id));
    await assert.rejects(() => completeRelease(actor, row.id), { code: "BLOCKED_BY_PREREQUISITE" });
    assert.equal((await plans.get(actor, row.id, "release")).completedAt, null);
    await prepareReadyRelease(actor, p.id, row.id);
    const result = await completeRelease(actor, row.id);
    assert.deepEqual(await completeRelease(actor, row.id), result);
    await assert.rejects(() => completeRelease(reader, row.id), { code: "FORBIDDEN" });
    await assert.rejects(() => makeItem("completed-release-link", null, row.id), { code: "BLOCKED_BY_PREREQUISITE" });
  });
  await check("备份编码/恢复解码保留完成结果与归档时间", async () => {
    for (const tableName of ["iteration", "release"]) {
      const dataset = datasetRegistry.find((entry) => entry.tableName === tableName)!;
      const result = { id: "a", carriedOverCount: 3, remainingCount: 0, completedAt: "2026-11-15T00:00:00.000Z" };
      const encoded = dataset.encodeRow({ id: "a", completion_result: result, archived_at: new Date("2026-11-15T01:00:00Z") }, { mode: "safe", purpose: "migration" })!;
      assert.deepEqual(encoded.completion_result, result);
      const decoded = await dataset.decodeRow(encoded, { mode: "safe", phase: "insert" });
      assert.deepEqual(decoded.completion_result, result); assert.ok(decoded.archived_at instanceof Date);
    }
  });

  app = await buildApp({ logger: false });
  const rw = (await createToken(actor, { name: "lifecycle", tier: "READ_WRITE", projectWhitelist: [p.id] })).token;
  const ro = (await createToken(actor, { name: "lifecycle-ro", tier: "READ_ONLY", projectWhitelist: [p.id] })).token;
  let sequence = 0;
  const mcp = async (name: string, args: object, token = rw) => {
    const res = await app!.inject({ method: "POST", url: "/api/v1/mcp", headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, payload: { jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name, arguments: { ...args, ...(name === "meta.capabilities" ? {} : { userConfirmed: true }) } } } });
    assert.equal(res.statusCode, 200);
    const json = res.json(); return json.result ? JSON.parse(json.result.content[0].text) : json.error;
  };
  await check("REST结束入口复读、归档恢复可用；MCP完成/归档具备范围与只读反控", async () => {
    const source = await makeIteration("http-source"), target = await makeIteration("http-target");
    await makeItem("http-item", source.id);
    const login = await app!.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "lifecycle-admin", password: "lifecycle-password-12345" } });
    const cookie = login.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    const headers = { cookie, "x-csrf-token": login.json().csrfToken };
    const endpoint = `/api/v1/iterations/${source.id}/complete`;
    const response = await app!.inject({ method: "POST", url: endpoint, headers, payload: { targetIterationId: target.id } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().completionResult.carriedOverCount, 1);
    const repeat = (await app!.inject({ method: "POST", url: endpoint, headers, payload: {} })).json();
    assert.equal(repeat.alreadyCompleted, true); assert.equal(repeat.movedCount, 0);
    assert.deepEqual(repeat.completionResult, response.json().completionResult);
    const foreign = await makeIteration("mcp-foreign", outside.id), scopedSource = await makeIteration("mcp-scoped-source");
    assert.equal((await mcp("plan.completeIteration", { iterationId: scopedSource.id, targetIterationId: foreign.id })).code, "NOT_FOUND");
    assert.equal((await mcp("plan.completeIteration", { iterationId: scopedSource.id }, ro)).code, "FORBIDDEN");
    const done = await mcp("plan.completeIteration", { iterationId: scopedSource.id });
    assert.ok(done.completedAt);
    const mcpRepeat = await mcp("plan.completeIteration", { iterationId: scopedSource.id });
    assert.equal(mcpRepeat.alreadyCompleted, true); assert.equal(mcpRepeat.movedCount, 0);
    assert.deepEqual(mcpRepeat.completionResult, done.completionResult);
    for (const kind of ["Iteration", "Release"] as const) {
      const row = kind === "Iteration" ? await makeIteration("mcp-archive") : (await plans.createPlan(actor, p.id, "release", { name: "mcp-archive" }))!;
      const key = `${kind.toLowerCase()}Id`;
      if (kind === "Release") {
        assert.equal((await mcp(`plan.complete${kind}`, { [key]: row.id })).code, "BLOCKED_BY_PREREQUISITE");
        await prepareReadyRelease(actor, p.id, row.id);
      }
      assert.ok((await mcp(`plan.complete${kind}`, { [key]: row.id })).completedAt);
      assert.ok((await mcp(`plan.archive${kind}`, { [key]: row.id })).archivedAt);
      assert.equal((await mcp(`plan.unarchive${kind}`, { [key]: row.id })).archivedAt, null);
    }
    const capabilities = await mcp("meta.capabilities", {});
    const flow = capabilities.workflows.find((entry: { id: string }) => entry.id === "planning");
    assert.ok(flow.steps.includes("plan.completeIteration"));
    assert.ok(capabilities.tools.find((tool: { name: string }) => tool.name === "plan.completeRelease"));
    await db.delete(roleAssignment).where(eq(roleAssignment.memberId, actor.memberId));
    assert.equal((await mcp("plan.completeIteration", { iterationId: scopedSource.id })).code, "FORBIDDEN");
  });
  console.log(`结果：${passed} 通过 / ${failed} 失败`); process.exitCode = failed ? 1 : 0;
} finally { await app?.close(); await closeCache(); await sql.end(); }
