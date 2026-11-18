/** LDAP 安全边界单测：filter 转义 + 配置校验（不连目录、不连 DB） */
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
vi.mock("../src/server/services/audit.service.ts", () => ({ writeSecurityAudit: vi.fn() }));
vi.mock("../src/server/services/crypto.service.ts", () => ({ decryptSecret: (v: string) => v }));
vi.mock("../src/server/auth/login-guard.ts", () => ({ isLockedOut: async () => false, recordLoginFailure: async () => {}, clearLoginFailures: async () => {} }));
import { escapeLdapFilterValue, runtimeConfig } from "../src/server/services/ldap.service.ts";

describe("LDAP", () => {
  it("RFC4515：用户名中的 * ( ) \\ 反斜杠不会被当成 filter 语法", () => {
    expect(escapeLdapFilterValue("alice")).toBe("alice");
    expect(escapeLdapFilterValue("a*b")).toBe("a\\2ab");
    expect(escapeLdapFilterValue("a(b)c")).toBe("a\\28b\\29c");
    expect(escapeLdapFilterValue("a\\b")).toBe("a\\5cb");
  });

  it("LDAP 配置必须是 ldap/ldaps，且过滤器必须含 {{username}}", () => {
    const base = {
      id: "id", kind: "LDAP", issuer: "ldap://ldap.example.com:389", clientId: "cn=svc,dc=x",
      clientSecretEncrypted: null, autoProvision: false, enabled: true, allowedEmailDomains: null,
      config: { baseDn: "ou=people,dc=x", userFilter: "(uid={{username}})" },
    };
    const cfg = runtimeConfig(base as never);
    expect(cfg.baseDn).toBe("ou=people,dc=x");
    expect(cfg.userFilter).toContain("{{username}}");
    expect(cfg.bindPassword).toBe("");

    expect(() => runtimeConfig({ ...base, issuer: "http://ldap.example.com" } as never)).toThrow(/ldap/);
    expect(() => runtimeConfig({ ...base, config: { baseDn: "ou=x", userFilter: "(uid=x)" } } as never)).toThrow(/username/);
  });
});
