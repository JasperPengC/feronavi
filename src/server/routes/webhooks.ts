/** Webhook 端点与投递（第十一期，REST 8.3） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as wh from "../services/webhook.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/webhooks", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { projectId?: string };
    return { endpoints: await wh.listEndpoints(actor, q.projectId ?? null) };
  });

  /** 建端点：**明文签名密钥只在此响应出现一次** */
  app.post("/api/v1/webhooks", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      name: z.string().min(1).max(80),
      url: z.string().url().max(2000),
      events: z.array(z.string()).min(1),
      projectId: z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return wh.createEndpoint(actor, parsed.data);
  });

  app.patch("/api/v1/webhooks/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      url: z.string().url().max(2000).optional(),
      events: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return wh.updateEndpoint(actor, id, parsed.data);
  });

  app.delete("/api/v1/webhooks/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await wh.deleteEndpoint(actor, id);
    return { ok: true };
  });

  app.get("/api/v1/webhooks/:id/deliveries", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const q = req.query as { status?: string };
    return { deliveries: await wh.listDeliveries(actor, id, { status: q.status }) };
  });

  /** 手动重放：死信队列的唯一人工出口 */
  app.post("/api/v1/webhook-deliveries/:id/replay", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return wh.replayDelivery(actor, id);
  });
}
