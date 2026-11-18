// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ reads: [] as unknown[][], state: {} as Record<string, unknown> }));
vi.mock("../src/db/index.ts", () => ({ db: {
  select: () => { const rows = fake.reads.shift() ?? []; const q = { from: () => q, where: () => q, limit: async () => rows }; return q; },
  delete: () => ({ where: () => { const result = Promise.resolve(); return Object.assign(result, { returning: async () => [fake.state] }); } }),
  update: () => ({ set: () => ({ where: async () => {} }) }),
  insert: () => ({ values: () => ({ returning: async () => [{ id: "provisioned" }] }) }),
} }));
vi.mock("../src/server/lib/url-safety.ts", () => ({ assertSafeOutboundUrl: async () => {} }));
// 隔离外部 HTTP；签名与 claims 校验仍运行生产实现。
vi.mock("../src/server/lib/safe-fetch.ts", () => ({ safeOutboundFetch: (url: string, init?: RequestInit) => fetch(url, init) }));
import { completeLogin } from "../src/server/services/sso.service.ts";
const issuer = "https://identity.example.test";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256" };
let claims: Record<string, unknown>;
beforeEach(() => {
  fake.state = { state: "state", idpConfigId: "idp", expiresAt: new Date(Date.now() + 60000), nonce: "nonce", codeVerifier: "verifier", redirectUri: "https://app.example.test/callback" };
  fake.reads = [[{ id: "idp", issuer, clientId: "client", enabled: true, autoProvision: false }], [], [{ id: "existing", email: "member@example.test", status: "ACTIVE" }]];
  claims = { iss: issuer, sub: "subject", aud: "client", exp: Math.floor(Date.now() / 1000) + 600, nonce: "nonce", email: "member@example.test" };
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("openid-configuration")) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (url.endsWith("jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("token")) {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
      const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
      return Response.json({ id_token: `${h}.${p}.${signature}` });
    }
    throw new Error("unexpected outbound request");
  });
});
afterEach(() => vi.unstubAllGlobals());
it.each([undefined, false, "true"])("邮箱验证声明 %s 不得绑定既有本地账号", async emailVerified => {
  if (emailVerified !== undefined) claims.email_verified = emailVerified;
  await expect(completeLogin({ state: "state", code: "code" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("明确验证过的邮箱可以绑定既有本地账号", async () => {
  claims.email_verified = true;
  await expect(completeLogin({ state: "state", code: "code" })).resolves.toEqual({ memberId: "existing", created: false, linked: true });
});
it.each([undefined, false, "true"])("自动建号不能用未验证声明 %s 绕过邮箱域限制", async emailVerified => {
  fake.reads = [[{ id: "idp", issuer, clientId: "client", enabled: true, autoProvision: true, allowedEmailDomains: "example.test" }], [], []];
  if (emailVerified !== undefined) claims.email_verified = emailVerified;
  await expect(completeLogin({ state: "state", code: "code" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
