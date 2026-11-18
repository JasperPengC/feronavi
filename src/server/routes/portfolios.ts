/** 项目集端点（第十一期；权限沿用 project:create，规范未定义 portfolio:* 动作） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as pf from "../services/portfolio.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });

export async function registerPortfolioRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/portfolios", async (req) => ({ portfolios: await pf.listPortfolios(actorOf(req)) }));

  app.post("/api/v1/portfolios", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return pf.createPortfolio(actorOf(req), parsed.data);
  });

  app.get("/api/v1/portfolios/:id/summary", async (req) => {
    const { id } = idP.parse(req.params);
    return pf.getSummary(actorOf(req), id);
  });

  app.get("/api/v1/portfolios/:id", async (req) => {
    const { id } = idP.parse(req.params);
    return pf.getPortfolio(actorOf(req), id);
  });

  app.patch("/api/v1/portfolios/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return pf.updatePortfolio(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/portfolios/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await pf.deletePortfolio(actorOf(req), id);
    return { ok: true };
  });

  app.post("/api/v1/portfolios/:id/projects", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({ projectId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return pf.addProject(actorOf(req), id, parsed.data.projectId);
  });

  app.delete("/api/v1/portfolios/:id/projects/:projectId", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    return pf.removeProject(actorOf(req), id, projectId);
  });
}
