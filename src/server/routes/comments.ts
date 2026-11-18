/** 评论路由（T2） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as commentService from "../services/comment.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idParam = z.object({ id: z.string().uuid() });

export async function registerCommentRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  /**
   * 文档 REST 6 节契约：评论嵌套在工作项下
   * （GET/POST /api/v1/work-items/:id/comments）。
   * 此前实现成顶层 ?targetType=&targetId= 查询式 —— 已按文档收敛。
   * 多态能力保留在服务层（targetType 由路径推导），未来 IDEA/PAGE 复用。
   */
  app.post("/api/v1/work-items/:id/comments", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({
      body: z.string().min(1, "评论内容不能为空").max(20000),
      parentId: z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const row = await commentService.createComment(actor, {
      targetType: "WORK_ITEM", targetId: id,
      body: parsed.data.body, parentId: parsed.data.parentId ?? null,
    });
    reply.status(201);
    return row;
  });

  app.get("/api/v1/work-items/:id/comments", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = req.query as { parentId?: string };
    // parentId 缺省 = 只取顶层；显式传 id = 取该评论下的回复
    const parentId = q.parentId ? q.parentId : null;
    return commentService.listComments(actor, "WORK_ITEM", id, { parentId });
  });

  /** 多态评论：里程碑/知识库页面等工作项之外的评论目标 */
  app.get("/api/v1/comments", async (req) => {
    const actor = actorOf(req);
    const q = z.object({
      targetType: z.enum(["MILESTONE", "PAGE"]),
      targetId: z.string().uuid(),
      parentId: z.string().uuid().optional(),
    }).parse(req.query);
    return commentService.listComments(actor, q.targetType, q.targetId, { parentId: q.parentId ?? null });
  });

  app.post("/api/v1/comments", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      targetType: z.enum(["MILESTONE", "PAGE"]),
      targetId: z.string().uuid(),
      body: z.string().min(1, "评论内容不能为空").max(20000),
      parentId: z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const row = await commentService.createComment(actor, {
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      body: parsed.data.body,
      parentId: parsed.data.parentId ?? null,
    });
    reply.status(201);
    return row;
  });

  app.patch("/api/v1/comments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = z.object({ body: z.string().min(1).max(20000) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return commentService.updateComment(actor, id, parsed.data.body);
  });

  app.delete("/api/v1/comments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    await commentService.deleteComment(actor, id);
    return { ok: true };
  });
}
