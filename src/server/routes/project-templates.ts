/** 项目模板端点（REST 第 3 节：GET/POST/PATCH/DELETE /project-templates + POST /projects/from-template） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as tplService from "../services/project-template.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerProjectTemplateRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const idP = z.object({ id: z.string().uuid() });

  app.get("/api/v1/project-templates", async (req) => {
    return { templates: await tplService.listTemplates(actorOf(req)) };
  });

  app.get("/api/v1/project-templates/:id", async (req) => {
    const { id } = idP.parse(req.params);
    return tplService.getTemplate(actorOf(req), id);
  });

  app.post("/api/v1/project-templates", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(120), payload: z.unknown().optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return tplService.createTemplate(actorOf(req), parsed.data);
  });

  app.patch("/api/v1/project-templates/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({ name: z.string().min(1).max(120).optional(), payload: z.unknown().optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return tplService.updateTemplate(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/project-templates/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await tplService.deleteTemplate(actorOf(req), id);
    return { ok: true };
  });

  app.post("/api/v1/projects/from-template", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      key: z.string().min(2).max(10),
      name: z.string().min(1).max(100),
      description: z.string().max(2000).nullable().optional(),
      templateId: z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return tplService.createProjectFromTemplate(actorOf(req), parsed.data);
  });
}
