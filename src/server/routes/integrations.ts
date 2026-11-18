/** 外部集成端点（规范 8.3 / REST 11 节：GET/POST/PATCH/DELETE /integrations，integration:manage） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as integrationService from "../services/integration.service.ts";
import * as integrationSync from "../services/integration-sync.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const idP = z.object({ id: z.string().uuid() });
  const bodySchema = {
    kind: z.enum(integrationService.INTEGRATION_KINDS),
    name: z.string().min(1).max(100),
    baseUrl: z.string().url().max(500),
    token: z.string().min(1).max(2000),
    projectId: z.string().uuid().nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  };

  app.get("/api/v1/integrations", async (req) => {
    const q = req.query as { projectId?: string };
    const rows = await integrationService.listIntegrations(actorOf(req), q.projectId);
    return { integrations: rows };
  });

  app.post("/api/v1/integrations", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object(bodySchema).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return integrationService.createIntegration(actorOf(req), parsed.data);
  });

  app.patch("/api/v1/integrations/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(100).optional(),
      baseUrl: z.string().url().max(500).optional(),
      token: z.string().min(1).max(2000).optional(),
      projectId: z.string().uuid().nullable().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      isActive: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return integrationService.updateIntegration(actorOf(req), id, parsed.data);
  });

  app.get("/api/v1/integrations/:id/cursor", async (req) => {
    const { id } = idP.parse(req.params);
    return { cursor: await integrationSync.getSyncCursor(actorOf(req), id) };
  });

  app.post("/api/v1/integrations/:id/sync", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    return integrationSync.syncIntegration(actorOf(req), id);
  });

  app.delete("/api/v1/integrations/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await integrationService.deleteIntegration(actorOf(req), id);
    return { ok: true };
  });
}
