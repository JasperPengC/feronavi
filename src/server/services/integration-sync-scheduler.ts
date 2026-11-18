/**
 * 集成同步定时调度（Round 25 长任务第 39 项）
 *
 * 第 38 轮把"同步一次"做出来了，但没有调度者 —— 研发活跃度仍要管理员点按钮。
 * 本文件补定时调用：按 `INTEGRATION_SYNC_INTERVAL_MS`（默认 6h，0 关闭）扫描**已启用且配置了 repo**
 * 的集成逐个同步；串行执行并**不重叠**（上一轮未结束跳过），失败不阻断其它集成。
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { integration } from "../../db/schema.ts";
import { syncIntegrationInternal, type SyncDeps } from "./integration-sync.service.ts";
import { startScheduledTask } from "./scheduled-task.ts";

export interface SyncSchedulerOptions {
  intervalMs: number;
  lockKey?: number;
  deps?: SyncDeps;
  onResults?: (results: NonNullable<Awaited<ReturnType<typeof syncIntegrationInternal>>>[]) => void;
  onError?: (error: unknown) => void;
}

export interface SyncSchedulerHandle {
  stop: () => Promise<void>;
  runOnce: () => Promise<NonNullable<Awaited<ReturnType<typeof syncIntegrationInternal>>>[]>;
}

export function startIntegrationSyncScheduler(opts: SyncSchedulerOptions): SyncSchedulerHandle {
  const runOnce = async () => {
    const rows = await db.select({ id: integration.id }).from(integration).where(and(
      eq(integration.isActive, true),
      sql`${integration.config}->>'repo' is not null`,
    ));
    const results: NonNullable<Awaited<ReturnType<typeof syncIntegrationInternal>>>[] = [];
    for (const row of rows) {
      try {
        const r = await syncIntegrationInternal(row.id, opts.deps ?? {});
        if (r) results.push(r);
      } catch (error) {
        opts.onError?.(error);
      }
    }
    if (results.length) opts.onResults?.(results);
    return results;
  };
  const task = startScheduledTask({ intervalMs: opts.intervalMs, lockKey: opts.lockKey, run: runOnce, onError: opts.onError });
  return { stop: task.stop, runOnce: async () => (await task.runOnce()) ?? [] };
}
