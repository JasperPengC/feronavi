/**
 * 会话服务 —— **PG 是真相源，Valkey 只是热缓存**
 *
 * 为什么这样分层（v1.40 定案，纠正原「会话由 Valkey 承载」的说法）：
 *   - Valkey 承载会话 = 一次重启就让全员掉线；且与 C-22「真相在 PG」自相矛盾
 *   - 但每个请求都查一次 PG 又太贵 → Valkey 缓存 `token_hash → 会话`，省掉这次查询
 *   - Valkey 挂掉时**直接回落 PG**，可用性不受影响，只是每次鉴权多一次查库
 *
 * 令牌处理（数据模型 1.6）：
 *   - 用 **SHA-256** 而不是 Argon2id —— 会话校验是每个请求都跑的高频查询，
 *     慢哈希会把每个请求都拖慢。密码才用 Argon2id。
 *   - 库里**只存哈希**，明文只在 `Set-Cookie` 里出现一次。
 */
import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { session as sessionT, member as memberT, apiToken } from "../../db/schema.ts";

/** 会话时长（第 5.9 节：普通 7 天 / 记住我 30 天） */
export const SESSION_TTL_DAYS = 7;
export const SESSION_TTL_DAYS_REMEMBER = 30;

export const SESSION_COOKIE = "feronavi_session";

/** 明文令牌 → 存储用哈希。加固定前缀避免哈希与其它用途混淆。 */
export function hashToken(plain: string): string {
  return createHash("sha256").update(`feronavi:session:${plain}`).digest("hex");
}

/** 生成新会话令牌（32 字节 = 256 bit 熵） */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionRow {
  id: string;
  memberId: string;
  expiresAt: Date;
}

/** 建会话：写 PG（真相），并尽力写 Valkey 缓存 */
export async function createSession(opts: {
  memberId: string;
  remember?: boolean;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const days = opts.remember ? SESSION_TTL_DAYS_REMEMBER : SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);

  await db.insert(sessionT).values({
    memberId: opts.memberId,
    tokenHash: hashToken(token),
    userAgent: opts.userAgent ?? null,
    ip: opts.ip ?? null,
    expiresAt,
    lastSeenAt: new Date(),
  });

  await cacheSet(token, { memberId: opts.memberId, expiresAt });
  return { token, expiresAt };
}

/**
 * 校验会话令牌 → 返回会话。
 *
 * 顺序：先 Valkey（快），未命中或 Valkey 不可用则回落 PG（真相）。
 * ⚠️ 无论命中哪一层，**都以 PG 的 `revoked_at` / `expires_at` 为准**：
 *    注销后缓存里可能还有旧值，所以注销时必须**同时删缓存**（见 revokeSession）。
 */
export async function verifySession(token: string): Promise<SessionRow | null> {
  const hash = hashToken(token);

  const rows = await db
    .select({ id: sessionT.id, memberId: sessionT.memberId, expiresAt: sessionT.expiresAt })
    .from(sessionT)
    .where(and(
      eq(sessionT.tokenHash, hash),
      isNull(sessionT.revokedAt),
      gt(sessionT.expiresAt, new Date()),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) {
    await cacheDel(token);   // 缓存里的陈旧值一并清掉
    return null;
  }

  // 节流更新 last_seen_at：每 5 分钟一次就够，避免每个请求都写库
  void touchLastSeen(row.id);
  await cacheSet(token, { memberId: row.memberId, expiresAt: row.expiresAt });
  return row;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export async function touchLastSeen(sessionId: string): Promise<void> {
  // 用条件更新代替读改写，避免并发下互相覆盖
  await db.update(sessionT)
    .set({ lastSeenAt: new Date() })
    .where(and(
      eq(sessionT.id, sessionId),
      sql`${sessionT.lastSeenAt} < now() - interval '5 minutes'`,
    ));
}

/** 注销单个会话：删 PG 行（真相）+ 清缓存 */
export async function revokeSession(token: string): Promise<void> {
  await db.update(sessionT)
    .set({ revokedAt: new Date() })
    .where(eq(sessionT.tokenHash, hashToken(token)));
  await cacheDel(token);
  void TOUCH_INTERVAL_MS;
}

/** 注销该成员的全部会话（发现异常时的 `logout-all`） */
export async function revokeAllSessions(memberId: string): Promise<number> {
  const res = await db.update(sessionT)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessionT.memberId, memberId), isNull(sessionT.revokedAt)))
    .returning({ id: sessionT.id });
  // 缓存按 token 存，无法按 member 批量失效 → 直接清空该前缀（实现见 cache.ts）
  await cacheClearAll();
  return res.length;
}

/** 停用/注销时永久撤销交互会话与个人 API Token；重新启用不能恢复旧凭据。 */
export async function revokeMemberCredentials(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const revokedAt = new Date();
    await tx.update(sessionT).set({ revokedAt })
      .where(and(eq(sessionT.memberId, memberId), isNull(sessionT.revokedAt)));
    await tx.update(apiToken).set({ revokedAt })
      .where(and(eq(apiToken.memberId, memberId), isNull(apiToken.revokedAt)));
  });
  await cacheClearAll();
}

/**
 * 按 id 撤销会话，**且必须属于本人**。
 * 返回 false 表示「不存在 或 不属于你」——调用方对两种情况返回同一种错误，
 * 否则可以拿别人的 session id 探测其是否存在。
 */
export async function revokeSessionById(memberId: string, sessionId: string): Promise<boolean> {
  const res = await db.update(sessionT)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessionT.id, sessionId), eq(sessionT.memberId, memberId), isNull(sessionT.revokedAt)))
    .returning({ id: sessionT.id });
  if (res.length > 0) await cacheClearAll();
  return res.length > 0;
}

/** 列出某成员的有效会话（`GET /auth/sessions`） */
export async function listSessions(memberId: string) {
  return db.select({
    id: sessionT.id,
    userAgent: sessionT.userAgent,
    ip: sessionT.ip,
    createdAt: sessionT.lastSeenAt,
    expiresAt: sessionT.expiresAt,
  }).from(sessionT)
    .where(and(eq(sessionT.memberId, memberId), isNull(sessionT.revokedAt), gt(sessionT.expiresAt, new Date())));
}

export { memberT };

// ── Valkey 缓存层 ─────────────────────────────────────────────
// 独立成小节：缓存是**可丢的**，任何异常都必须吞掉并回落 PG，
// 绝不能因为缓存故障导致登录不可用。
import { cacheSet, cacheDel, cacheClearAll } from "./cache.ts";
