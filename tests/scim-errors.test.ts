// @vitest-environment node
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
vi.mock("../src/server/services/scim.service.ts", () => ({ authenticate: async () => {}, getUser: async () => { throw new Error("database-internal-secret"); } }));
import { registerScimRoutes } from "../src/server/routes/scim.ts";
it("SCIM 输入错误返回400，内部故障不向客户端暴露详情", async () => {
  const app = Fastify();
  app.decorate("csrfProtection", (_req: unknown, _reply: unknown, done: () => void) => done());
  await app.register(registerScimRoutes);
  try {
    const malformed = await app.inject({ method: "POST", url: "/scim/v2/Users", headers: { "content-type": "application/scim+json" }, payload: "{bad-json" });
    expect(malformed.statusCode).toBe(400);
    const invalid = await app.inject({ url: "/scim/v2/Users/not-a-uuid" });
    expect(invalid.statusCode).toBe(400);
    const internal = await app.inject({ url: "/scim/v2/Users/11111111-1111-4111-8111-111111111111" });
    expect(internal.statusCode).toBe(500);
    expect(internal.body).not.toContain("database-internal-secret");
    expect(internal.json().schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
  } finally { await app.close(); }
});
