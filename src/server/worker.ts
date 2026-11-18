/** 独立任务消费者。与 HTTP 服务使用同镜像、同数据库和同 DATA_DIR。 */
import { sql } from "../db/index.ts";
import { runMigrations } from "../db/migrate.ts";
import { registerBuiltinJobHandlers } from "./services/job-handlers.ts";
import { startJobWorker } from "./services/job-worker.ts";

const intervalMs = Number(process.env.JOB_WORKER_INTERVAL_MS ?? 5_000);
if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  throw new Error("独立 worker 的 JOB_WORKER_INTERVAL_MS 必须大于 0");
}

try {
  await runMigrations();
  registerBuiltinJobHandlers();
  const worker = startJobWorker({
    intervalMs,
    keepAlive: true,
    onRun: (stats) => console.info("[job-worker] 任务队列处理完成", stats),
    onError: (err) => console.error("[job-worker] 任务队列处理失败", err),
  });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void worker.stop()
        .then(() => sql.end({ timeout: 10 }))
        .then(() => { process.exitCode = 0; })
        .catch((error: unknown) => { console.error("[job-worker] 停机失败", error); process.exit(1); });
    });
  }
  console.info(`[job-worker] 已启动，轮询间隔 ${intervalMs}ms`);
} catch (error) {
  console.error("[job-worker] 启动失败", error);
  await sql.end({ timeout: 5 });
  process.exitCode = 1;
}
