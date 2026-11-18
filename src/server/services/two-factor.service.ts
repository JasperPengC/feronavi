/**
 * 双因素认证（第十四期，规范 1.8 + REST 2 节）
 *
 * 四条纪律：
 *   1 密钥**信封加密**入库，明文只在 setup 响应里出现一次（与其它密钥同一纪律）
 *   2 恢复码**逐码哈希**、**只展示一次**、**用后作废**（一次性）
 *   3 关闭双因素**必须重新验证密码**（规范明示）—— 否则拿到会话就能悄悄关掉二因子
 *   4 未启用者不受影响；`PENDING`（已生成未激活）**不参与登录校验**（否则用户会被锁在门外）
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { member, twoFactorSecret } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { decryptSecret, encryptSecret } from "./crypto.service.ts";
import { base32Decode, base32Encode, generateSecret, otpauthUrl, verifyTotp } from "../lib/totp.ts";
import { verifyPassword } from "../auth/password.ts";

const RECOVERY_CODE_COUNT = 10;

function hashCode(code: string): string {
  // 恢复码是"查得到即鉴权"的令牌 → 等值查找（C-28），故用 SHA-256 而非含盐哈希
  return createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}

function newRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(10).toString("hex").toUpperCase().replace(/(.{5})(?=.)/g, "$1-"));
  return { plain, hashes: plain.map(hashCode) };
}

/** 生成待激活密钥：返回 otpauth 链接（明文密钥只在此出现一次） */
export async function setup(memberId: string, opts: { account: string; issuer?: string }) {
  const existing = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId)).limit(1))[0];
  if (existing?.status === "ACTIVE") {
    throw new DomainError("CONFLICT", "双因素已启用；如需重置请先关闭", null);
  }
  const secret = generateSecret();
  const b32 = base32Encode(secret);
  const { plain, hashes } = newRecoveryCodes();
  await db.insert(twoFactorSecret)
    .values({ memberId, secretEncrypted: encryptSecret(b32), status: "PENDING", recoveryCodesHash: hashes as object })
    .onConflictDoUpdate({
      target: twoFactorSecret.memberId,
      set: { secretEncrypted: encryptSecret(b32), status: "PENDING", recoveryCodesHash: hashes as object },
    });
  return {
    otpauthUrl: otpauthUrl(b32, opts.account, opts.issuer ?? "Feronavi"),
    // 恢复码与密钥同时给：用户扫码后应立即保存恢复码
    recoveryCodes: plain,
    note: "密钥与恢复码只显示这一次；恢复码每个只能用一次",
  };
}

/** 校验一次动态码后激活 */
export async function activate(memberId: string, code: string) {
  const row = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId)).limit(1))[0];
  if (!row) throw new DomainError("VALIDATION", "请先调用 setup 生成密钥", null);
  if (row.status === "ACTIVE") return { activated: true, alreadyActive: true };
  if (!verifyTotp(base32ToBuffer(row.secretEncrypted), code)) {
    throw new DomainError("VALIDATION", "动态码不正确或已过期", null);
  }
  await db.update(twoFactorSecret).set({ status: "ACTIVE" }).where(eq(twoFactorSecret.memberId, memberId));
  return { activated: true, alreadyActive: false };
}

function base32ToBuffer(encrypted: string): Buffer {
  return base32Decode(decryptSecret(encrypted));
}

/** 关闭：**必须重新验证密码** */
export async function disable(memberId: string, password: string) {
  const row = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId)).limit(1))[0];
  if (!row) throw new DomainError("VALIDATION", "尚未启用双因素", null);
  const me = (await db.select({ passwordHash: member.passwordHash }).from(member).where(eq(member.id, memberId)).limit(1))[0];
  if (!me || !(await verifyPassword(me.passwordHash, password))) {
    throw new DomainError("FORBIDDEN", "密码不正确", null);
  }
  await db.delete(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId));
  return { disabled: true };
}

/** 重新生成恢复码（只展示一次；旧码立即失效） */
export async function regenerateRecoveryCodes(memberId: string) {
  const row = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId)).limit(1))[0];
  if (!row || row.status !== "ACTIVE") throw new DomainError("VALIDATION", "双因素未启用", null);
  const { plain, hashes } = newRecoveryCodes();
  await db.update(twoFactorSecret).set({ recoveryCodesHash: hashes as object }).where(eq(twoFactorSecret.memberId, memberId));
  return { recoveryCodes: plain, note: "旧恢复码已全部失效" };
}

export interface TwoFactorState { enabled: boolean; pending: boolean }

export async function state(memberId: string): Promise<TwoFactorState> {
  const row = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId)).limit(1))[0];
  return { enabled: row?.status === "ACTIVE", pending: row?.status === "PENDING" };
}

/**
 * 登录时的二因子校验。
 * - 未启用 → `{ required: false }`（放行）
 * - 已启用但未给码 → `{ required: true, ok: false }`（调用方要求补码，不泄露"码错"与"没给码"的区别）
 * - 恢复码命中 → 校验通过并**立即作废该码**
 */
export async function verifyForLogin(memberId: string, input: { totpCode?: string; recoveryCode?: string }): Promise<{ required: boolean; ok: boolean }> {
  return db.transaction(async (tx) => {
    const row = (await tx.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, memberId)).for("update").limit(1))[0];
    if (!row || row.status !== "ACTIVE") return { required: false, ok: true };

    if (input.totpCode && verifyTotp(base32ToBuffer(row.secretEncrypted), input.totpCode)) {
      return { required: true, ok: true };
    }
    if (input.recoveryCode) {
      const h = hashCode(input.recoveryCode);
      const codes = (row.recoveryCodesHash ?? []) as string[];
      if (codes.includes(h)) {
        // 同一事务持有行锁，其他登录读取更新后的数组，不能重复消费或恢复已用码。
        const next = codes.filter((c) => c !== h);
        await tx.update(twoFactorSecret).set({ recoveryCodesHash: next as object }).where(eq(twoFactorSecret.memberId, memberId));
        return { required: true, ok: true };
      }
    }
    return { required: true, ok: false };
  });
}
