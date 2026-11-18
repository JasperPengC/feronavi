/** 子进程中使用真实 PG，验证停止期间任务不会被打断或继续领取。 */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "../../src/db/index.ts";
import { enqueue, registerJobHandler } from "../../src/server/services/job.service.ts";
import { startJobWorker } from "../../src/server/services/job-worker.ts";

const name = new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1);
assert.match(name, /^feronavi_test_[a-f0-9]{32}$/u);
const started = Promise.withResolvers<void>();
const finish = Promise.withResolvers<void>();
registerJobHandler("test.shutdown", async () => { started.resolve(); await finish.promise; });
const task = await enqueue({ kind: "test.shutdown" });
assert.ok(task);
const worker = startJobWorker({ intervalMs: 500, keepAlive: true });
try {
  await started.promise;
  const later = await enqueue({ kind: "test.shutdown" });
  assert.ok(later);
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await delay(50);
  assert.equal(stopped, false, "任务仍在执行，stop 不应提前完成");
  finish.resolve();
  await stopping;
  const [completed] = await sql`select status from job where id = ${task.id}`;
  assert.equal(completed?.status, "SUCCEEDED");
  await delay(600);
  const [pending] = await sql`select status from job where id = ${later.id}`;
  assert.equal(pending?.status, "PENDING", "stop 后不能继续领取任务");
  await sql`delete from job where kind = 'test.shutdown'`;
} finally {
  finish.resolve();
  await worker.stop();
  await sql.end({ timeout: 5 });
}
