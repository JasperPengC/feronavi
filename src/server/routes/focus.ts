/** 时间块与今日聚焦端点（第十一期，REST 5 节；全部「仅本人」） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as focus from "../services/focus.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const isoDt = z.string().min(10).max(40);

export async function registerFocusRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/time-blocks", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { from?: string; to?: string };
    return { blocks: await focus.listBlocks(actor, { from: q.from, to: q.to }) };
  });

  app.post("/api/v1/time-blocks", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      title: z.string().min(1).max(200),
      startAt: isoDt, endAt: isoDt,
      projectId: z.string().uuid().nullable().optional(),
      workItemId: z.string().uuid().nullable().optional(),
      color: z.string().max(32).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return focus.createBlock(actor, parsed.data);
  });

  app.patch("/api/v1/time-blocks/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      title: z.string().min(1).max(200).optional(),
      startAt: isoDt.optional(), endAt: isoDt.optional(),
      projectId: z.string().uuid().nullable().optional(),
      workItemId: z.string().uuid().nullable().optional(),
      color: z.string().max(32).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return focus.updateBlock(actor, id, parsed.data);
  });

  app.delete("/api/v1/time-blocks/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await focus.deleteBlock(actor, id);
    return { ok: true };
  });

  /** 今日聚焦汇总（工作台一张卡） */
  app.get("/api/v1/focus/today", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { day?: string };
    return focus.todayFocus(actor, q.day);
  });

  app.get("/api/v1/focus-sessions", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { day?: string };
    return { sessions: await focus.listFocusSessions(actor, { day: q.day }) };
  });

  /** 记录一次**已结束**的聚焦（进行中的会话不落库） */
  app.post("/api/v1/focus-sessions", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      timeBlockId: z.string().uuid(),
      startedAt: isoDt, endedAt: isoDt,
      actualMinutes: z.number().int().min(0).max(24 * 60).optional(),
      note: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return focus.recordFocusSession(actor, parsed.data);
  });

  app.patch("/api/v1/focus-sessions/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      actualMinutes: z.number().int().min(0).max(24 * 60).optional(),
      note: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return focus.updateFocusSession(actor, id, parsed.data);
  });
}
