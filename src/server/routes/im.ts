/** IM 集成端点（Round 76）：配置 CRUD + 真实测试发送 —— 权限在服务层（integration:manage） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as im from "../services/im.service.ts";

const idParam = z.object({ id: z.string().uuid() });
const base = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(["DINGTALK", "WECOM", "FEISHU"]),
  webhookUrl: z.string().max(1000).nullable().optional(),
  appKey: z.string().max(500).nullable().optional(),
  appSecret: z.string().max(1000).nullable().optional(),
  corpId: z.string().max(200).nullable().optional(),
  agentId: z.string().max(200).nullable().optional(),
  recipients: z.string().max(2000).nullable().optional(),
  events: z.array(z.string().max(40)).max(20).optional(),
  enabled: z.boolean().optional(),
});

export async function registerImRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/im/channels", async (req) => im.listChannels(actorOf(req)));

  app.post("/api/v1/im/channels", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = base.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return im.createChannel(actor, parsed.data);
  });

  app.patch("/api/v1/im/channels/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = base.partial().safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return im.updateChannel(actor, id, parsed.data);
  });

  app.delete("/api/v1/im/channels/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    await im.deleteChannel(actor, id);
    return { ok: true };
  });

  app.post("/api/v1/im/channels/:id/test", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = z.object({ text: z.string().min(1).max(2000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return im.testChannel(actor, id, parsed.data.text);
  });
}
