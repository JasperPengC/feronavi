/** 附件路由（T4） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as attService from "../services/attachment.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idParam = z.object({ id: z.string().uuid() });

export async function registerAttachmentRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  /** 上传（文档 REST 10 节：POST /api/v1/uploads；multipart）*/
  app.post("/api/v1/uploads", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const file = await req.file();
    if (!file) throw new DomainError("VALIDATION", "缺少文件", null);

    const buf = await file.toBuffer();
    // fields 的类型是 Multipart | Multipart[]，取字符串字段要经这一层
    const fieldStr = (k: string): string => {
      const f = file.fields?.[k];
      if (!f) return "";
      return typeof f === "object" && "value" in f ? String(f.value) : "";
    };
    const row = await attService.upload(actor, {
      targetType: fieldStr("targetType"),
      targetId: fieldStr("targetId"),
      originalName: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buf.length,
      data: buf,
    });
    reply.status(201);
    return row;
  });

  app.get("/api/v1/attachments", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { targetType?: string; targetId?: string };
    if (!q.targetType || !q.targetId) throw new DomainError("VALIDATION", "缺少 targetType / targetId", null);
    return attService.listAttachments(actor, q.targetType, q.targetId);
  });

  /**
   * 下载：attachment，永远同源。
   * ⚠️ 与 preview 是两个独立端点（规范要求），不能合并。
   */
  app.get("/api/v1/attachments/:id", async (req, reply) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const { data, originalName, mimeType } = await attService.download(actor, id);
    return reply
      .header("content-type", mimeType)
      .header("content-disposition", `attachment; filename="${encodeURIComponent(originalName)}"`)
      .header("x-content-type-options", "nosniff")
      .send(data);
  });

  /** 预览：inline，仅白名单内类型 */
  app.get("/api/v1/attachments/:id/preview", async (req, reply) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const { data, mimeType } = await attService.preview(actor, id);
    return reply
      .header("content-type", mimeType)
      .header("content-disposition", "inline")
      .header("x-content-type-options", "nosniff")
      .send(data);
  });

  app.delete("/api/v1/attachments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    await attService.remove(actor, id);
    return { ok: true };
  });
}
