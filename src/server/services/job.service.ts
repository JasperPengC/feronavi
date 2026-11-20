/**
 * 通用异步任务队列（数据模型 8.6）
 *
 * 真相源在 PG：`SELECT ... WHERE status='PENDING' AND run_at <= now() ORDER BY run_at
 * FOR UPDATE SKIP LOCKED LIMIT n` —— 多 worker 不会重复取。Valkey 只负责"有新任务"的信号，
 * 本实现没有 Valkey 时退化为**轮询**（任务不丢，只是延迟）。
 *
 * 状态机：PENDING → RUNNING → SUCCEEDED / FAILED（未超 max_attempts 回 PENDING 并推后 run_at）/ DEAD。
 * 僵死回收：租约超过10分钟未续期，未耗尽重试次数的任务回到 PENDING，否则进入 DEAD。
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createIndependentSql, db } from "../../db/index.ts";
import { job } from "../../db/schema.ts";
import { databaseContext } from "../../db/context.ts";
import { tryWithSystemRestoreLock } from "./system-backup/restore-lock.ts";

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string | null;
  maxAttempts?: number;
}
export type JobRow = typeof job.$inferSelect;
export type JobHandler = (
  payload: Record<string, unknown>,
  row: JobRow,
) => Promise<void>;

/** 指数退避：5s、10s、20s… 上限 1h（与 Webhook 退避同思路，但队列更密集） */
export function backoffMs(attempts: number): number {
  return Math.min(3_600_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

export async function enqueue(input: EnqueueInput): Promise<JobRow | null> {
  const [row] = await db
    .insert(job)
    .values({
      kind: input.kind,
      payload: (input.payload ?? {}) as object,
      // ⚠️ 默认用**数据库时钟** `now()` 而不是应用 Date：应用与 PG 存在毫秒级时钟偏差，
      // 快速入队后立即 claim 时偶尔会判成"未来任务"而不被取走（全量 e2e 里真实抖动过）。
      runAt: input.runAt ?? sql`now()`,
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // 活跃去重命中：返回既有活跃任务（调用方可据此知道"已有同逻辑任务在排队/执行"）
  if (input.dedupeKey) {
    const existing = (
      await db
        .select()
        .from(job)
        .where(
          and(
            eq(job.dedupeKey, input.dedupeKey),
            sql`${job.status} in ('PENDING','RUNNING')`,
          ),
        )
        .limit(1)
    )[0];
    return existing ?? null;
  }
  return null;
}

/** 取一批到期任务（FOR UPDATE SKIP LOCKED，多 worker 安全） */
export async function claimBatch(
  worker: string,
  limit = 10,
): Promise<JobRow[]> {
  return claimFilteredBatch(worker, limit);
}

async function claimFilteredBatch(
  worker: string,
  limit: number,
  restoreOnly?: boolean,
): Promise<JobRow[]> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      select * from job
      where status = 'PENDING' and run_at <= now()
        and ${restoreOnly === undefined ? sql`true` : restoreOnly ? sql`kind = 'restore.system'` : sql`kind <> 'restore.system'`}
      order by run_at asc
      for update skip locked
      limit ${limit}
    `);
    const ids = (rows as unknown as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return [];
    const claimed = await tx
      .update(job)
      .set({
        status: "RUNNING",
        lockedBy: worker,
        lockedAt: sql`now()`,
        attempts: sql`${job.attempts} + 1`,
        updatedAt: sql`now()`,
      })
      .where(inArray(job.id, ids))
      .returning();
    return claimed;
  });
}

type JobLease = Pick<JobRow, "lockedBy" | "attempts">;
function ownsLease(id: string, lease: JobLease) {
  return and(
    eq(job.id, id),
    eq(job.status, "RUNNING"),
    eq(job.attempts, lease.attempts),
    lease.lockedBy ? eq(job.lockedBy, lease.lockedBy) : sql`false`,
  );
}

export async function markSucceeded(
  id: string,
  lease: JobLease,
): Promise<boolean> {
  const rows = await db
    .update(job)
    .set({
      status: "SUCCEEDED",
      lastError: null,
      lockedBy: null,
      lockedAt: null,
      updatedAt: sql`now()`,
    })
    .where(ownsLease(id, lease))
    .returning({ id: job.id });
  return rows.length > 0;
}

/** 失败：未超上限 → PENDING + 推后 run_at；超限 → DEAD（保留 last_error） */
export async function markFailed(
  id: string,
  error: string,
  lease: JobLease,
): Promise<boolean> {
  const rows = await db
    .update(job)
    .set({
      status: sql`case when ${job.attempts} >= ${job.maxAttempts} then 'DEAD' else 'PENDING' end`,
      lastError: error,
      lockedBy: null,
      lockedAt: null,
      updatedAt: sql`now()`,
      runAt: sql`now() + ${backoffMs(lease.attempts)} * interval '1 millisecond'`,
    })
    .where(ownsLease(id, lease))
    .returning({ id: job.id });
  return rows.length > 0;
}

/** 续租只允许当前执行次数的所有者更新，旧进程无法抢回租约。 */
export async function renewLease(
  id: string,
  lease: JobLease,
  independent?: ReturnType<typeof createIndependentSql>,
): Promise<boolean> {
  if (independent) {
    const rows = await independent`
      update job set locked_at=now(), updated_at=now()
      where id=${id} and status='RUNNING' and attempts=${lease.attempts}
        and locked_by=${lease.lockedBy}
      returning id
    `;
    return rows.length > 0;
  }
  const rows = await db
    .update(job)
    .set({ lockedAt: sql`now()`, updatedAt: sql`now()` })
    .where(ownsLease(id, lease))
    .returning({ id: job.id });
  return rows.length > 0;
}

/** 僵死回收也消耗重试次数，耗尽后进入 DEAD。 */
export async function recoverStalled(): Promise<number> {
  const rows = await db
    .update(job)
    .set({
      status: sql`case when ${job.attempts} >= ${job.maxAttempts} then 'DEAD' else 'PENDING' end`,
      lastError: "任务执行租约已过期",
      lockedBy: null,
      lockedAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(job.status, "RUNNING"),
        sql`(${job.lockedAt} is null or ${job.lockedAt} < now() - interval '10 minutes')`,
      ),
    )
    .returning({ id: job.id });
  return rows.length;
}

export async function listJobCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: job.status, n: sql<number>`count(*)::int` })
    .from(job)
    .groupBy(job.status);
  const out: Record<string, number> = {
    PENDING: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    DEAD: 0,
  };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

const handlers = new Map<string, JobHandler>();
const recoveryHandlers = new Map<string, () => Promise<void>>();
/** Domain recovery is supplied by the composition root, never imported by the queue. */
export function registerJobRecovery(name: string, recover: () => Promise<void>): void {
  recoveryHandlers.set(name, recover);
}

export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}
export function getJobHandler(kind: string): JobHandler | undefined {
  return handlers.get(kind);
}
export function clearJobHandlers(): void {
  handlers.clear();
  recoveryHandlers.clear();
}

/** 按处理能力逐个领取并续租，避免排队等待的任务提前过期。 */
export async function runJobWorkerOnce(
  worker = `worker-${randomUUID()}`,
  limit = 10,
  shouldContinue = () => true,
): Promise<{
  claimed: number;
  succeeded: number;
  failed: number;
  unknown: number;
}> {
  await recoverStalled();
  for (const recover of recoveryHandlers.values()) await recover();
  let claimed = 0,
    succeeded = 0,
    failed = 0,
    unknown = 0;
  let heartbeatSql: ReturnType<typeof createIndependentSql> | undefined;
  const runClaimed = async (
    row: JobRow,
  ): Promise<{ heartbeat?: Promise<unknown> }> => {
    claimed++;
    const handler = handlers.get(row.kind);
    if (!handler) {
      unknown++;
      await markFailed(row.id, `没有注册 kind='${row.kind}' 的处理器`, row);
      return {};
    }
    let heartbeat: Promise<unknown> | undefined;
    // 续租必须在导入长事务之外提交，不能继承其保留连接/事务上下文。
    const timer = databaseContext.exit(() =>
      setInterval(() => {
        if (heartbeat) return;
        heartbeatSql ??= createIndependentSql();
        heartbeat = renewLease(row.id, row, heartbeatSql)
          .catch(() => false)
          .finally(() => {
            heartbeat = undefined;
          });
      }, 60_000),
    );
    timer.unref();
    try {
      await handler((row.payload ?? {}) as Record<string, unknown>, row);
      if (await markSucceeded(row.id, row)) succeeded++;
    } catch (e) {
      if (
        await markFailed(
          row.id,
          (e as Error).message || "处理器抛出未知错误",
          row,
        )
      )
        failed++;
    } finally {
      clearInterval(timer);
      // 恢复任务可能仍持有 DB_POOL_MAX=1 的保留连接；把续租收尾交给调用方，
      // 由恢复锁释放后再等待，避免心跳等待唯一连接而反向阻塞连接释放。
    }
    // 包装成对象避免 async return 自动 assimilate，在恢复锁内等待心跳。
    return { heartbeat };
  };
  try {
    while (claimed < limit && shouldContinue()) {
      const pendingRestore = await db
        .select({ id: job.id })
        .from(job)
        .where(
          and(
            eq(job.kind, "restore.system"),
            eq(job.status, "PENDING"),
            sql`${job.runAt} <= now()`,
          ),
        )
        .limit(1);
      if (pendingRestore.length) {
        const attempt = await tryWithSystemRestoreLock(async () => {
          const [row] = await claimFilteredBatch(worker, 1, true);
          if (!row) return { processed: false };
          const completed = await runClaimed(row);
          return { processed: true, heartbeat: completed.heartbeat };
        });
        if (attempt.acquired && attempt.value?.processed) {
          await attempt.value.heartbeat;
          continue;
        }
      }
      const [row] = await claimFilteredBatch(worker, 1, false);
      if (!row) break;
      const completed = await runClaimed(row);
      await completed.heartbeat;
    }
    return { claimed, succeeded, failed, unknown };
  } finally {
    await heartbeatSql?.end().catch(() => undefined);
  }
}

/** 按到期顺序列出任务（运维排查用；不对外暴露路由） */
export async function listJobs(limit = 50): Promise<JobRow[]> {
  return db.select().from(job).orderBy(asc(job.createdAt)).limit(limit);
}
