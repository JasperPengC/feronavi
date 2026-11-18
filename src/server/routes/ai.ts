/** AI 供应商与用量端点（第十三期，REST 9 节） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as ai from "../services/ai-config.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/ai/providers", async (req) => ({ providers: await ai.listProviders(actorOf(req)) }));

  /** 建供应商：base_url 过统一 SSRF 校验；密钥信封加密、不回显 */
  app.post("/api/v1/ai/providers", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      provider: z.enum(["OPENAI_COMPAT", "OLLAMA"]),
      baseUrl: z.string().url().max(2000),
      model: z.string().min(1).max(120),
      embeddingModel: z.string().min(1).max(120),
      purpose: z.enum(["BOTH", "LLM", "EMBEDDING"]).optional(),
      note: z.string().max(200).nullable().optional(),
      apiKey: z.string().max(400).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return ai.createProvider(actorOf(req), parsed.data);
  });

  app.patch("/api/v1/ai/providers/:id", { onRequest: app.csrfProtection }, async (req) => {
    const parsed = z.object({
      baseUrl: z.string().url().max(2000).optional(),
      model: z.string().min(1).max(120).optional(),
      embeddingModel: z.string().min(1).max(120).optional(),
      apiKey: z.string().max(400).nullable().optional(),
      isActive: z.boolean().optional(),
      purpose: z.enum(["BOTH", "LLM", "EMBEDDING"]).optional(),
      note: z.string().max(200).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ai.updateProvider(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/ai/providers/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await ai.deleteProvider(actorOf(req), id);
    return { ok: true };
  });

  app.post("/api/v1/ai/providers/:id/default", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ai.setDefaultProvider(actorOf(req), id);
  });

  /** 不落库的模型列表探测：用于配置表单的“获取模型” */
  app.post("/api/v1/ai/models", { onRequest: app.csrfProtection }, async (req) => {
    const parsed = z.object({
      provider: z.enum(["OPENAI_COMPAT", "OLLAMA"]),
      baseUrl: z.string().url().max(2000),
      apiKey: z.string().max(400).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return ai.listRemoteModels(actorOf(req), parsed.data);
  });

  app.post("/api/v1/ai/providers/:id/models", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({ baseUrl: z.string().url().max(2000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return ai.listModelsForProvider(actorOf(req), id, parsed.data);
  });

  app.post("/api/v1/ai/providers/:id/test", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ai.testProvider(actorOf(req), id);
  });

  app.get("/api/v1/ai/usage", async (req) => ai.summary(actorOf(req)));
  app.get("/api/v1/ai/usage/limits", async (req) => ai.summary(actorOf(req)));
}
