/**
 * 导入端点（第九期，REST 12 节）
 *
 * 权限：全部走 `work_item:create` + 数据范围 —— **dry-run 与 confirm 权限相同**
 * （规范：试运行会暴露映射结果与外部数据规模，且要避免「能预览、不能导入」的落差）。
 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as importService from "../services/import.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const pidP = z.object({ projectId: z.string().uuid() });

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  /** 上传文件并建批次（multipart）。表单可带 encoding 显式覆盖编码识别 */
  app.post("/api/v1/projects/:projectId/imports", {
    onRequest: app.csrfProtection,
  }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = pidP.parse(req.params);
    const file = await req.file();
    if (!file) throw new DomainError("VALIDATION", "缺少上传文件（字段名 file）", null);
    const buf = await file.toBuffer();
    if (buf.length > 20 * 1024 * 1024) throw new DomainError("VALIDATION", "文件超过 20MB", null);
    const fields = file.fields as Record<string, { value?: unknown }>;
    const encoding = typeof fields?.encoding?.value === "string" ? fields.encoding.value : null;
    const r = await importService.createBatch(actor, projectId, {
      filename: file.filename ?? null, buffer: buf,
      // 来源可以是 CSV / ZENTAO_API（禅道导出）/ JIRA_API（Jira 导出）
      source: typeof fields?.source?.value === "string" ? fields.source.value : "CSV",
      encoding,
    });
    reply.status(201);
    return {
      batchId: r.batch.id,
      status: r.batch.status,
      totalRows: r.batch.totalRows,
      encoding: r.encoding,
      header: r.header,
      sampleRows: r.sampleRows,
    };
  });

  app.get("/api/v1/projects/:projectId/imports", async (req) => {
    const actor = actorOf(req);
    const { projectId } = pidP.parse(req.params);
    return { batches: await importService.listBatches(actor, projectId) };
  });

  /** 映射建议（按来源预设）：只建议，不自动套用 —— 规范要求映射经人工确认 */
  app.get("/api/v1/imports/:id/suggestions", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return importService.suggestForBatch(actor, id);
  });

  app.get("/api/v1/imports/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return importService.getBatch(actor, id);
  });

  app.put("/api/v1/imports/:id/mapping", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      fieldMap: z.record(z.string(), z.string()),
      valueMaps: z.record(z.string(), z.record(z.string(), z.string())).optional(),
      userMap: z.record(z.string(), z.string().uuid()).optional(),
      externalIdColumn: z.string().nullable().optional(),
      defaultType: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return importService.setMapping(actor, id, parsed.data);
  });

  app.post("/api/v1/imports/:id/dry-run", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return importService.dryRun(actor, id);
  });

  app.post("/api/v1/imports/:id/confirm", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return importService.confirm(actor, id);
  });

  app.post("/api/v1/imports/:id/retry-failed", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return importService.confirm(actor, id, { retryFailedOnly: true });
  });

  app.post("/api/v1/imports/:id/rollback", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return importService.rollback(actor, id);
  });
}
