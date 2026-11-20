import assert from "node:assert/strict";

assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = ((
  fn: TimerHandler,
  delay?: number,
  ...args: unknown[]
) =>
  nativeSetInterval(
    fn,
    delay === 60_000 ? 10 : delay,
    ...args,
  )) as typeof setInterval;

const { db, sql } = await import("../../src/db/index.ts");
const { job } = await import("../../src/db/schema.ts");
const queue = await import("../../src/server/services/job.service.ts");
const { tryWithSystemRestoreLock } =
  await import("../../src/server/services/system-backup/restore-lock.ts");
let observed = false;
queue.registerJobHandler("restore.system", async (_payload, row) => {
  const before = row.lockedAt?.getTime() ?? 0;
  await new Promise((resolve) => setTimeout(resolve, 80));
  const rows = await sql<
    { locked_at: Date | null }[]
  >`select locked_at from job where id=${row.id}`;
  observed =
    (rows[0]?.locked_at ? new Date(rows[0].locked_at).getTime() : 0) > before;
});
try {
  const enqueued = await queue.enqueue({
    kind: "restore.system",
    payload: {},
    maxAttempts: 1,
  });
  assert.equal(enqueued?.status, "PENDING");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const result = await queue.runJobWorkerOnce("heartbeat-worker", 1);
  assert.equal(result.succeeded, 1);
  assert.equal(observed, true, "独立心跳应在DB_POOL_MAX=1保留连接期间更新租约");
  const lock = await tryWithSystemRestoreLock(async () => true);
  assert.equal(lock.acquired, true, "worker完成后恢复锁应可重新获取");
  const rows = await db.select().from(job);
  assert.equal(rows.at(-1)?.status, "SUCCEEDED");
  console.log("job heartbeat isolated pool passed");
} finally {
  await sql.end({ timeout: 2 });
}
