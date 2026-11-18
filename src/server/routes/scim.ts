/**
 * SCIM 2.0 端点 + SCIM Token 管理。
 *
 * 认证边界刻意分开：
 *   - `/api/v1/scim/tokens` 用管理员的 Cookie 会话 + CSRF；
 *   - `/scim/v2/*` 只认 Bearer scim_ token，不接受 Cookie（避免把管理会话暴露给外部 IdP）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as scim from "../services/scim.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor; scimAuthenticated?: boolean }
}

export async function registerScimRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  // SCIM 客户端按 RFC 7644 发 application/scim+json；Fastify 默认只解析 application/json
  app.addContentTypeParser("application/scim+json", { parseAs: "string" }, (_req, body, done) => {
    try { done(null, JSON.parse(body as string)); }
    catch { done(new DomainError("VALIDATION", "SCIM JSON 格式不合法", null), undefined); }
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { code?: string; statusCode?: number };
    if (req.url.startsWith("/scim/v2")) {
      const status = error instanceof DomainError
        ? (error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 401 : error.code === "VALIDATION" ? 400 : 500)
        : error instanceof z.ZodError ? 400
        : typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      if (status === 500) req.log.error({ err }, "SCIM 请求失败");
      reply.status(status).type("application/scim+json").send({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: String(status), detail: status === 500 ? "服务暂时不可用" : error instanceof z.ZodError ? "参数不合法" : err.message,
        scimType: error instanceof DomainError ? error.code : undefined,
      });
      return;
    }
    reply.send(error);
  });

  app.addHook("preHandler", async (req: FastifyRequest) => {
    if (!req.url.startsWith("/scim/v2")) return;
    await scim.authenticate(req.headers.authorization);
    req.scimAuthenticated = true;
  });

  /* ── Token 管理（管理员）────────────────────────────── */
  app.get("/api/v1/scim/tokens", async (req) => ({ tokens: await scim.listTokens(actorOf(req)) }));

  app.post("/api/v1/scim/tokens", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return scim.createToken(actorOf(req), parsed.data.name);
  });

  app.delete("/api/v1/scim/tokens/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return scim.revokeToken(actorOf(req), id);
  });

  /* ── SCIM 2.0 ──────────────────────────────────────── */
  app.get("/scim/v2/ServiceProviderConfig", async (_req, reply) => {
    reply.type("application/scim+json");
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 500 }, changePassword: { supported: false },
      sort: { supported: false }, etag: { supported: false },
      authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer", description: "SCIM bearer token" }],
    };
  });

  app.get("/scim/v2/Users", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    reply.type("application/scim+json");
    return scim.listUsers({ filter: q.filter, startIndex: Number(q.startIndex ?? 1), count: Number(q.count ?? 50) });
  });
  app.get("/scim/v2/Users/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    reply.type("application/scim+json");
    return scim.getUser(id);
  });
  app.post("/scim/v2/Users", async (req, reply) => {
    reply.status(201).type("application/scim+json");
    return scim.createUser(req.body as Record<string, unknown>);
  });
  app.patch("/scim/v2/Users/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = req.body as { Operations?: unknown[]; operations?: unknown[] };
    const ops = (body.Operations ?? body.operations ?? []) as { op?: string; path?: string; value?: unknown }[];
    reply.type("application/scim+json");
    return scim.patchUser(id, ops);
  });
  app.delete("/scim/v2/Users/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await scim.deleteUser(id);
    reply.status(204).send();
  });

  app.get("/scim/v2/Groups", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    reply.type("application/scim+json");
    return scim.listGroups({ filter: q.filter, startIndex: Number(q.startIndex ?? 1), count: Number(q.count ?? 50) });
  });
  app.get("/scim/v2/Groups/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    reply.type("application/scim+json");
    return scim.getGroup(id);
  });
  app.post("/scim/v2/Groups", async (req, reply) => {
    reply.status(201).type("application/scim+json");
    return scim.createGroup(req.body as Record<string, unknown>);
  });
  app.patch("/scim/v2/Groups/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = req.body as { Operations?: unknown[]; operations?: unknown[] };
    const ops = (body.Operations ?? body.operations ?? []) as { op?: string; path?: string; value?: unknown }[];
    reply.type("application/scim+json");
    return scim.patchGroup(id, ops);
  });
  app.delete("/scim/v2/Groups/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await scim.deleteGroup(id);
    reply.status(204).send();
  });
}
