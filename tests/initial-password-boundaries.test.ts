// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import type { Actor } from "../src/server/permission/actor.ts";
const fake = vi.hoisted(() => ({ actor: undefined as Actor | undefined }));
vi.mock("../src/server/auth/actor-loader.ts", () => ({ loadActor: async () => fake.actor }));
vi.mock("../src/server/auth/session.ts", () => ({ SESSION_COOKIE: "feronavi_session", verifySession: async () => ({ memberId: "member" }), revokeAllSessions: async () => 1, revokeSessionById: async () => true, listSessions: async () => [] }));
vi.mock("../src/server/services/auth.service.ts", () => ({ login: vi.fn(), logout: async () => {} }));
vi.mock("../src/server/services/audit.service.ts", () => ({ writeSecurityAudit: async () => {} }));
vi.mock("../src/db/index.ts", () => ({ db: {
  select: () => { const q = { from: () => q, where: () => q, limit: async () => [{ id: "token", memberId: "member", tier: "ADMIN", allowedIpCidrs: [], projectWhitelist: [] }] }; return q; },
  update: () => ({ set: () => ({ where: async () => {} }) }),
  insert: () => ({ values: () => ({ returning: async () => [{ id: "new-token", name: "test", tier: "ADMIN" }] }) }),
} }));
import { registerAuthRoutes } from "../src/server/routes/auth.ts";
import { authenticateToken, createToken } from "../src/server/services/token.service.ts";
const apps: ReturnType<typeof Fastify>[] = [];
beforeEach(() => { fake.actor = { memberId: "member", username: "member", name: "成员", permissions: new Set(["apikey:manage_own"]), grants: [{ roleKey: "MEMBER", scopeType: "ORG", scopeId: null }], mustChangePassword: true, locale: "zh-CN", timezone: null }; });
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function appWithAuth() {
  const app = Fastify(); apps.push(app);
  await app.register(cookie); await app.register(csrf);
  app.setErrorHandler((raw, _req, reply) => { const err = raw as Error & { httpStatus?: number; code?: string }; return reply.status(err.httpStatus ?? 500).send({ code: err.code, message: err.message }); });
  await registerAuthRoutes(app);
  app.get("/api/v1/private-data", async req => ({ memberId: req.actor?.memberId }));
  app.post("/api/v1/auth/password/change", async req => ({ memberId: req.actor?.memberId }));
  return app;
}
it("首次改密前服务端拒绝直接读取业务 API（含查询参数）", async () => {
  const app = await appWithAuth();
  const res = await app.inject({ url: "/api/v1/private-data?view=all", cookies: { feronavi_session: "valid" } });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
});
it("首次改密前仍可查询身份、刷新 CSRF、改密和登出", async () => {
  const app = await appWithAuth(); const cookies = { feronavi_session: "valid" };
  for (const url of ["/api/v1/auth/me", "/api/v1/auth/csrf", "/api/v1/auth/sessions"]) expect((await app.inject({ url, cookies })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/v1/auth/password/change", cookies })).statusCode).toBe(200);
});
it("完成改密的账号可以正常读取业务 API", async () => {
  fake.actor!.mustChangePassword = false;
  const app = await appWithAuth();
  expect((await app.inject({ url: "/api/v1/private-data", cookies: { feronavi_session: "valid" } })).statusCode).toBe(200);
});
it("初始密码账号不能借已有 API Token 绕过首次改密", async () => {
  expect(await authenticateToken("fero_test", "127.0.0.1")).toBeNull();
});
it("初始密码账号不能直接签发 API Token", async () => {
  await expect(createToken(fake.actor!, { name: "test", tier: "ADMIN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
