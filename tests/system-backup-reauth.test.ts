import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/server/permission/actor.ts";

const fake = vi.hoisted(() => ({
  member: { id: "member-1", passwordHash: "stored-hash" } as {
    id: string;
    passwordHash: string;
  } | null,
  passwordMatches: true,
  twoFactor: { required: false, ok: true },
  audit: vi.fn(),
  locked: false,
  failures: 0,
}));

vi.mock("../src/server/repos/member.repo.ts", () => ({
  findByIdForReauth: async () => fake.member,
}));
vi.mock("../src/server/auth/password.ts", () => ({
  verifyPassword: async () => fake.passwordMatches,
}));
vi.mock("../src/server/services/two-factor.service.ts", () => ({
  verifyForLogin: async () => fake.twoFactor,
}));
vi.mock("../src/server/services/audit.service.ts", () => ({
  writeSecurityAudit: fake.audit,
}));
vi.mock("../src/server/auth/login-guard.ts", () => ({
  isLockedOut: async () => fake.locked,
  recordLoginFailure: async () => {
    fake.failures++;
  },
  clearLoginFailures: async () => {
    fake.failures = 0;
  },
}));

const actor = {
  memberId: "member-1",
  username: "admin",
  name: "管理员",
  permissions: new Set(["setting:manage"]),
  grants: [],
  mustChangePassword: false,
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  theme: null,
} satisfies Actor;

describe("verifyAdminReauth", () => {
  beforeEach(() => {
    fake.member = { id: "member-1", passwordHash: "stored-hash" };
    fake.passwordMatches = true;
    fake.twoFactor = { required: false, ok: true };
    fake.audit.mockReset();
    fake.locked = false;
    fake.failures = 0;
  });

  it("拒绝错误密码，并且安全审计不包含提交的密码", async () => {
    fake.passwordMatches = false;
    const password = "do-not-log-this-password";
    const { verifyAdminReauth } =
      await import("../src/server/services/admin-reauth.service.ts");

    await expect(
      verifyAdminReauth(actor, { currentPassword: password }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fake.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "system_backup.reauth_failed" }),
    );
    expect(JSON.stringify(fake.audit.mock.calls)).not.toContain(password);
  });

  it("要求启用 2FA 的管理员提供有效动态码", async () => {
    fake.twoFactor = { required: true, ok: false };
    const { verifyAdminReauth } =
      await import("../src/server/services/admin-reauth.service.ts");

    await expect(
      verifyAdminReauth(actor, { currentPassword: "correct-password" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { twoFactorRequired: true },
    });
    expect(fake.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "system_backup.reauth_failed" }),
    );
  });

  it("密码及已启用的 2FA 均通过时放行", async () => {
    fake.twoFactor = { required: true, ok: true };
    const { verifyAdminReauth } =
      await import("../src/server/services/admin-reauth.service.ts");

    await expect(
      verifyAdminReauth(actor, {
        currentPassword: "correct-password",
        totpCode: "123456",
      }),
    ).resolves.toBeUndefined();
    expect(fake.audit).not.toHaveBeenCalled();
  });

  it("账号/IP被login-guard锁定时二次认证返回429且不验证密码", async () => {
    fake.locked = true;
    fake.passwordMatches = true;
    const { verifyAdminReauth } =
      await import("../src/server/services/admin-reauth.service.ts");
    await expect(
      verifyAdminReauth(actor, {
        currentPassword: "correct-password",
        ip: "198.51.100.8",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
