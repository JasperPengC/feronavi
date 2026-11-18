/** 自动化规则 CRUD + dry-run + 运行日志（P1-1） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as automation from "../services/automation.service.ts";
import type { Actor } from "../permission/actor.ts";
import { createAutomationRuleSchema, updateAutomationRuleSchema } from "../../shared/schemas/automation.ts";

declare module "fastify" { interface FastifyRequest { actor?: Actor } }

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const pid = (req: { params: unknown }) => z.object({ projectId: z.string().uuid() }).parse(req.params).projectId;

  app.get("/api/v1/projects/:projectId/automation-rules", async (req) =>
    ({ rules: await automation.listRules(actorOf(req), pid(req)) }));

  app.post("/api/v1/projects/:projectId/automation-rules", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = createAutomationRuleSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return automation.createRule(actorOf(req), pid(req), parsed.data);
  });

  app.patch("/api/v1/projects/:projectId/automation-rules/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = updateAutomationRuleSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return automation.updateRule(actorOf(req), pid(req), id, parsed.data);
  });

  app.delete("/api/v1/projects/:projectId/automation-rules/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return automation.deleteRule(actorOf(req), pid(req), id);
  });

  app.post("/api/v1/projects/:projectId/automation-rules/:id/test", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { workItemId } = z.object({ workItemId: z.string().uuid() }).parse(req.body);
    const rules = await automation.listRules(actorOf(req), pid(req));
    const rule = rules.find((r) => r.id === id);
    if (!rule) throw new DomainError("NOT_FOUND", "规则不存在", null);
    return automation.testRule(actorOf(req), pid(req), rule, workItemId);
  });

  app.get("/api/v1/projects/:projectId/automation-runs", async (req) => {
    const q = req.query as { workItemId?: string; limit?: string };
    return { runs: await automation.listRuns(actorOf(req), pid(req), { workItemId: q.workItemId, limit: q.limit ? Number(q.limit) : undefined }) };
  });
}
