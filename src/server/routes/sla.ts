/** SLA 策略与工作项 SLA 查询（P1-2） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as sla from "../services/sla.service.ts";
import * as wiService from "../services/work-item.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" { interface FastifyRequest { actor?: Actor } }

export async function registerSlaRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const projectId = (req: { params: unknown }) => z.object({ projectId: z.string().uuid() }).parse(req.params).projectId;

  app.get("/api/v1/projects/:projectId/sla-policies", async (req) =>
    ({ policies: await sla.listPolicies(actorOf(req), projectId(req)) }));

  app.post("/api/v1/projects/:projectId/sla-policies", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1).max(120),
      priority: z.string().max(20).nullable().optional(),
      severity: z.string().max(20).nullable().optional(),
      type: z.string().max(30).nullable().optional(),
      responseMinutes: z.number().int().positive(),
      resolveMinutes: z.number().int().positive(),
      escalateAfterMinutes: z.number().int().positive().optional(),
      escalateRoles: z.array(z.string().max(80)).max(20).optional(),
      calendar: z.object({
        enabled: z.boolean().optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        start: z.string().regex(/^\d{2}:\d{2}$/).optional(), end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
        extraWorkdays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
      }).nullable().optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return sla.createPolicy(actorOf(req), projectId(req), parsed.data);
  });

  app.patch("/api/v1/projects/:projectId/sla-policies/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(120).optional(),
      priority: z.string().max(20).nullable().optional(),
      severity: z.string().max(20).nullable().optional(),
      type: z.string().max(30).nullable().optional(),
      responseMinutes: z.number().int().positive().optional(),
      resolveMinutes: z.number().int().positive().optional(),
      escalateAfterMinutes: z.number().int().positive().optional(),
      escalateRoles: z.array(z.string().max(80)).max(20).optional(),
      calendar: z.object({
        enabled: z.boolean().optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        start: z.string().regex(/^\d{2}:\d{2}$/).optional(), end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
        extraWorkdays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
      }).nullable().optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return sla.updatePolicy(actorOf(req), projectId(req), id, parsed.data);
  });

  app.delete("/api/v1/projects/:projectId/sla-policies/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return sla.deletePolicy(actorOf(req), projectId(req), id);
  });

  app.post("/api/v1/work-items/:id/sla/pause", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { sla: await sla.pauseSla(actorOf(req), id) };
  });
  app.post("/api/v1/work-items/:id/sla/resume", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { sla: await sla.resumeSla(actorOf(req), id) };
  });
  app.get("/api/v1/work-items/:id/sla", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // 可见性复用工作项服务（不可见与不存在同形）
    await wiService.getWorkItem(actorOf(req), id);
    return { sla: await sla.getSla(id) };
  });
}
