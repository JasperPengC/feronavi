/** 独立 worker 的存活、数据库就绪与任务积压观测；缓存是可选加速层。 */
import { createServer } from "node:http";
import { runDatabaseHealthProbe } from "../repos/health.repo.ts";

export async function startWorkerHealth(intervalMs: number) {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
  const backlogSeconds = Number(process.env.WORKER_BACKLOG_WARNING_SECONDS ?? 300);
  const slowPollSeconds = Number(process.env.WORKER_SLOW_POLL_WARNING_SECONDS ?? 300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WORKER_HEALTH_PORT 必须为有效端口");
  if (!Number.isFinite(backlogSeconds) || backlogSeconds <= 0) throw new Error("WORKER_BACKLOG_WARNING_SECONDS 必须大于 0");
  if (!Number.isFinite(slowPollSeconds) || slowPollSeconds <= 0) throw new Error("WORKER_SLOW_POLL_WARNING_SECONDS 必须大于 0");
  let lastCompletedAt: number | null = null;
  let active = false, stopping = false, consecutiveFailures = 0;
  let activeStartedAt: number | null = null;
  let pending: Promise<Record<string, unknown>> | undefined;
  const snapshot = () => {
    if (pending) return pending;
    pending = (async () => {
      const now = Date.now();
      const activeSeconds = activeStartedAt === null ? 0 : Math.max(0, (now - activeStartedAt) / 1000);
      const poll = { active, activeStartedAt: activeStartedAt === null ? null : new Date(activeStartedAt).toISOString(), activeSeconds,
        slowPollWarning: activeSeconds >= slowPollSeconds, slowPollWarningSeconds: slowPollSeconds,
        lastCompletedAt: lastCompletedAt === null ? null : new Date(lastCompletedAt).toISOString(), consecutiveFailures };
      try {
        const rows = await runDatabaseHealthProbe(probe => probe`select
        count(*) filter (where status='PENDING' and run_at <= now())::int as due_pending,
        count(*) filter (where status='RUNNING')::int as running,
        count(*) filter (where status='DEAD')::int as dead,
        coalesce(extract(epoch from now() - min(run_at) filter (where status='PENDING' and run_at <= now())), 0)::float8 as oldest_pending_seconds
        from job where status in ('PENDING','RUNNING','DEAD')`);
        const row = rows[0]!;
        const healthyPoll = active || (lastCompletedAt !== null && now - lastCompletedAt < Math.max(15_000, intervalMs * 3));
        return { ok: !stopping && consecutiveFailures === 0 && healthyPoll, service: "worker", database: "ok", now: new Date(now).toISOString(), poll,
          queue: { duePending: row.due_pending, running: row.running, dead: row.dead, oldestPendingSeconds: Math.max(0, row.oldest_pending_seconds), backlogWarning: row.oldest_pending_seconds >= backlogSeconds, backlogWarningSeconds: backlogSeconds } };
      } catch {
        return { ok: false, service: "worker", database: "down", now: new Date(now).toISOString(), poll };
      }
    })().finally(() => { pending = undefined; });
    return pending;
  };
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/health") { res.writeHead(404); res.end(); return; }
    void snapshot().then(body => { res.writeHead(body.ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, process.env.WORKER_HEALTH_HOST ?? "0.0.0.0", resolve); });
  } catch (error) { server.close(); throw error; }
  const heartbeat = setInterval(() => { void snapshot().then(body => console.info("[job-worker] health", body)); }, 30_000);
  heartbeat.unref();
  return {
    pollStarted: () => { active = true; activeStartedAt = Date.now(); },
    pollCompleted: () => { active = false; activeStartedAt = null; lastCompletedAt = Date.now(); consecutiveFailures = 0; },
    pollFailed: () => { active = false; activeStartedAt = null; consecutiveFailures++; },
    stopping: () => { stopping = true; },
    close: async () => {
      stopping = true; clearInterval(heartbeat);
      await new Promise<void>(resolve => server.close(() => resolve()));
      await pending;
    },
  };
}
