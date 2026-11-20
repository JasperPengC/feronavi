import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { verifyPassword } from "../auth/password.ts";
import * as memberRepo from "../repos/member.repo.ts";
import { writeSecurityAudit } from "./audit.service.ts";
import { verifyForLogin } from "./two-factor.service.ts";
import {
  clearLoginFailures,
  isLockedOut,
  recordLoginFailure,
} from "../auth/login-guard.ts";

export interface AdminReauthInput {
  currentPassword: string;
  totpCode?: string;
  ip?: string;
}

async function auditFailure(actor: Actor): Promise<void> {
  await writeSecurityAudit({
    actorId: actor.memberId,
    actorSnapshot: actor.username,
    action: "system_backup.reauth_failed",
    targetType: "SYSTEM_BACKUP",
  });
}

export async function verifyAdminReauth(
  actor: Actor,
  input: AdminReauthInput,
): Promise<void> {
  const ip = input.ip ?? "unknown";
  if (await isLockedOut(actor.username, ip))
    throw new DomainError(
      "RATE_LIMITED",
      "尝试次数过多，请 10 分钟后再试",
      null,
    );
  const row = await memberRepo.findByIdForReauth(actor.memberId);
  if (
    !row ||
    !(await verifyPassword(row.passwordHash, input.currentPassword))
  ) {
    await recordLoginFailure(actor.username, ip);
    await auditFailure(actor);
    throw forbidden();
  }

  const second = await verifyForLogin(actor.memberId, {
    totpCode: input.totpCode,
  });
  if (second.required && !second.ok) {
    if (input.totpCode) await recordLoginFailure(actor.username, ip);
    await auditFailure(actor);
    throw new DomainError("FORBIDDEN", "需要双因素验证码（动态码或恢复码）", {
      twoFactorRequired: true,
    });
  }
  await clearLoginFailures(actor.username, ip);
}
