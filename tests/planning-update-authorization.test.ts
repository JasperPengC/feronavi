// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Actor } from "../src/server/permission/actor.ts";
const fake = vi.hoisted(() => ({ stored: { id: "11111111-1111-4111-8111-111111111111", projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "original", parentId: null as string | null }, writes: 0 }));
vi.mock("../src/db/index.ts", () => ({ db: {
  select: () => { const q = { from: () => q, where: () => q, limit: async () => [fake.stored] }; return q; },
  update: () => ({ set: (patch: object) => ({ where: () => ({ returning: async () => { fake.writes++; return [{ ...fake.stored, ...patch }]; } }) }) }),
} }));
vi.mock("../src/server/repos/project.repo.ts", () => ({ isVisibleTo: async () => true }));
vi.mock("../src/server/services/event-log.ts", () => ({ recordBusinessEvent: async () => {} }));
import { registerPlanningRoutes } from "../src/server/routes/planning.ts";
const actor: Actor = { memberId: "m", username: "m", name: "m", permissions: new Set(), grants: [{ roleKey: "reader", scopeType: "ORG", scopeId: null }], rolePermissions: new Map([["reader", new Set<string>()]]), mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null };
beforeEach(() => { fake.writes = 0; });
for (const kind of ["milestone", "iteration", "module", "release"]) {
  it(`仅可见项目的账号不能 PATCH ${kind}`, async () => {
    const app = Fastify();
    app.decorate("csrfProtection", async () => {});
    app.addHook("preHandler", async (req) => { req.actor = actor; });
    app.setErrorHandler((error, _req, reply) => { const err = error as { code: string; httpStatus: number }; reply.status(err.httpStatus ?? 500).send({ code: err.code }); });
    await registerPlanningRoutes(app);
    try {
      const response = await app.inject({ method: "PATCH", url: `/api/v1/${kind}s/${fake.stored.id}`, payload: { name: "unauthorized" } });
      expect(response.statusCode).toBe(403);
      expect(fake.writes).toBe(0);
    } finally { await app.close(); }
  });
}
