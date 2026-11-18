// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import { DomainError } from "../src/shared/errors.ts";
import type { Actor } from "../src/server/permission/actor.ts";
import { registerRoleRoutes } from "../src/server/routes/roles.ts";
import * as roleService from "../src/server/services/role.service.ts";

// Unauthorized service paths must reject before touching the database.
vi.mock("../src/db/index.ts", () => ({ db: {} }));

const apps: ReturnType<typeof Fastify>[] = [];

function actor(permissions: string[], scopeType: "ORG" | "TEAM" = "ORG"): Actor {
  return {
    memberId: "11111111-1111-4111-8111-111111111111",
    username: "viewer",
    name: "Viewer",
    permissions: new Set(permissions),
    grants: [{ roleKey: "CUSTOM", scopeType, scopeId: scopeType === "ORG" ? null : "22222222-2222-4222-8222-222222222222" }],
    mustChangePassword: false,
    locale: "en-US",
    timezone: null,
  };
}

async function makeHttpApp(requestActor: Actor | undefined) {
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(cookie);
  await app.register(csrf, { cookieOpts: { signed: false, sameSite: "lax", httpOnly: false, path: "/" } });
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { code?: string; httpStatus?: number; details?: unknown };
    if (err.code === "FORBIDDEN" || err.httpStatus === 403) {
      return reply.status(403).send({ code: "FORBIDDEN", message: err.message, details: err.details ?? null });
    }
    if (err.code === "FST_CSRF_MISSING_SECRET" || err.code === "FST_CSRF_INVALID_TOKEN") {
      return reply.status(403).send({ code: "FORBIDDEN", message: "CSRF 校验失败", details: null });
    }
    return reply.status(500).send({ code: "INTERNAL", message: err.message, details: null });
  });
  app.addHook("preHandler", async (request) => {
    (request as typeof request & { actor?: Actor }).actor = requestActor;
  });
  await registerRoleRoutes(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("角色管理授权边界", () => {
  it("HTTP GET 在没有 role:manage 时返回 FORBIDDEN", async () => {
    const app = await makeHttpApp(actor(["member:manage"]));
    const response = await app.inject({ method: "GET", url: "/api/v1/roles" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("HTTP GET 即使有 role:manage，也要求 ORG 范围", async () => {
    const app = await makeHttpApp(actor(["role:manage"], "TEAM"));
    const response = await app.inject({ method: "GET", url: "/api/v1/roles" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("角色写接口要求 CSRF token", async () => {
    const app = await makeHttpApp(actor(["role:manage"]));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/roles",
      headers: { "content-type": "application/json" },
      payload: { slug: "reviewer", name: "Reviewer", permissionKeys: [] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN", message: "CSRF 校验失败" });
  });

  it("直接调用 service 也会拒绝无 ORG role:manage 的 actor", async () => {
    const deniedActor = actor(["role:manage"], "TEAM");
    expect(() => roleService.assertRoleManagement(deniedActor)).toThrow(DomainError);
    await expect(roleService.listRoles(deniedActor)).rejects.toBeInstanceOf(DomainError);
  });

  it("service 授权和 HTTP 授权分别覆盖缺权限与缺 ORG 范围", () => {
    expect(() => roleService.assertRoleManagement(actor(["role:manage"]))).not.toThrow();
    expect(() => roleService.assertRoleManagement(actor([]))).toThrow(DomainError);
  });

  it("ORG 指派必须为空 scopeId，TEAM/PROJECT 必须提供 scopeId", () => {
    expect(() => roleService.validateScopeInput("ORG", null)).not.toThrow();
    expect(() => roleService.validateScopeInput("ORG", "22222222-2222-4222-8222-222222222222")).toThrow(DomainError);
    expect(() => roleService.validateScopeInput("TEAM", null)).toThrow(DomainError);
    expect(() => roleService.validateScopeInput("PROJECT", "22222222-2222-4222-8222-222222222222")).not.toThrow();
  });

  it("创建角色时拒绝非 slug 标识，且在访问数据库前完成校验", async () => {
    await expect(roleService.createRole(actor(["role:manage"]), {
      slug: "ADMIN", name: "Reviewer", permissionKeys: [],
    })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
