/** 工作项路由（R5）—— 薄层 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import "../plugins-types.ts";
import { DomainError } from "../../shared/errors.ts";
import {
  createWorkItemSchema, updateWorkItemSchema, listWorkItemsQuerySchema, boardQuerySchema,
} from "../../shared/schemas/work-item.ts";
import * as wiService from "../services/work-item.service.ts";
import * as revisions from "../services/requirement-revision.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerWorkItemRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/work-items/:id/revisions", async req => {
    const { id } = req.params as { id: string };
    return revisions.listRequirementRevisions(actorOf(req), id, req.query);
  });
  app.get("/api/v1/work-items/:id/revisions/:revisionId", async req => {
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    return revisions.getRequirementRevision(actorOf(req), id, revisionId);
  });

  // ── 建工作项 ──────────────────────────────────────────────
  app.post("/api/v1/projects/:projectId/work-items", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = req.params as { projectId: string };
    const parsed = createWorkItemSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const created = await wiService.createWorkItem(actor, projectId, parsed.data);
    reply.status(201);
    return created;
  });

  // ── 列表（含中文检索 q）────────────────────────────────────
  app.get("/api/v1/projects/:projectId/work-items", async (req) => {
    const actor = actorOf(req);
    const { projectId } = req.params as { projectId: string };
    const q = listWorkItemsQuerySchema.parse(req.query);

    // ── 视图分发（文档 REST 6 节：同一端点，?view= 投影）────────
    // 看板是唯一例外（独立端点 /board，形状不同）。
    if (q.view === "table") {
      const svc = await import("../services/planning-view.service.ts");
      return svc.table(actor, projectId, {
        page: q.page, pageSize: q.pageSize, type: q.type, priority: q.priority, unscheduled: q.unscheduled,
        milestoneId: q.milestoneId, iterationId: q.iterationId, releaseId: q.releaseId, moduleId: q.moduleId,
        sortBy: (q as { sortBy?: "created_at" | "updated_at" | "due_date" | "priority" | "number" }).sortBy,
        sortDir: (q as { sortDir?: "asc" | "desc" }).sortDir,
      });
    }
    if (q.view === "calendar") {
      // 文档契约：dateFrom/dateTo 窗口；month 是"当月"的糖
      let from = q.dateFrom, to = q.dateTo;
      if (q.month) { from = `${q.month}-01`; const [y, m] = q.month.split("-").map(Number); to = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); }
      const svc = await import("../services/planning-view.service.ts");
      return svc.calendar(actor, projectId, from ?? new Date().toISOString().slice(0, 8) + "01", to ?? new Date().toISOString().slice(0, 10));
    }
    if (q.view === "timeline") {
      const svc = await import("../services/planning-view.service.ts");
      const t = q as { dateFrom?: string; dateTo?: string };
      return svc.timeline(actor, projectId, t.dateFrom ?? new Date().toISOString().slice(0, 8) + "01", t.dateTo ?? new Date().toISOString().slice(0, 10));
    }

    return wiService.listWorkItems(actor, projectId, q);
  });

  // ── 详情 ──────────────────────────────────────────────────
  app.get("/api/v1/work-items/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const wi = await wiService.getWorkItem(actor, id);
    // 详情里带上「当前状态下我能做哪些流转」，前端据此启用/禁用拖拽目标列
    const transitions = await wiService.allowedTransitions(actor, wi);
    return { ...wi, allowedTransitions: transitions };
  });

  app.get("/api/v1/work-items/:id/children", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return wiService.listChildren(actor, id);
  });

  // ── 更新（乐观锁：必须带 version）──────────────────────────
  app.patch("/api/v1/work-items/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    // strict：不可改字段（number/key/projectId/type）传了就 400
    const parsed = updateWorkItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION", "参数不合法（version 必填；number/key/projectId/type 不可修改）", parsed.error.issues);
    }
    const updated = await wiService.updateWorkItem(actor, id, parsed.data as unknown as Record<string, unknown>);
    return updated;
  });

  // ── 状态流转（R6）──────────────────────────────────────────

  // ── 指派（文档 6 节独立端点；权限是 work_item:assign，不是 update_*）──
  app.post("/api/v1/work-items/:id/assign", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const body = req.body as { assigneeId?: string | null };
    const cur = await wiService.getWorkItem(actor, id);
    return wiService.updateWorkItem(actor, id, {
      version: (cur as { version: number }).version,
      assigneeId: body.assigneeId ?? null,
    });
  });


  // ── 批量操作（文档 6 节；总纲 5.12 部分成功报告）──────────────
  app.post("/api/v1/work-items/batch", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const parsed = z.object({
      op: z.enum(["transition", "update", "assign", "delete"]),
      itemIds: z.array(z.string().uuid()).min(1).max(1000),
      patch: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const svc = await import("../services/batch.service.ts");
    return svc.runBatch(actor, parsed.data);
  });

  app.post("/api/v1/work-items/:id/transition", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const body = req.body as { toStateKey?: string; version?: number; fields?: Record<string, unknown> };
    if (!body?.toStateKey || typeof body.version !== "number") {
      throw new DomainError("VALIDATION", "参数不合法（toStateKey 与 version 必填）", null);
    }
    return wiService.transitionWorkItem(actor, id, {
      toStateKey: body.toStateKey, version: body.version, fields: body.fields,
    });
  });

  // ── 看板聚合（R6）──────────────────────────────────────────
  app.get("/api/v1/projects/:projectId/work-items/board", async (req) => {
    const actor = actorOf(req);
    const { projectId } = req.params as { projectId: string };
    const q = boardQuerySchema.parse(req.query);
    const [columns, workflows] = await Promise.all([
      wiService.loadBoard(actor, projectId, q.pageSizePerColumn, q),
      wiService.listBoardWorkflows(actor, projectId),
    ]);
    return {
      workflows,
      columns: columns.map((c) => ({
        stateKey: c.stateKey, name: c.name, category: c.category, color: c.color,
        wipLimit: c.wipLimit, items: c.items, count: c.count,
        // 列内超出上限时告知前端「还有 N 条」，而不是静默截断
        truncated: c.count > c.items.length,
      })),
      total: columns.reduce((n, c) => n + c.count, 0),
    };
  });


  app.get("/api/v1/projects/:projectId/work-items/board/columns/:stateKey", async (req) => {
    const actor = actorOf(req);
    const { projectId, stateKey } = req.params as { projectId: string; stateKey: string };
    const q = boardQuerySchema.extend({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(req.query);
    return wiService.loadBoardColumn(actor, projectId, stateKey, q.offset, q.limit, q);
  });

  // ── 导出（第八期 W4，REST 6 节）：CSV + schemaVersion 响应头 ──
  app.get("/api/v1/projects/:projectId/work-items/export", async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = req.params as { projectId: string };
    const q = req.query as Record<string, string | undefined>;
    const parsed = z.object({
      type: z.string().max(20).optional(), severity: z.string().max(10).optional(),
      priority: z.string().max(20).optional(), statusCategory: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
      assigneeId: z.string().uuid().optional(), milestoneId: z.string().uuid().optional(), q: z.string().max(200).optional(),
    }).safeParse(q);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const svc = await import("../services/export.service.ts");
    const { csv, count } = await svc.exportWorkItemsCsv(actor, projectId, parsed.data);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="work-items-${projectId}.csv"`)
      .header("x-schema-version", svc.EXPORT_SCHEMA_VERSION)
      .header("x-row-count", String(count))
      .send(csv);
  });

  // ── 转派历史与转派动作（Round 79）──────────────────────────────
  app.get("/api/v1/work-items/:id/transfers", async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const { listTransfers } = await import("../services/work-item-transfer.service.ts");
    return { transfers: await listTransfers(actor, id) };
  });

  app.post("/api/v1/work-items/:id/transfer", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const parsed = z.object({
      assigneeId: z.string().uuid().nullable(),
      version: z.number().int().min(1),
      reason: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { transferWorkItem } = await import("../services/work-item-transfer.service.ts");
    return transferWorkItem(actor, id, parsed.data);
  });

  // ── 跨项目问题总览（Round 71 对标）：可见项目聚合 ─────────────────────
  app.get("/api/v1/issues/stats", async (req) => {
    const actor = actorOf(req);
    const { issueStatsGlobal } = await import("../services/issues.service.ts");
    return issueStatsGlobal(actor);
  });

  app.get("/api/v1/issues/export", async (req, reply) => {
    const actor = actorOf(req);
    const q = req.query as Record<string, string | undefined>;
    const parsed = z.object({
      projectId: z.string().uuid().optional(),
      statusCategory: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
      severity: z.enum(["S1", "S2", "S3", "S4"]).optional(),
      priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).optional(),
      quick: z.enum(["ASSIGNED", "REPORTED", "WATCHING", "COLLABORATING"]).optional(),
      q: z.string().max(200).optional(),
    }).safeParse(q);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { exportIssuesCsv } = await import("../services/issues.service.ts");
    const { csv, count } = await exportIssuesCsv(actor, parsed.data);
    const svc = await import("../services/export.service.ts");
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="issues-export-${Date.now()}.csv"`)
      .header("x-schema-version", svc.EXPORT_SCHEMA_VERSION)
      .header("x-row-count", String(count))
      .send(csv);
  });

  app.get("/api/v1/issues", async (req) => {
    const actor = actorOf(req);
    const q = req.query as Record<string, string | undefined>;
    const parsed = z.object({
      projectId: z.string().uuid().optional(),
      statusCategory: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
      severity: z.enum(["S1", "S2", "S3", "S4"]).optional(),
      priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).optional(),
      quick: z.enum(["ASSIGNED", "REPORTED", "WATCHING", "COLLABORATING"]).optional(),
      sort: z.enum(["NEWEST", "OLDEST", "SEVERITY", "DUE"]).optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }).safeParse(q);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { listIssuesGlobal } = await import("../services/issues.service.ts");
    return listIssuesGlobal(actor, parsed.data);
  });

  // ── 问题追踪（Round 64 对标）：缺陷聚合统计/列表 + 结构化处理进展 ──────
  app.get("/api/v1/projects/:projectId/issues/stats", async (req) => {
    const actor = actorOf(req);
    const { projectId } = req.params as { projectId: string };
    const { issueStats } = await import("../services/issues.service.ts");
    return issueStats(actor, projectId);
  });

  app.get("/api/v1/projects/:projectId/issues", async (req) => {
    const actor = actorOf(req);
    const { projectId } = req.params as { projectId: string };
    const q = req.query as Record<string, string | undefined>;
    const parsed = z.object({
      statusCategory: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
      severity: z.enum(["S1", "S2", "S3", "S4"]).optional(),
      priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).optional(),
      quick: z.enum(["ASSIGNED", "REPORTED", "WATCHING", "COLLABORATING"]).optional(),
      sort: z.enum(["NEWEST", "OLDEST", "SEVERITY", "DUE"]).optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }).safeParse(q);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { listIssues } = await import("../services/issues.service.ts");
    return listIssues(actor, projectId, parsed.data);
  });

  app.get("/api/v1/work-items/:id/progress-updates", async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const { listProgressUpdates } = await import("../services/issues.service.ts");
    return { updates: await listProgressUpdates(actor, id) };
  });

  app.post("/api/v1/work-items/:id/progress-updates", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const parsed = z.object({
      summary: z.string().min(1).max(2000),
      nextSteps: z.string().max(5000).nullable().optional(),
      blockers: z.string().max(5000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { addProgressUpdate } = await import("../services/issues.service.ts");
    reply.status(201);
    return addProgressUpdate(actor, id, parsed.data);
  });

  app.delete("/api/v1/work-item-progress-updates/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    const { deleteProgressUpdate } = await import("../services/issues.service.ts");
    await deleteProgressUpdate(actor, id);
    return { ok: true };
  });

  // ── 软删 ──────────────────────────────────────────────────
  app.delete("/api/v1/work-items/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    await wiService.deleteWorkItem(actor, id);
    return { ok: true };
  });
}
