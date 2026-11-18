/**
 * 知识索引与检索端点（第十三期）
 * ⚠️ 检索在**未配置 AI 时同样可用**（退化为关键词），这是硬约束而非降级开关。
 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as knowledge from "../services/knowledge.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerKnowledgeRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  /** 重建某页索引（可重入） */
  app.post("/api/v1/pages/:id/reindex", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({ mode: z.enum(["INCREMENTAL", "FULL"]).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return knowledge.reindexPage(actor, id, parsed.data.mode ?? "INCREMENTAL");
  });

  app.get("/api/v1/pages/:id/index-jobs", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { jobs: await knowledge.listJobs(actor, id) };
  });

  /** 当前有效代与当前正文版本的切片预览；服务层复用 Wiki 项目范围与 ACL。 */
  app.get("/api/v1/pages/:id/chunks", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return knowledge.listPageChunks(actor, id);
  });

  /** 知识检索（关键词 / 向量自动选择，无 AI 配置时退化为关键词） */
  app.get("/api/v1/projects/:id/knowledge/search", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = req.query as { q?: string; limit?: string };
    if (!q.q || q.q.trim().length === 0) throw new DomainError("VALIDATION", "缺少查询词 q", null);
    return knowledge.searchKnowledge(actor, id, q.q.trim(), q.limit ? Number(q.limit) : 10);
  });

  /**
   * 知识问答（带引用）。**只读、无副作用**；未配置模型时降级为"给相关片段"而不是报错。
   * 引用由服务端从检索结果派生 —— 不让模型自由生成引用（那等于把幻觉包装成证据）。
   */
  app.post("/api/v1/knowledge/ask", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const parsed = z.object({
      projectId: z.string().uuid(),
      question: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return knowledge.askKnowledge(actor, parsed.data.projectId, parsed.data.question, parsed.data.limit ?? 5);
  });

  /** 索引配置状态（自检页/设置页用）：是否配置 AI、维度是否合法 */
  app.get("/api/v1/knowledge/ai-status", async () => {
    try {
      const cfg = await knowledge.loadAiConfig();
      const chat = await knowledge.loadChatConfig();
      return {
        configured: Boolean(cfg || chat),
        embeddingConfigured: Boolean(cfg),
        chatConfigured: Boolean(chat),
        dimensionOk: true,
        model: cfg?.model ?? chat?.model,
        embeddingModel: cfg?.model,
        chatModel: chat?.model,
        dimensions: cfg?.dimensions,
        message: !cfg ? "未配置向量模型；知识检索将使用关键词模式" : undefined,
      };
    } catch (e) {
      // 维度不合法时 loadAiConfig 会抛 VALIDATION —— 自检页要显示原因而不是 500
      return { configured: false, dimensionOk: false, message: (e as Error).message };
    }
  });
}
