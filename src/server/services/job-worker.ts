/**
 * 通用任务 worker（Round 25 长任务第 45 项）
 *
 * 轮询 PG（无 Valkey 时任务不丢，只是延迟）；`JOB_WORKER_INTERVAL_MS` 默认 5s，0 关闭。
 * 可由 server 内置启动或独立 worker 入口启动；e2e 直接调 runJobWorkerOnce 避免后台干扰。
 */
import { runJobWorkerOnce } from "./job.service.ts";

export interface JobWorkerOptions {
  intervalMs: number;
  keepAlive?: boolean;
  onRun?: (stats: Awaited<ReturnType<typeof runJobWorkerOnce>>) => void;
  onError?: (error: unknown) => void;
  onPollStart?: () => void;
  onPollComplete?: () => void;
}

export function startJobWorker(opts: JobWorkerOptions): { stop: () => Promise<void>; runOnce: () => ReturnType<typeof runJobWorkerOnce> } {
  type Stats = Awaited<ReturnType<typeof runJobWorkerOnce>>;
  let inFlight: Promise<Stats> | null = null;
  let stopped = false;
  const run = (): Promise<Stats> => {
    if (stopped) return Promise.resolve({ claimed: 0, succeeded: 0, failed: 0, unknown: 0 });
    if (inFlight) return inFlight;
    opts.onPollStart?.();
    inFlight = runJobWorkerOnce(undefined, 10, () => !stopped).then(stats => {
      opts.onPollComplete?.();
      if (stats.claimed > 0) opts.onRun?.(stats);
      return stats;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => {
    if (!stopped && !inFlight) void run().catch(e => opts.onError?.(e));
  }, Math.max(500, opts.intervalMs));
  if (!opts.keepAlive) timer.unref();
  return {
    stop: async () => { stopped = true; clearInterval(timer); await inFlight?.catch(() => {}); },
    runOnce: run,
  };
}
