// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ failures: 0, correct: false }));
vi.mock("../src/server/auth/login-guard.ts", () => ({
  consumeLoginAttempt: async () => true,
  isLockedOut: async () => fake.failures >= 10,
  recordLoginFailure: async () => { fake.failures++; },
  clearLoginFailures: async () => { fake.failures = 0; },
}));
vi.mock("../src/server/auth/session.ts", () => ({ SESSION_TTL_DAYS: 7, SESSION_TTL_DAYS_REMEMBER: 30, createSession: async () => ({ token: "session", expiresAt: new Date() }), revokeSession: async () => {} }));
vi.mock("../src/server/auth/password.ts", () => ({ verifyPassword: async () => true }));
vi.mock("../src/server/repos/member.repo.ts", () => ({ findByUsernameForAuth: async () => ({ id: "member", status: "ACTIVE", passwordHash: "password" }) }));
vi.mock("../src/server/services/audit.service.ts", () => ({ writeSecurityAudit: async () => {} }));
vi.mock("../src/server/services/two-factor.service.ts", () => ({ verifyForLogin: async () => ({ required: true, ok: fake.correct }) }));
import { login } from "../src/server/services/auth.service.ts";
const input = { username: "member", password: "valid-password", remember: false, totpCode: "111111" };
const context = { ip: "192.0.2.1", userAgent: null };
beforeEach(() => { fake.failures = 0; fake.correct = false; });
it("密码正确也不能无限猜测二次验证码，连续10次错误后锁定", async () => {
  for (let n = 0; n < 10; n++) await expect(login(input, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(login(input, context)).rejects.toMatchObject({ code: "RATE_LIMITED" });
});
it("只有完整认证成功才清除失败次数", async () => {
  fake.failures = 8;
  await expect(login(input, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  fake.correct = true;
  await expect(login(input, context)).resolves.toMatchObject({ token: "session" });
  fake.correct = false;
  for (let n = 0; n < 10; n++) await expect(login(input, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(login(input, context)).rejects.toMatchObject({ code: "RATE_LIMITED" });
});
