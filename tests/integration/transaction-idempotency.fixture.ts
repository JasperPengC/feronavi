import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const { currentDatabaseContext, deferAfterCommit } = await import("../../src/db/context.ts");
const { member, idempotencyKey, auditEntry } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { withIdempotency, hashRequest, purgeExpired } = await import("../../src/server/services/idempotency.service.ts");
const { recoverIdempotency } = await import("../../src/server/services/idempotency-recovery.service.ts");
const { withAdvisoryLock, startScheduledTask } = await import("../../src/server/services/scheduled-task.ts");
const external = postgres(process.env.DATABASE_URL!, { max: 1 });
const conflict = (error: unknown) => (error as { code?: string }).code === "CONFLICT";
const checkpoint = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

try {
  if (process.argv[2] === "single-connection-migration") {
    const { runMigrations } = await import("../../src/db/migrate.ts");
    await runMigrations();
    assert.ok(Number((await sql`select count(*) as n from drizzle.__drizzle_migrations`)[0]!.n) > 0);
    await runMigrations();
    console.log("single connection migration contracts passed");
  } else if (process.argv[2] === "interrupt-after-commit-child") {
    await withIdempotency({ actorId: process.argv[3]!, scope: "interrupt", key: "committed-interrupted" }, async () => {
      await sql`insert into transaction_probe(label) values ('committed-interrupted')`;
      deferAfterCommit(async () => { process.send?.("transaction-ready"); await new Promise(() => {}); });
      return { committed: true };
    });
  } else if (process.argv[2] === "interrupt-child") {
    await withIdempotency({ actorId: process.argv[3]!, scope: "interrupt", key: "interrupted" }, async () => {
      await sql`insert into transaction_probe(label) values ('interrupted')`;
      process.send?.("transaction-ready");
      await new Promise(() => {});
    });
  } else if (process.argv[2] === "single-connection") {
    await withAdvisoryLock(884022, async () => {
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;
      const [locked] = await external`select pg_try_advisory_lock(884022) as ok`;
      assert.equal(locked!.ok, false);
      await db.transaction(async () => {
        const [inside] = await sql`select pg_backend_pid() as pid`;
        assert.equal(inside!.pid, pid);
        deferAfterCommit(async () => { const [after] = await sql`select pg_backend_pid() as pid`; assert.equal(after!.pid, pid); });
      });
    });
    console.log("single connection contracts passed");
  } else if (process.argv[2] === "scheduled-followups") {
    const { role, roleAssignment, automationRule, automationRun, workItemSla, comment } = await import("../../src/db/schema.ts");
    const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
    const { createProject } = await import("../../src/server/services/project.service.ts");
    const { createWorkItem, getWorkItem } = await import("../../src/server/services/work-item.service.ts");
    const { createPolicy } = await import("../../src/server/services/sla.service.ts");
    const { createRule, runScheduledAutomations } = await import("../../src/server/services/automation.service.ts");
    const [admin] = await db.insert(member).values({ username: "completion-admin", name: "completion", passwordHash: "no-login", status: "ACTIVE" }).returning();
    const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
    await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
    const actor = (await loadActor(admin!.id))!;
    const project = await createProject(actor, { key: "COMPLETE", name: "completion" });
    // 事务提交会等待创建时的后台链，避免 fixture 自己遗留后台操作。
    const item = (await inTransaction(() => createWorkItem(actor, project.id, { type: "TASK", title: "followup", priority: "LOW" })))!;
    await createPolicy(actor, project.id, { name: "high priority", priority: "HIGH", responseMinutes: 60, resolveMinutes: 120 });
    const invalid = { name: "invalid", trigger: "SCHEDULE", scheduleCron: "* * * * *", conditions: { all: 123 }, actions: [{}] };
    await assert.rejects(createRule(actor, project.id, invalid), (error) => (error as { code: string }).code === "VALIDATION");
    // 模拟升级前已保存的坏规则，扫描应记录失败并继续处理有效规则。
    const [bad] = await db.insert(automationRule).values({ ...invalid, projectId: project.id, createdBy: actor.memberId }).returning();
    await createRule(actor, project.id, { name: "scheduled", trigger: "SCHEDULE", scheduleCron: "* * * * *", scheduleTimezone: "UTC", actions: [{ type: "SET_FIELD", field: "priority", value: "HIGH" }] });
    await createRule(actor, project.id, { name: "followup", trigger: "WORK_ITEM_UPDATED", actions: [{ type: "ADD_COMMENT", body: "completed after scheduled update" }] });
    let nestedPid = 0;
    await withAdvisoryLock(884023, async () => {
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;
      await runScheduledAutomations(new Date("2026-11-08T00:00:00Z"));
      assert.equal((await db.select().from(workItemSla).where(eq(workItemSla.workItemId, item.id))).length, 0);
      deferAfterCommit(async () => {
        const [inside] = await sql`select pg_backend_pid() as pid`; assert.equal(inside!.pid, pid);
        deferAfterCommit(async () => { nestedPid = Number((await sql`select pg_backend_pid() as pid`)[0]!.pid); });
      });
    });
    assert.ok(nestedPid > 0);
    assert.equal((await getWorkItem(actor, item.id)).priority, "HIGH");
    assert.equal((await db.select().from(workItemSla).where(eq(workItemSla.workItemId, item.id))).length, 1);
    const comments = await db.select().from(comment).where(eq(comment.targetId, item.id));
    assert.equal(comments.filter((row) => row.body === "completed after scheduled update").length, 1);
    const failures = await db.select().from(automationRun).where(eq(automationRun.ruleId, bad!.id));
    assert.equal(failures[0]!.status, "FAILED");
    assert.equal((await external`select pg_try_advisory_lock(884023) as ok`)[0]!.ok, true);
    await external`select pg_advisory_unlock(884023)`;
    console.log("scheduled followup contracts passed");
  } else {
    await sql`create table transaction_probe(id serial primary key, label text not null unique)`;
    const [actor] = await db.insert(member).values({ username: "transaction-actor", name: "transaction", passwordHash: "no-login", status: "ACTIVE" }).returning();
    const input = { actorId: actor!.id, scope: "test", key: "retry", body: { title: "same" } };
    const count = async (label: string) => Number((await sql`select count(*) as n from transaction_probe where label = ${label}`)[0]!.n);
    let afterCommit = 0;
    await assert.rejects(withIdempotency(input, async () => {
      await sql`insert into transaction_probe(label) values ('rollback-tagged')`;
      await sql.unsafe("insert into transaction_probe(label) values ($1)", ["rollback-raw"]);
      await db.insert(member).values({ username: "rollback-drizzle", name: "rollback", passwordHash: "no-login", status: "ACTIVE" });
      deferAfterCommit(async () => { afterCommit++; });
      throw new Error("planned rollback");
    }), /planned rollback/u);
    assert.equal(await count("rollback-tagged"), 0); assert.equal(await count("rollback-raw"), 0);
    assert.equal((await db.select().from(member).where(eq(member.username, "rollback-drizzle"))).length, 0);
    assert.equal(afterCommit, 0);
    const successful = await withIdempotency(input, async () => {
      await sql`insert into transaction_probe(label) values ('committed')`;
      deferAfterCommit(async () => { assert.equal(currentDatabaseContext(), undefined); afterCommit++; await sql`select 1`; });
      return { id: "committed" };
    });
    assert.deepEqual(successful, { replayed: false, value: { id: "committed" } });
    assert.deepEqual(await withIdempotency(input, async () => { throw new Error("must replay"); }), { replayed: true, value: { id: "committed" } });
    assert.equal(afterCommit, 1); assert.equal(await count("committed"), 1);
    await assert.rejects(withIdempotency({ ...input, body: { different: true } }, async () => null), conflict);

    await inTransaction(async () => {
      await db.transaction(async () => { await sql`insert into transaction_probe(label) values ('nested-commit')`; });
      await assert.rejects(db.transaction(async () => {
        await sql`insert into transaction_probe(label) values ('nested-rollback')`;
        deferAfterCommit(async () => { afterCommit += 100; });
        throw new Error("savepoint failure");
      }), /savepoint failure/u);
      await sql.begin(async (tx) => { await tx.unsafe("insert into transaction_probe(label) values ($1)", ["native-nested"]); });
    });
    assert.equal(await count("nested-commit"), 1); assert.equal(await count("nested-rollback"), 0);
    assert.equal(await count("native-nested"), 1); assert.equal(afterCommit, 1);
    await sql.begin("isolation level serializable", async (tx) => {
      const [level] = await tx`show transaction_isolation`; assert.equal(level!.transaction_isolation, "serializable");
      await tx.savepoint(async () => { await db.execute((await import("drizzle-orm")).sql`select 1`); });
    });
    await assert.rejects(inTransaction(async () => { await sql`select 1/0`.catch(() => {}); }), /事务未提交/u);

    const started = checkpoint(); const finish = checkpoint(); let businessCalls = 0;
    const racing = { ...input, key: "parallel" };
    const first = withIdempotency(racing, async () => { businessCalls++; started.resolve(); await finish.promise; return { id: "one" }; });
    await started.promise;
    await assert.rejects(withIdempotency(racing, async () => { businessCalls++; return null; }), conflict);
    finish.resolve(); await first; assert.equal(businessCalls, 1);

    await db.update(idempotencyKey).set({ expiresAt: new Date(0) }).where(eq(idempotencyKey.key, input.key));
    assert.equal((await withIdempotency({ ...input, body: { new: true } }, async () => ({ fresh: true }))).replayed, false);
    const legacy = { ...input, key: "legacy" };
    await db.insert(idempotencyKey).values({ ...legacy, requestHash: hashRequest(input.body), state: "IN_PROGRESS", expiresAt: new Date(0) });
    await purgeExpired();
    await assert.rejects(withIdempotency(legacy, async () => { throw new Error("must never execute"); }), conflict);
    const cli = fileURLToPath(new URL("../../src/server/cli/idempotency-recover.ts", import.meta.url));
    const inspected = await promisify(execFile)(process.execPath, [cli, "--actor-id", actor!.id, "--scope", input.scope, "--key", "legacy"], { env: process.env });
    assert.equal(JSON.parse(inspected.stdout).state, "IN_PROGRESS"); assert.equal(JSON.parse(inspected.stdout).key, undefined);
    await recoverIdempotency({ ...legacy, expectedRequestHash: hashRequest(input.body), operatorId: actor!.id, evidence: "isolated fixture verified rollback", resolution: "ROLLED_BACK" });
    assert.equal((await withIdempotency(legacy, async () => ({ recovered: true }))).replayed, false);
    const committedLegacy = { ...legacy, key: "legacy-committed" };
    await db.insert(idempotencyKey).values({ ...committedLegacy, requestHash: hashRequest(input.body), state: "IN_PROGRESS", expiresAt: new Date(0) });
    await recoverIdempotency({ ...committedLegacy, expectedRequestHash: hashRequest(input.body), operatorId: actor!.id, evidence: "isolated fixture verified existing result", resolution: "COMMITTED", response: { existing: true } });
    assert.deepEqual(await withIdempotency(committedLegacy, async () => { throw new Error("must replay restored response"); }), { replayed: true, value: { existing: true } });
    const audits = await db.select().from(auditEntry).where(eq(auditEntry.targetType, "idempotency")); assert.equal(audits.length, 2);
    assert.ok(audits.every((entry) => entry.actorId === actor!.id && entry.severity === "SECURITY"));

    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "interrupt-child", actor!.id], { env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let childError = ""; child.stderr!.on("data", (chunk) => { childError += String(chunk); });
    const ready = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error(`child ended early: ${childError}`); })]);
    assert.equal(ready[0], "transaction-ready"); child.kill("SIGKILL"); await once(child, "exit");
    const interrupted = { actorId: actor!.id, scope: "interrupt", key: "interrupted" };
    // 后端检测客户端断开可能稍迟；仅对持锁冲突短暂重试，不重跑已成功业务。
    for (let attempt = 0; ; attempt++) {
      try { await withIdempotency(interrupted, async () => { await sql`insert into transaction_probe(label) values ('interrupted')`; return { recovered: true }; }); break; }
      catch (error) { if (!conflict(error) || attempt > 40) throw error; await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    assert.equal(await count("interrupted"), 1);
    const committedChild = spawn(process.execPath, [fileURLToPath(import.meta.url), "interrupt-after-commit-child", actor!.id], { env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const committedReady = await Promise.race([once(committedChild, "message"), once(committedChild, "exit").then(() => { throw new Error("post-commit child ended early"); })]);
    assert.equal(committedReady[0], "transaction-ready"); committedChild.kill("SIGKILL"); await once(committedChild, "exit");
    assert.deepEqual(await withIdempotency({ ...interrupted, key: "committed-interrupted" }, async () => { throw new Error("must replay committed result after process interruption"); }), { replayed: true, value: { committed: true } });
    assert.equal(await count("committed-interrupted"), 1);

    const locked = checkpoint(); const unlock = checkpoint();
    const scheduled = startScheduledTask({ intervalMs: 60_000, lockKey: 884021, run: async () => {
      const [current] = await sql`select pg_backend_pid() as pid`;
      const [owner] = await external`select pid from pg_locks where locktype = 'advisory' and objid = 884021 and granted`;
      assert.equal(current!.pid, owner!.pid); locked.resolve(); await unlock.promise; return true;
    } });
    const running = scheduled.runOnce(); await locked.promise;
    assert.equal((await external`select pg_try_advisory_lock(884021) as ok`)[0]!.ok, false);
    assert.equal(await withAdvisoryLock(884021, async () => { throw new Error("already locked"); }), undefined);
    assert.equal(scheduled.runOnce(), running);
    let stopped = false; const stopping = scheduled.stop().then(() => { stopped = true; }); await Promise.resolve(); assert.equal(stopped, false);
    unlock.resolve(); await Promise.all([running, stopping]); assert.equal(stopped, true);
    await assert.rejects(withAdvisoryLock(884021, async () => { throw new Error("task failure"); }), /task failure/u);
    assert.equal((await external`select pg_try_advisory_lock(884021) as ok`)[0]!.ok, true); await external`select pg_advisory_unlock(884021)`;
    await assert.rejects(withAdvisoryLock(884021, async () => { await sql`begin`; await sql`select 1/0`; }));
    assert.equal((await external`select pg_try_advisory_lock(884021) as ok`)[0]!.ok, true); await external`select pg_advisory_unlock(884021)`;
    console.log("transaction idempotency contracts passed");
  }
} finally { await external.end({ timeout: 5 }); await sql.end({ timeout: 5 }); }
