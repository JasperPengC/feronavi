/**
 * Webhook 退避重试调度（Round 25 长任务第 24 项）
 *
 * 背景：`retryDue()` 与退避表（1/5/30/120/720 分钟）早已实现，设置页文案也承诺"失败退避重试"，
 * 但**没有任何调度者** —— 失败投递永远停在 RETRYING，只有人工重放一条路。本文件补"谁来定时调用"。
 *
 * 纪律：
 *   · 默认 30s 一次（`WEBHOOK_RETRY_INTERVAL_MS=0` 可关闭，测试/特殊部署用）；
 *   · **不重叠执行**：上一轮未结束时跳过本轮（避免同一批到期记录被并发重复投递）；
 *   · `unref()`：调度不阻止进程退出；返回 stop 句柄供测试与优雅停机使用；
 *   · 依赖可注入（fetchImpl）——测试用假接收端，不削弱生产 SSRF/签名防护。
 */
import { retryDue, type DeliveryDeps } from "./webhook.service.ts";
import { startScheduledTask } from "./scheduled-task.ts";

export interface RetrySchedulerOptions {
  intervalMs: number;
  lockKey?: number;
  limit?: number;
  deps?: DeliveryDeps;
  onResults?: (results: Awaited<ReturnType<typeof retryDue>>) => void;
  onError?: (error: unknown) => void;
}

export interface RetrySchedulerHandle {
  stop: () => Promise<void>;
  /** 立即执行一次（不等待 interval；测试与运维手动触发用） */
  runOnce: () => Promise<Awaited<ReturnType<typeof retryDue>>>;
}

export function startWebhookRetryScheduler(opts: RetrySchedulerOptions): RetrySchedulerHandle {
  const task = startScheduledTask({
    intervalMs: opts.intervalMs, lockKey: opts.lockKey,
    run: () => retryDue(opts.limit ?? 50, opts.deps ?? {}),
    onResult: (results) => { if (results.length > 0) opts.onResults?.(results); },
    onError: opts.onError,
  });
  return { stop: task.stop, runOnce: async () => (await task.runOnce()) ?? [] };
}
