/** HTTP 入口；全部调度可关闭，跨实例任务在固定连接上持有会话锁。 */
import { buildApp } from "./app.ts";
import { startScheduledTask, type ScheduledTaskOptions } from "./services/scheduled-task.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
try {
  const { runMigrations } = await import("../db/migrate.ts");
  await runMigrations();
} catch (error) {
  console.error(`[migrate] 自动迁移失败，进程退出：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const app = await buildApp({ logger: process.env.NODE_ENV !== "test" });
const stops: (() => Promise<void>)[] = [];
app.addHook("onClose", async () => { await Promise.all(stops.map((stop) => stop())); });
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}
await app.listen({ port, host });

function schedule<T>(label: string, options: ScheduledTaskOptions<T>) {
  const handle = startScheduledTask({
    ...options,
    onError: (error) => app.log.warn({ err: error }, `${label}失败（不阻断服务）`),
  });
  stops.push(handle.stop);
  return handle;
}

const snapshotInterval = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 3_600_000);
if (snapshotInterval > 0) {
  const { snapshotAllIterations } = await import("./services/insight.service.ts");
  const task = schedule("指标快照", {
    intervalMs: snapshotInterval, lockKey: 742005, run: snapshotAllIterations,
    onResult: (iterations) => app.log.info({ iterations }, "指标快照已写入"),
  });
  await task.runOnce().catch((error) => app.log.warn({ err: error }, "首次指标快照失败"));
}

{
  const { registerBuiltinJobHandlers } = await import("./services/job-handlers.ts");
  registerBuiltinJobHandlers();
  const intervalMs = Number(process.env.JOB_WORKER_INTERVAL_MS ?? 5_000);
  if (intervalMs > 0) {
    const { startJobWorker } = await import("./services/job-worker.ts");
    const worker = startJobWorker({ intervalMs,
      onRun: (stats) => app.log.info({ ...stats }, "任务队列处理完成"),
      onError: (error) => app.log.warn({ err: error }, "任务队列处理失败"),
    });
    stops.push(worker.stop);
  }
}

const integrationInterval = Number(process.env.INTEGRATION_SYNC_INTERVAL_MS ?? 21_600_000);
if (integrationInterval > 0) {
  const { startIntegrationSyncScheduler } = await import("./services/integration-sync-scheduler.ts");
  const task = startIntegrationSyncScheduler({ intervalMs: integrationInterval, lockKey: 742006,
    onResults: (results) => app.log.info({ integrations: results.length, synced: results.reduce((n, row) => n + row.synced, 0) }, "集成同步完成"),
    onError: (error) => app.log.warn({ err: error }, "集成同步失败"),
  });
  stops.push(task.stop);
}

const webhookInterval = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS ?? 30_000);
if (webhookInterval > 0) {
  const { startWebhookRetryScheduler } = await import("./services/webhook-retry.ts");
  const task = startWebhookRetryScheduler({ intervalMs: webhookInterval, lockKey: 742007,
    onResults: (results) => app.log.info({ retried: results.length, results: results.slice(0, 20) }, "Webhook 到期投递已重试"),
    onError: (error) => app.log.warn({ err: error }, "Webhook 重试失败"),
  });
  stops.push(task.stop);
}

const slaInterval = Number(process.env.SLA_SCAN_INTERVAL_MS ?? 60_000);
if (slaInterval > 0) {
  const { scanSlaBreaches } = await import("./services/sla.service.ts");
  schedule("SLA 扫描", { intervalMs: slaInterval, initialDelayMs: 15_000, lockKey: 742001, run: scanSlaBreaches,
    onResult: (result) => { if (result.breached > 0) app.log.info(result, "SLA 违约扫描完成"); },
  });
}
const automationInterval = Number(process.env.AUTOMATION_SCHEDULE_INTERVAL_MS ?? 30_000);
if (automationInterval > 0) {
  const { runScheduledAutomations } = await import("./services/automation.service.ts");
  schedule("定时自动化", { intervalMs: automationInterval, initialDelayMs: 10_000, lockKey: 742003, run: runScheduledAutomations,
    onResult: (result) => { if (result.rules > 0) app.log.info(result, "定时自动化执行完成"); },
  });
}

const retentionInterval = Number(process.env.RETENTION_SWEEP_INTERVAL_MS ?? 86_400_000);
if (retentionInterval > 0) {
  const { pruneHistoricalLogs } = await import("./services/retention.service.ts");
  const { purgeExpired } = await import("./services/idempotency.service.ts");
  const task = schedule("保留期清理", { intervalMs: retentionInterval, lockKey: 742008,
    run: async () => ({ ...(await pruneHistoricalLogs()), idempotencyDeleted: await purgeExpired() }),
    onResult: (result) => {
      if (result.auditDeleted + result.activityDeleted + result.knowledgeDeleted + result.idempotencyDeleted > 0) app.log.info(result, "历史日志与幂等结果已清理");
    },
  });
  await task.runOnce().catch((error) => app.log.warn({ err: error }, "首次保留期清理失败"));
}

const ipGeoInterval = Number(process.env.IPGEO_UPDATE_INTERVAL_MS ?? 7 * 86_400_000);
if (ipGeoInterval > 0) {
  const { warmupIpGeo, checkIpGeoData } = await import("./services/ipgeo.service.ts");
  warmupIpGeo();
  // IP 数据文件可能在各实例本地，每个实例均需检查；仍受本地重入与停机保护。
  schedule("IP 归属地库检查", { intervalMs: ipGeoInterval, initialDelayMs: 30_000,
    run: () => checkIpGeoData(ipGeoInterval),
    onResult: (result) => { if (result.checked) app.log.info({ updated: result.updated, reason: result.reason }, "IP 归属地库检查完成"); },
  });
}
const updateInterval = Number(process.env.UPDATE_CHECK_INTERVAL_MS ?? 86_400_000);
if (updateInterval > 0 && process.env.FERONAVI_UPDATE_REPO) {
  const { checkPlatformUpdate } = await import("./services/update-check.service.ts");
  schedule("平台更新检查", { intervalMs: updateInterval, initialDelayMs: 10_000, lockKey: 742010, run: checkPlatformUpdate,
    onResult: (result) => { if (result.hasUpdate) app.log.info({ current: result.current, latest: result.latest, releaseUrl: result.releaseUrl }, "平台有新版本"); },
  });
}
