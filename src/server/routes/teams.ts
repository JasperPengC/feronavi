/** 团队端点（REST 第 3 节：列表/建/改/删 + 成员展开；member:manage） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as teamService from "../services/team.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const idP = z.object({ id: z.string().uuid() });

  app.get("/api/v1/teams", async (req) => {
    return { teams: await teamService.listTeams(actorOf(req)) };
  });

  app.post("/api/v1/teams", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1).max(100),
      parentId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return teamService.createTeam(actorOf(req), parsed.data);
  });

  app.patch("/api/v1/teams/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(100).optional(),
      parentId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return teamService.updateTeam(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/teams/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await teamService.deleteTeam(actorOf(req), id);
    return { ok: true };
  });

  app.get("/api/v1/teams/:id/members", async (req) => {
    const { id } = idP.parse(req.params);
    return teamService.listTeamMembers(actorOf(req), id);
  });
}
