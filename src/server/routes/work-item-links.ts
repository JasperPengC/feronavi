/** 跨域引用链接端点（REST 第 3 节：GET/POST /work-items/:id/links、DELETE /work-item-links/:id） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as linkService from "../services/work-item-link.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerWorkItemLinkRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const idP = z.object({ id: z.string().uuid() });

  app.get("/api/v1/work-items/:id/links", async (req) => {
    const { id } = idP.parse(req.params);
    return { links: await linkService.listLinks(actorOf(req), id) };
  });

  app.post("/api/v1/work-items/:id/links", { onRequest: app.csrfProtection }, async (req, reply) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      targetType: z.enum(linkService.LINK_TYPES),
      targetId: z.string().uuid(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return linkService.createLink(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/work-item-links/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await linkService.deleteLink(actorOf(req), id);
    return { ok: true };
  });
}
