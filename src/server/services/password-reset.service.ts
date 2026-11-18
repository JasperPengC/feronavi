/**
 * 密码重置 —— 三条路径**共用同一张表**（第 5.11 节）
 *
 *   1 自助找回（需 SMTP，本期不做发信）
 *   2 管理员生成一次性链接（**主路径**：界面上直接展示，不走邮件）
 *   3 CLI `reset-password`（**兜底**：管理员自己忘密码时唯一出路）
 *
 * 三条路径的差别只在「谁来触发」，令牌本身完全一致：
 * **单次有效 + 15 分钟 + 用完即废 + 绝不写日志**。
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { passwordResetToken, member } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { hashPassword, validatePasswordStrength } from "../auth/password.ts";
import { revokeAllSessions } from "../auth/session.ts";

const TTL_MINUTES = 15;

/** 令牌哈希用 SHA-256（与密码区分：这是高频/一次性校验，不需要慢哈希） */
const hash = (plain: string) => createHash("sha256").update(`feronavi:reset:${plain}`).digest("hex");

/**
 * 签发一次性重置令牌。
 * `issuedByMemberId` 为 NULL 表示用户自助；非 NULL 表示管理员或 CLI 生成。
 *
 * ⚠️ 返回的是**明文令牌**，调用方必须：
 *   - 展示给用户（管理员路径）或拼进链接（自助路径）
 *   - **绝不写进日志**（第 5.11 节）
 */
export async function issueResetToken(opts: {
  memberId: string;
  issuedByMemberId: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  // 同一个人可能有多个未用的令牌 —— 签发新的不撤销旧的（用户可能重复点）
  await db.insert(passwordResetToken).values({
    memberId: opts.memberId,
    tokenHash: hash(token),
    expiresAt,
    issuedByMemberId: opts.issuedByMemberId,
  });

  return { token, expiresAt };
}

/** 按用户名/邮箱定位成员（CLI 与管理员路径共用） */
export async function findMemberByUserOrEmail(identifier: string) {
  const byName = await db.select({ id: member.id, username: member.username, status: member.status, email: member.email })
    .from(member).where(eq(member.username, identifier.toLowerCase())).limit(1);
  if (byName[0]) return byName[0];

  const byEmail = await db.select({ id: member.id, username: member.username, status: member.status, email: member.email })
    .from(member).where(eq(member.email, identifier.toLowerCase())).limit(1);
  return byEmail[0] ?? null;
}

/** 用令牌重置密码（单次有效；用完即废） */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) throw new DomainError("VALIDATION", strength.reason, null);
  let resetMemberId: string | null = null;

  await db.transaction(async (tx) => {
    const rows = await tx.select({
      id: passwordResetToken.id, memberId: passwordResetToken.memberId,
    }).from(passwordResetToken)
      .where(and(
        eq(passwordResetToken.tokenHash, hash(token)),
        isNull(passwordResetToken.usedAt),
        gt(passwordResetToken.expiresAt, new Date()),
      ))
      .for("update")
      .limit(1);

    const t = rows[0];
    // 令牌无效/过期/已用 → 统一错误（不区分，避免探测令牌状态）
    if (!t) throw new DomainError("FORBIDDEN", "重置链接无效或已过期", null);

    resetMemberId = t.memberId;
    await tx.update(passwordResetToken)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetToken.id, t.id));

    await tx.update(member)
      .set({
        passwordHash: await hashPassword(newPassword),
        // 重置密码后清掉「首次登录强制改密」标记
        isInitialAdmin: false,
        updatedAt: new Date(),
      })
      .where(eq(member.id, t.memberId));

    // 改密后吊销全部会话：密码变了，旧会话必须失效
    await revokeAllSessions(t.memberId);
  });

  if (resetMemberId) {
    const rows = await db.select({ username: member.username }).from(member).where(eq(member.id, resetMemberId)).limit(1);
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: null, actorSnapshot: rows[0]?.username ?? null,
      action: "auth.password_reset", targetType: "MEMBER", targetId: resetMemberId,
    });
  }
}

/** 已登录用户改密（`POST /auth/password/change`） */
export async function changeOwnPassword(
  memberId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { verifyPassword } = await import("../auth/password.ts");
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) throw new DomainError("VALIDATION", strength.reason, null);

  await db.transaction(async (tx) => {
    const rows = await tx.select({ passwordHash: member.passwordHash })
      .from(member).where(eq(member.id, memberId)).for("update").limit(1);
    const m = rows[0];
    if (!m) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    if (!(await verifyPassword(m.passwordHash, currentPassword))) {
      throw new DomainError("FORBIDDEN", "当前密码不正确", null);
    }
    await tx.update(member)
      .set({ passwordHash: await hashPassword(newPassword), isInitialAdmin: false, updatedAt: new Date() })
      .where(eq(member.id, memberId));
    await revokeAllSessions(memberId);
  });
}
