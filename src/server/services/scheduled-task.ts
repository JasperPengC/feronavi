/** 可关闭的定时任务：手动/定时共用本地重入保护，可选跨进程会话锁。 */

export async function withAdvisoryLock<T>(key: number, run: () => Promise<T>): Promise<T | undefined> {
  const { sql, onReservedConnection } = await import("../../db/index.ts");
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [row] = await connection<{ ok: boolean }[]>`select pg_try_advisory_lock(${key}) as ok`;
    locked = row?.ok === true;
    if (!locked) return undefined;
    return await onReservedConnection(connection, run);
  } finally {
    // 必须在原会话释放；异常也不能把持锁连接归还给池。
    try {
      if (locked) await connection`select pg_advisory_unlock(${key})`.catch(async (error) => {
        // 任务误留 aborted 事务时先恢复会话；仍无法解锁则断开该后端，避免污染池。
        try { await connection`rollback`; await connection`select pg_advisory_unlock(${key})`; }
        catch { await connection`select pg_terminate_backend(pg_backend_pid())`.catch(() => {}); }
        throw error;
      });
    } finally { connection.release(); }
  }
}

export interface ScheduledTaskOptions<T> {
  intervalMs: number;
  initialDelayMs?: number;
  lockKey?: number;
  run: () => Promise<T>;
  onResult?: (result: T) => void;
  onError?: (error: unknown) => void;
}
export interface ScheduledTask<T> {
  runOnce: () => Promise<T | undefined>;
  stop: () => Promise<void>;
}

export function startScheduledTask<T>(options: ScheduledTaskOptions<T>): ScheduledTask<T> {
  let stopped = false;
  let inFlight: Promise<T | undefined> | undefined;
  const runOnce = (): Promise<T | undefined> => {
    if (stopped) return Promise.resolve(undefined);
    if (inFlight) return inFlight;
    const execute = async () => {
      const result = options.lockKey === undefined
        ? await options.run()
        : await withAdvisoryLock(options.lockKey, options.run);
      if (result !== undefined) options.onResult?.(result);
      return result;
    };
    inFlight = execute().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const tick = () => { void runOnce().catch((error) => { options.onError?.(error); }); };
  const timer = setInterval(tick, Math.max(50, options.intervalMs));
  timer.unref();
  const initial = options.initialDelayMs === undefined ? undefined : setTimeout(tick, options.initialDelayMs);
  initial?.unref();
  return {
    runOnce,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (initial) clearTimeout(initial);
      await inFlight?.catch(() => {});
    },
  };
}
