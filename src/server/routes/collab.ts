/** 关系 / 协作者 / 关注 / 工时 / 个人偏好路由（第五期 B 线） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as relationService from "../services/relation.service.ts";
import * as collabService from "../services/collab.service.ts";
import * as prefsTimeService from "../services/prefs-time.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const wiId = z.object({ id: z.string().uuid() });

export async function registerCollabRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  // ── relations（C-13 无环）──────────────────────────────────
  app.get("/api/v1/work-items/:id/relations", async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    return relationService.listRelations(actor, id);
  });

  app.post("/api/v1/work-items/:id/relations", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    const parsed = z.object({
      targetId: z.string().uuid(),
      type: z.enum(["BLOCKS", "BLOCKED_BY", "RELATES_TO", "DUPLICATES"]),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return relationService.addRelation(actor, id, parsed.data);
  });

  app.delete("/api/v1/work-items/:id/relations/:relId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    const { relId } = z.object({ relId: z.string().uuid() }).parse(req.params);
    await relationService.removeRelation(actor, id, relId);
    return { ok: true };
  });

  // ── collaborators（C-23 编辑权 / C-24 不高于项目角色）────────
  app.get("/api/v1/work-items/:id/collaborators", async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    return collabService.listCollaborators(actor, id);
  });

  app.post("/api/v1/work-items/:id/collaborators", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    const parsed = z.object({ memberId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return collabService.addCollaborator(actor, id, parsed.data.memberId);
  });

  app.delete("/api/v1/work-items/:id/collaborators/:memberId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id, memberId } = z.object({ id: z.string().uuid(), memberId: z.string().uuid() }).parse(req.params);
    await collabService.removeCollaborator(actor, id, memberId);
    return { ok: true };
  });

  app.get("/api/v1/work-items/:id/watchers", async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    return { watchers: await collabService.listWatchers(actor, id) };
  });

  // ── follow（幂等；channels 传 IN_APP/EMAIL，文档 6 节）────────
  app.put("/api/v1/work-items/:id/follow", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    const parsed = z.object({ channels: z.array(z.enum(["IN_APP", "EMAIL"])).optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    await collabService.follow(actor, id, parsed.data.channels ?? ["IN_APP"]);
    return { ok: true };
  });

  app.delete("/api/v1/work-items/:id/follow", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    await collabService.unfollow(actor, id);
    return { ok: true };
  });

  // ── time-logs（只记录不计费）────────────────────────────────
  app.get("/api/v1/work-items/:id/time-logs", async (req) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    return prefsTimeService.listTimeLogs(actor, id);
  });

  app.post("/api/v1/work-items/:id/time-logs", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = wiId.parse(req.params);
    const parsed = z.object({
      minutes: z.number().int().positive(),
      loggedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return prefsTimeService.addTimeLog(actor, id, parsed.data);
  });

  app.patch("/api/v1/time-logs/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({
      minutes: z.number().int().positive().optional(),
      loggedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      note: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return prefsTimeService.updateTimeLog(actor, id, parsed.data);
  });

  app.delete("/api/v1/time-logs/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await prefsTimeService.deleteTimeLog(actor, id);
    return { ok: true };
  });

  // ── 个人偏好（REST 7e）─────────────────────────────────────
  app.get("/api/v1/me/preferences", async (req) => {
    const actor = actorOf(req);
    return prefsTimeService.getPreferences(actor);
  });

  app.put("/api/v1/me/preferences", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const parsed = z.object({
      theme: z.enum(["dark", "light", "system"]).optional(),
      locale: z.string().max(10).optional(),
      timezone: z.string().max(64).nullable().optional(),
      density: z.enum(["comfortable", "compact"]).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return prefsTimeService.putPreferences(actor, parsed.data);
  });
}
