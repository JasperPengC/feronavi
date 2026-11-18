/**
 * 幂等执行（第十三期，数据模型 8.4）
 *
 * 语义（照规范逐条）：
 *   - 幂等域 = `(key, actor_id, scope)`：同一 key 在不同端点/工具互不干扰，且按调用者隔离
 *   - **同键不同体** → `CONFLICT`（应用层判为误用，不静默按旧结果返回）
 *   - 已完成（DONE）→ **原样重放**已存响应（状态码与响应体）
 *   - 进行中（IN_PROGRESS）→ `CONFLICT`（并发重复提交，不能让它跑两遍）
 *   - 默认 24 小时过期
 */
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, inTransaction } from "../../db/index.ts";
import { idempotencyKey } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";

const TTL_MS = 24 * 60 * 60 * 1000;

export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export interface IdempotentResult<T> { replayed: boolean; value: T }

/**
 * 包一层幂等：`key` 为空则直接执行（幂等是可选能力，不是强制要求）。
 * 返回 `replayed: true` 表示这次没有真正执行，返回的是首次的响应。
 */
export async function withIdempotency<T>(
  opts: { actorId: string; key?: string | null; scope: string; body?: unknown },
  fn: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  if (!opts.key) return { replayed: false, value: await fn() };

  const key = opts.key;
  return inTransaction(async () => {
    // 事务锁覆盖完整生命周期：进程中断/回滚自动释放，其他请求不会重复执行。
    const locks = await db.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${JSON.stringify([opts.actorId, opts.scope, key])}, 0)) as ok`);
    if (!(locks as unknown as { ok: boolean }[])[0]?.ok) {
      throw new DomainError("CONFLICT", "相同请求正在处理中，请稍后重试", { scope: opts.scope });
    }
    const where = and(eq(idempotencyKey.key, key), eq(idempotencyKey.actorId, opts.actorId), eq(idempotencyKey.scope, opts.scope));
    const requestHash = hashRequest(opts.body);
    const existing = (await db.select().from(idempotencyKey).where(where).limit(1))[0];
    if (existing) {
      // 新实现永远不会提交 IN_PROGRESS；这类已持久化记录来自旧版本，不能猜测业务是否已提交。
      if (existing.state === "IN_PROGRESS") {
        throw new DomainError("CONFLICT", "旧请求结果待核对，请使用幂等恢复命令确认后处理", { scope: opts.scope, recoveryRequired: true });
      }
      if (existing.expiresAt.getTime() > Date.now()) {
        if (existing.requestHash !== requestHash) throw new DomainError("CONFLICT", "同一幂等键被用于了不同的请求内容", { scope: opts.scope });
        return { replayed: true, value: existing.responseBody as T };
      }
      await db.delete(idempotencyKey).where(where);
    }
    await db.insert(idempotencyKey).values({
      key, actorId: opts.actorId, scope: opts.scope, requestHash,
      state: "IN_PROGRESS", expiresAt: new Date(Date.now() + TTL_MS),
    });
    const value = await fn();
    await db.update(idempotencyKey).set({ state: "DONE", responseStatus: 200, responseBody: value as object }).where(where);
    return { replayed: false, value };
  });
}

/** 仅清理已完成的过期键；旧结果不明记录必须经可审计的人工恢复。 */
export async function purgeExpired(): Promise<number> {
  const rows = await db.delete(idempotencyKey).where(and(eq(idempotencyKey.state, "DONE"), lt(idempotencyKey.expiresAt, new Date()))).returning({ key: idempotencyKey.key });
  return rows.length;
}
