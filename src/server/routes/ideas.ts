/** 想法与投票端点（第十一期，REST 9 节） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as ideaService from "../services/idea.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const pidP = z.object({ id: z.string().uuid() });

export async function registerIdeaRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/projects/:id/ideas", async (req) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    const q = req.query as { status?: string; page?: string; pageSize?: string };
    return ideaService.listIdeas(actor, id, {
      status: q.status, page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  });

  app.post("/api/v1/projects/:id/ideas", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    const parsed = z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(20000).nullable().optional(),
      submitterDisplay: z.string().max(80).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return ideaService.createIdea(actor, id, parsed.data);
  });

  app.get("/api/v1/ideas/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return ideaService.getIdea(actor, id);
  });

  app.patch("/api/v1/ideas/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(20000).nullable().optional(),
      status: z.enum(["NEW", "UNDER_REVIEW", "PLANNED", "REJECTED"]).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return ideaService.updateIdea(actor, id, parsed.data);
  });

  /** 投票（天然幂等：重复投票即改权重） */
  app.post("/api/v1/ideas/:id/vote", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({ weight: z.number().int().min(-1).max(5).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return ideaService.vote(actor, id, parsed.data.weight ?? 1);
  });

  app.delete("/api/v1/ideas/:id/vote", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await ideaService.unvote(actor, id);
    return { ok: true };
  });

  /** 转工作项（幂等） */
  app.post("/api/v1/ideas/:id/promote", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      type: z.enum(["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"]).optional(),
      priority: z.enum(["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"]).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return ideaService.promote(actor, id, parsed.data);
  });

  app.delete("/api/v1/ideas/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await ideaService.deleteIdea(actor, id);
    return { ok: true };
  });
}
