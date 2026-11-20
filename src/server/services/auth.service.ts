/**
 * 认证领域服务 —— **路由只调这里，不直接碰 DB**
 *
 * 这里的逻辑顺序是有讲究的（安全性相关，改动前先读注释）：
 *   1 先查锁定（省钱：锁定期内不必做昂贵的哈希校验）
 *   2 再做哈希校验（账号不存在也走一次，避免时序侧信道）
 *   3 最后才建会话
 */
import { SESSION_TTL_DAYS, SESSION_TTL_DAYS_REMEMBER, createSession, revokeSession } from "../auth/session.ts";
import { verifyPassword } from "../auth/password.ts";
import { clearLoginFailures, consumeLoginAttempt, isLockedOut, recordLoginFailure } from "../auth/login-guard.ts";
import { DomainError } from "../../shared/errors.ts";
import type { LoginInput } from "../../shared/schemas/auth.ts";
import * as memberRepo from "../repos/member.repo.ts";

export interface LoginResult {
  token: string;
  expiresAt: Date;
}

export async function login(
  input: LoginInput,
  ctx: { ip: string; userAgent: string | null },
): Promise<LoginResult> {
  const { username, password, remember } = input;

  // ① 锁定检查：IP + 账号双维度（第 5.9 节）
  const attemptAllowed = await consumeLoginAttempt(username, ctx.ip);
  if (!attemptAllowed || await isLockedOut(username, ctx.ip)) {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: null, actorSnapshot: username.slice(0, 64),
      action: "auth.login_blocked", targetType: "MEMBER",
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw new DomainError("RATE_LIMITED", attemptAllowed ? "尝试次数过多，请 10 分钟后再试" : "登录尝试过于频繁，请稍后再试", null);
  }

  const m = await memberRepo.findByUsernameForAuth(username);

  /**
   * ⚠️ 两条安全约束，改动这里必须同时满足：
   *   a) 账号不存在与密码错误返回**完全相同**的错误（否则可枚举用户名）
   *   b) 两条路径都要走一次哈希校验（否则响应耗时可区分，仍是侧信道）
   * 无账号使用哨兵输入；verifyPassword 会执行固定真实 dummy hash 并强制拒绝。
   */
  const ok = m
    ? await verifyPassword(m.passwordHash, password)
    : await verifyPassword("!", password);

  if (!m || !ok || m.status !== "ACTIVE") {
    await recordLoginFailure(username, ctx.ip);
    // 安全审计：失败事件记录**尝试的用户名**（截断），不记录密码/正文
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: null, actorSnapshot: username.slice(0, 64),
      action: "auth.login_failed", targetType: "MEMBER",
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw new DomainError("FORBIDDEN", "用户名或密码错误", null);
  }

  /**
   * 二因子闸门（第十四期）：**未启用者不受影响**；已启用但码不对 → 拒绝且**不签发会话**。
   * 放在签发之前是刻意的：把二因子做成"登录后再问一次"等于没做（会话已经发出去了）。
   */
  {
    const { verifyForLogin } = await import("./two-factor.service.ts");
    const tf = await verifyForLogin(m.id, { totpCode: input.totpCode, recoveryCode: input.recoveryCode });
    if (tf.required && !tf.ok) {
      // 密码正确仍需累计二因子猜测；首次未提供验证码的正常挑战不计失败。
      if (input.totpCode || input.recoveryCode) await recordLoginFailure(username, ctx.ip);
      throw new DomainError("FORBIDDEN", "需要双因素验证码（动态码或恢复码）", { twoFactorRequired: true });
    }
  }

  await clearLoginFailures(username, ctx.ip);

  {
    const { writeSecurityAudit } = await import("./audit.service.ts");
    await writeSecurityAudit({
      actorId: m.id, actorSnapshot: username,
      action: "auth.login", targetType: "MEMBER", targetId: m.id,
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
  }

  return createSession({ memberId: m.id, remember, userAgent: ctx.userAgent, ip: ctx.ip });
}

export async function logout(token: string | undefined): Promise<void> {
  if (token) await revokeSession(token);
}

export { SESSION_TTL_DAYS, SESSION_TTL_DAYS_REMEMBER };
