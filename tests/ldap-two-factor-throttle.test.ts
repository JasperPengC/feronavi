// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ failures: 0 }));
vi.mock("../src/server/auth/login-guard.ts", () => ({
  // 独立验证二因子失败锁定；不能让请求额度提前拒绝而掩盖原断言。
  consumeLoginAttempt: async () => true,
  isLockedOut: async () => fake.failures >= 10,
  recordLoginFailure: async () => { fake.failures++; },
  clearLoginFailures: async () => { fake.failures = 0; },
}));
vi.mock("../src/server/services/audit.service.ts", () => ({ writeSecurityAudit: async () => {} }));
vi.mock("../src/server/services/two-factor.service.ts", () => ({ verifyForLogin: async () => ({ required: true, ok: false }) }));
vi.mock("ldapts", () => ({ Client: class {
  async bind() {} async unbind() {}
  async search() { return { searchEntries: [{ dn: "uid=user,dc=example", uid: "user", mail: "user@example.test" }] }; }
} }));
vi.mock("../src/db/index.ts", async () => {
  const { idpConfig } = await import("../src/db/schema.ts");
  return { db: { select: () => {
    let rows: unknown[] = [];
    const q = { from: (table: unknown) => {
      rows = table === idpConfig ? [{ id: "idp", kind: "LDAP", enabled: true, issuer: "ldap://directory.example.test", config: { baseDn: "dc=example" } }] : [{ id: "member", status: "ACTIVE" }];
      return q;
    }, where: () => q, limit: async () => rows };
    return q;
  } } };
});
import { loginLdap } from "../src/server/services/ldap.service.ts";
beforeEach(() => { fake.failures = 0; });
it("LDAP 密码正确后猜测二次验证码仍纳入登录锁定", async () => {
  const input = { idpId: "idp", username: "user", password: "valid", totpCode: "111111" };
  const context = { ip: "192.0.2.1", userAgent: null };
  for (let n = 0; n < 10; n++) await expect(loginLdap(input, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fake.failures).toBe(10);
  await expect(loginLdap(input, context)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(fake.failures).toBe(10);
});
