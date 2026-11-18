/** 工作流可视化配置路由（W6，REST 7 节） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as svc from "../services/workflow-config.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const ids = z.object({ id: z.string().uuid(), stateId: z.string().uuid() });

export async function registerWorkflowConfigRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/workflows", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { projectId?: string };
    return svc.listWorkflows(actor, q.projectId);
  });

  app.post("/api/v1/workflows", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(120),
      appliesToType: z.enum(["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"]),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return svc.createWorkflow(actor, parsed.data);
  });

  app.patch("/api/v1/workflows/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(120).optional(),
      isDefault: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return svc.updateWorkflow(actor, id, parsed.data);
  });

  app.get("/api/v1/workflows/:id/states", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return svc.listStates(actor, id);
  });

  app.post("/api/v1/workflows/:id/states", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      key: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "key 用大写字母/数字/下划线"),
      name: z.string().min(1).max(60),
      category: z.enum(["NOT_STARTED", "IN_PROGRESS", "TERMINAL"]),
      sortOrder: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return svc.addState(actor, id, parsed.data);
  });

  app.patch("/api/v1/workflows/:id/states/:stateId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id, stateId } = ids.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(60).optional(),
      wipLimit: z.number().int().min(1).max(999).nullable().optional(),
      sortOrder: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return svc.updateState(actor, id, stateId, parsed.data);
  });

  app.post("/api/v1/workflows/:id/states/:stateId/archive", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id, stateId } = ids.parse(req.params);
    await svc.archiveState(actor, id, stateId);
    return { ok: true };
  });

  app.get("/api/v1/workflows/:id/transitions", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return svc.listTransitions(actor, id);
  });

  app.post("/api/v1/workflows/:id/transitions", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      fromStateId: z.string().uuid(),
      toStateId: z.string().uuid(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return svc.addTransition(actor, id, parsed.data);
  });

  app.patch("/api/v1/workflows/:id/transitions/:transitionId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const { transitionId } = z.object({ transitionId: z.string().uuid() }).parse(req.params);
    const parsed = z.object({ requiresApproval: z.boolean().optional(), approverRoleKeys: z.array(z.string().max(80)).max(20).optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return svc.updateTransition(actor, id, transitionId, parsed.data);
  });

  app.delete("/api/v1/workflows/:id/transitions/:transitionId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const { transitionId } = z.object({ transitionId: z.string().uuid() }).parse(req.params);
    await svc.removeTransition(actor, id, transitionId);
    return { ok: true };
  });
}
