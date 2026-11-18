/** 洞察端点（第十期，REST 9 节）：仪表盘 CRUD + 挂件 + 燃尽/累积流 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as insight from "../services/insight.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const WIDGET_TYPES = ["BURNDOWN", "CUMULATIVE_FLOW", "ACTIVITY_HEATMAP", "PIE", "LIST", "COUNT"] as const;

export async function registerInsightRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/dashboards", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { projectId?: string };
    return { dashboards: await insight.listDashboards(actor, q.projectId) };
  });

  app.post("/api/v1/dashboards", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      name: z.string().min(1).max(80),
      projectId: z.string().uuid().nullable().optional(),
      isDefault: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return insight.createDashboard(actor, parsed.data);
  });

  /** 详情：挂件 + 每个挂件的当前数据（前端不必为每个挂件各打一次） */
  app.get("/api/v1/dashboards/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const d = await insight.getDashboard(actor, id);
    const widgets = await Promise.all(d.widgets.map(async (w) => ({ ...w, data: await insight.widgetData(actor, w) })));
    return { ...d, widgets };
  });

  app.patch("/api/v1/dashboards/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({ name: z.string().min(1).max(80).optional(), isDefault: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return insight.updateDashboard(actor, id, parsed.data);
  });

  app.delete("/api/v1/dashboards/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await insight.deleteDashboard(actor, id);
    return { ok: true };
  });

  app.get("/api/v1/dashboards/:id/widgets", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return { widgets: await insight.listWidgets(actor, id) };
  });

  app.post("/api/v1/dashboards/:id/widgets", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      type: z.enum(WIDGET_TYPES),
      config: z.record(z.string(), z.unknown()).optional(),
      sortOrder: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return insight.addWidget(actor, id, parsed.data);
  });

  app.patch("/api/v1/dashboard-widgets/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      type: z.enum(WIDGET_TYPES).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      sortOrder: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return insight.updateWidget(actor, id, parsed.data);
  });

  app.delete("/api/v1/dashboard-widgets/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await insight.deleteWidget(actor, id);
    return { ok: true };
  });

  // ⚠️ metric_snapshot **不暴露 CRUD**（规范：由 worker 写入，避免手改指标）
  // 挂件数据（第 19 轮）：把四类"待渲染"挂件变成真实聚合；口径写在返回体的 metric 字段里
  app.get("/api/v1/dashboards/:id/widgets/:wid/data", async (req) => {
    const actor = actorOf(req);
    const { id, wid } = z.object({ id: z.string().uuid(), wid: z.string().uuid() }).parse(req.params);
    const w = await insight.getWidget(actor, id, wid);
    return insight.widgetData(actor, w);
  });

  // 项目级活动趋势（第 55 轮）：工作台主面板 trend-chart 的真实数据源
  app.get("/api/v1/projects/:id/activity-series", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const q = req.query as { days?: string };
    return insight.projectActivitySeries(actor, id, q.days ? Number(q.days) : 56);
  });

  app.get("/api/v1/iterations/:id/burndown", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return insight.burnDown(actor, id);
  });

  app.get("/api/v1/iterations/:id/cumulative-flow", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return insight.cumulativeFlow(actor, id);
  });
}
