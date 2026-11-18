/**
 * API 令牌（第六期 W2，规范 1.7 + REST 10 节 /api/v1/tokens）
 *
 * 三条硬规则：
 *   1 明文**只在创建响应里出现一次**；库里只存 SHA-256（规范明确：令牌靠等值查找，
 *      含随机盐的 Argon2id 永远匹配不上）
 *   2 校验链任何一步失败都返回**同一形状**的错误 —— 不暴露"存在但过期"与"不存在"的区别
 *   3 档位是**上限**不是授权本身：实际能力 = 账号权限 ∩ 档位 ∩ 项目白名单（第 4.9 节）
 */
import { createHash, randomBytes } from "node:crypto";
import { isIPv4 } from "node:net";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { apiToken } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { loadActor } from "../auth/actor-loader.ts";

export const TIERS = ["READ_ONLY", "READ_WRITE", "ADMIN"] as const;
export type Tier = (typeof TIERS)[number];

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** 生成明文：fero_ + 32 字节 base64url（43 字符） */
function newToken(): { raw: string; hash: string; prefix: string } {
  const raw = `fero_${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hash(raw), prefix: `fero_…${raw.slice(-4)}` };
}

/** IPv4 CIDR 匹配（规范允许 allowed_ip_cidrs；空数组 = 不限制） */
export function ipAllowed(ip: string | null, cidrs: string[]): boolean {
  if (!cidrs.length) return true;
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  if (!isIPv4(clean)) return false;
  const toInt = (s: string) => s.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
  for (const c of cidrs) {
    const [net, bitsRaw, extra] = c.split("/");
    if (!net || !isIPv4(net) || extra !== undefined || (bitsRaw !== undefined && !/^\d{1,2}$/.test(bitsRaw))) continue;
    const bits = Number(bitsRaw ?? 32);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    try {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((toInt(clean) & mask) === (toInt(net) & mask)) return true;
    } catch { /* 无法解析的规则视为不匹配 */ }
  }
  return false;
}

export interface TokenContext {
  memberId: string;
  tier: Tier;
  projectWhitelist: string[];
  tokenId: string;
}

/** 创建（返回明文一次）。仅本人可建：权限 apikey:manage_own */
export async function createToken(actor: Actor, input: {
  name: string;
  tier: string;
  projectWhitelist?: string[];
  allowedIpCidrs?: string[];
  expiresAt?: string | null;
}) {
  if (actor.mustChangePassword) throw new DomainError("FORBIDDEN", "请先修改初始密码", null);
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  // ⚠️ 引擎的 `_own` 语义要求资源带 createdBy（同 work_item:update_own）——
  //    "manage_own" = 管理**自己的**令牌，故 createdBy 传当前成员。
  if (!can(actor, "apikey:manage_own", { projectId: null, teamId: null, createdBy: actor.memberId }, ctx)) {
    throw forbidden();
  }
  if (!(TIERS as readonly string[]).includes(input.tier)) {
    throw new DomainError("VALIDATION", `档位只支持 ${TIERS.join(" / ")}`, null);
  }
  const t = newToken();
  const [row] = await db.insert(apiToken).values({
    memberId: actor.memberId,
    name: input.name,
    tokenHash: t.hash,
    tokenPrefix: t.prefix,
    tier: input.tier,
    projectWhitelist: (input.projectWhitelist ?? []) as object,
    allowedIpCidrs: (input.allowedIpCidrs ?? []) as object,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  }).returning();
  // 明文只在这里出现一次
  return { token: t.raw, row: publicView(row!) };
}

/** 列表：**绝不含 token_hash** */
export async function listTokens(actor: Actor) {
  const rows = await db.select().from(apiToken)
    .where(and(eq(apiToken.memberId, actor.memberId), isNull(apiToken.revokedAt)))
    .orderBy(desc(apiToken.id));
  return rows.map(publicView);
}

export async function revokeToken(actor: Actor, id: string): Promise<void> {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  const rows = await db.select().from(apiToken).where(eq(apiToken.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw forbidden();
  // 规范 REST 10 节：自己的令牌用 apikey:manage_own，他人的需 apikey:manage_any
  const allowed = row.memberId === actor.memberId
    ? can(actor, "apikey:manage_own", { projectId: null, teamId: null, createdBy: actor.memberId }, ctx)
      || can(actor, "apikey:manage_any", { projectId: null, teamId: null }, ctx)
    : can(actor, "apikey:manage_any", { projectId: null, teamId: null }, ctx);
  if (!allowed) throw forbidden();
  await db.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.id, id));
}

/** 校验链（MCP 侧唯一入口）。任何一步失败都是 null —— 调用方统一转同一形状错误 */
export async function authenticateToken(rawToken: string, ip: string | null): Promise<{ actor: Actor; ctx: TokenContext } | null> {
  if (!rawToken.startsWith("fero_")) return null;
  const rows = await db.select().from(apiToken).where(eq(apiToken.tokenHash, hash(rawToken))).limit(1);
  const row = rows[0];
  if (!row) return null;                                   // 不存在
  if (row.revokedAt) return null;                          // 已吊销
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;   // 已过期
  if (!ipAllowed(ip, (row.allowedIpCidrs ?? []) as string[])) return null;   // IP 不在白名单

  // loadActor 已对「禁用 / 锁定 / 匿名化」返回 null —— 此处不再重复判状态
  const actor = await loadActor(row.memberId);
  if (!actor || actor.mustChangePassword) return null;

  // 用量痕迹：失败不影响请求
  void db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.id)).catch(() => {});

  return {
    actor,
    ctx: {
      memberId: row.memberId,
      tier: row.tier as Tier,
      projectWhitelist: (row.projectWhitelist ?? []) as string[],
      tokenId: row.id,
    },
  };
}

/** 三重交集：项目白名单过滤（空数组 = 不限制） */
export function projectAllowed(ctx: TokenContext, projectId: string | null): boolean {
  if (!ctx.projectWhitelist.length) return true;
  if (!projectId) return false;
  return ctx.projectWhitelist.includes(projectId);
}

/** 按工具能力与令牌档位限制读写操作 */
export function tierAllows(ctx: TokenContext, kind: "read" | "write"): boolean {
  if (kind === "read") return true;                       // 任何档位都可读
  return ctx.tier === "READ_WRITE" || ctx.tier === "ADMIN";
}

function publicView(row: typeof apiToken.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,      // fero_…abcd，永不含明文
    tier: row.tier,
    projectWhitelist: row.projectWhitelist,
    allowedIpCidrs: row.allowedIpCidrs,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: null,
  };
}
