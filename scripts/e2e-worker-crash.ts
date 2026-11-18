/** 真实 SIGKILL 后重领 PostgreSQL 租约；只在随机测试库运行。 */
import "./_env.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { db, sql } from "../src/db/index.ts";
import { job } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import * as queue from "../src/server/services/job.service.ts";

const mode = process.argv[2];
if (mode === "crash" || mode === "replacement") {
  queue.registerJobHandler("recovery.crash", async (_payload, row) => {
    process.send?.({ type: "claimed", row });
    if (mode === "crash") await new Promise<void>(() => { setInterval(() => {}, 1000); });
  });
  try {
    const stats = await queue.runJobWorkerOnce(`recovery-${mode}`, 1);
    assert.equal(stats.succeeded, 1);
    console.log("replacement worker succeeded");
  } finally { await sql.end({ timeout: 2 }); process.disconnect?.(); }
} else {
  let child: ChildProcess | undefined;
  const start = (next: "crash" | "replacement") => spawn(process.execPath, [fileURLToPath(import.meta.url), next], {
    env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const timeout = setTimeout(() => { child?.kill("SIGKILL"); process.exitCode = 1; }, 30_000);
  try {
    const queued = await queue.enqueue({ kind: "recovery.crash", payload: { confirmed: true }, maxAttempts: 3 });
    assert.ok(queued);
    child = start("crash");
    const [claimed] = await once(child, "message", { signal: AbortSignal.timeout(10_000) }) as [{ type: string; row: queue.JobRow }];
    assert.equal(claimed.row.id, queued.id);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    const [, signal] = await exited;
    assert.equal(signal, "SIGKILL");
    let row = (await db.select().from(job).where(eq(job.id, queued.id)))[0]!;
    assert.equal(row.status, "RUNNING");
    assert.deepEqual(row.payload, { confirmed: true });
    console.log("OK worker SIGKILL 后已确认任务与 payload 保留");
    // 加速测试：只把本次任务租约推进至过期，不改变生产的十分钟回收阈值。
    await db.update(job).set({ lockedAt: new Date(Date.now() - 660_000) }).where(eq(job.id, queued.id));
    child = start("replacement");
    const [code] = await once(child, "exit", { signal: AbortSignal.timeout(10_000) });
    assert.equal(code, 0);
    row = (await db.select().from(job).where(eq(job.id, queued.id)))[0]!;
    assert.equal(row.status, "SUCCEEDED");
    assert.equal(row.attempts, 2);
    console.log("OK 新 worker 回收过期租约并成功执行第二次尝试");
    await queue.markFailed(queued.id, "obsolete process", claimed.row);
    await queue.markSucceeded(queued.id, claimed.row);
    assert.equal((await db.select().from(job).where(eq(job.id, queued.id)))[0]!.status, "SUCCEEDED");
    console.log("OK 旧消费者租约不能覆盖新结果");
  } finally {
    clearTimeout(timeout); child?.kill("SIGKILL"); await sql.end({ timeout: 2 });
  }
}
