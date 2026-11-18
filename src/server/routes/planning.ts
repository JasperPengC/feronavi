/** 计划实体路由（里程碑/迭代/版本/模块）—— 薄层 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { DomainError } from "../../shared/errors.ts";
import * as planningService from "../services/planning.service.ts";
import { db } from "../../db/index.ts";
import { iterationCapacity, projectMembership } from "../../db/schema.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import {
  createSavedViewSchema,
} from "../../shared/schemas/planning.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idParam = z.object({ id: z.string().uuid() });
const pidParam = z.object({ projectId: z.string().uuid() });

export async function registerPlanningRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  /**
   * ⚠️ 四个实体结构相同，但**刻意写成四份而不是用工厂**：
   *    它们的列并不一致（iteration/module 没有 updated_at，只有 milestone 有
   *    progress_mode/progress_value），用联合表的工厂写法会让 TypeScript
   *    无法收窄类型，只能靠 `as never` 糊过去 —— 那等于放弃了类型检查。
   *    四份显式路由长一点，但每一处 `.set()` 都有真实类型校验。
   */

  // ══ 里程碑 ═══════════════════════════════════════════════
  app.get("/api/v1/projects/:projectId/milestones", async (req) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    const q = req.query as { archived?: string };
    return planningService.list(actor, projectId, "milestone", { includeArchived: q.archived === "true" });
  });
  app.post("/api/v1/projects/:projectId/milestones", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    // 统一走 service：参数校验 + 项目可见 + **权限判定** + 落库（此前内联实现漏了权限判定）
    const row = await planningService.createPlan(actor, projectId, "milestone", req.body);
    reply.status(201);
    return row;
  });
  /** 更新日志（Round 67 对标）：跨可见项目的用户可见 release notes */
  app.get("/api/v1/changelog", async (req) => {
    const actor = actorOf(req);
    const q = req.query as { projectId?: string };
    const { changelog } = await import("../services/changelog.service.ts");
    return changelog(actor, { projectId: q.projectId });
  });

  /** 里程碑详情（Round 62）：本体 + 关联工作项 + 结构化进展记录 */
  app.get("/api/v1/milestones/:id/detail", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const { milestoneDetail } = await import("../services/milestone-detail.service.ts");
    return milestoneDetail(actor, id);
  });

  app.get("/api/v1/milestones/:id/progress-updates", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const { milestoneDetail } = await import("../services/milestone-detail.service.ts");
    const detail = await milestoneDetail(actor, id);
    return { updates: detail.progressUpdates };
  });

  app.post("/api/v1/milestones/:id/progress-updates", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = z.object({
      summary: z.string().min(1).max(2000),
      nextSteps: z.string().max(5000).nullable().optional(),
      blockers: z.string().max(5000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { addProgressUpdate } = await import("../services/milestone-detail.service.ts");
    reply.status(201);
    return addProgressUpdate(actor, id, parsed.data);
  });

  app.delete("/api/v1/milestone-progress-updates/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const { deleteProgressUpdate } = await import("../services/milestone-detail.service.ts");
    await deleteProgressUpdate(actor, id);
    return { ok: true };
  });

  app.get("/api/v1/milestones/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.get(actor, id, "milestone");
  });
  app.patch("/api/v1/milestones/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.updatePlan(actor, id, "milestone", req.body);
  });

  // ══ 迭代 ═════════════════════════════════════════════════
  app.get("/api/v1/projects/:projectId/iterations", async (req) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    return planningService.list(actor, projectId, "iteration");
  });
  app.post("/api/v1/projects/:projectId/iterations", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    // 统一走 service：参数校验 + 项目可见 + **权限判定** + 落库（此前内联实现漏了权限判定）
    const row = await planningService.createPlan(actor, projectId, "iteration", req.body);
    reply.status(201);
    return row;
  });
  /** 迭代容量：项目成员 × 容量（未配置显示 0）。 */
  app.get("/api/v1/iterations/:id/capacity", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const it = await planningService.get(actor, id, "iteration");
    const rows = await db.execute(sql`
      select pm.member_id::text as member_id, m.name, m.username,
             ic.capacity_points::float8 as capacity_points,
             ic.capacity_hours::float8 as capacity_hours,
             coalesce(ic.logged_points, 0)::float8 as logged_points
      from project_membership pm
      join member m on m.id = pm.member_id
      left join iteration_capacity ic on ic.iteration_id = ${id} and ic.member_id = pm.member_id
      where pm.project_id = ${it.projectId}
      order by m.name
    `) as unknown as { member_id: string; name: string; username: string; capacity_points: number | null; capacity_hours: number | null; logged_points: number }[];
    return { members: rows.map((r) => ({ memberId: r.member_id, name: r.name, username: r.username,
      capacityPoints: r.capacity_points, capacityHours: r.capacity_hours, loggedPoints: r.logged_points })) };
  });

  app.put("/api/v1/iterations/:id/capacity/:memberId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id, memberId } = z.object({ id: z.string().uuid(), memberId: z.string().uuid() }).parse(req.params);
    const it = await planningService.get(actor, id, "iteration");
    const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
    if (!can(actor, "iteration:manage", { projectId: it.projectId, teamId: null }, ctx)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    const body = z.object({
      capacityPoints: z.number().min(0).max(99999).nullable().optional(),
      capacityHours: z.number().min(0).max(999999).nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    const hasPoints = body.data.capacityPoints != null;
    const hasHours = body.data.capacityHours != null;
    if (hasPoints === hasHours) throw new DomainError("VALIDATION", "容量点数与容量小时必须二选一", null);
    const memberRows = await db.select({ memberId: projectMembership.memberId }).from(projectMembership)
      .where(eq(projectMembership.projectId, it.projectId));
    if (!memberRows.some((m) => m.memberId === memberId)) throw new DomainError("VALIDATION", "成员不属于该项目", null);
    const values = {
      iterationId: id, memberId,
      capacityPoints: body.data.capacityPoints != null ? String(body.data.capacityPoints) : null,
      capacityHours: body.data.capacityHours != null ? String(body.data.capacityHours) : null,
    };
    const [row] = await db.insert(iterationCapacity).values(values).onConflictDoUpdate({
      target: [iterationCapacity.iterationId, iterationCapacity.memberId],
      set: { capacityPoints: values.capacityPoints, capacityHours: values.capacityHours },
    }).returning();
    return { ok: true, capacity: row };
  });

  app.get("/api/v1/iterations/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.get(actor, id, "iteration");
  });
  app.patch("/api/v1/iterations/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.updatePlan(actor, id, "iteration", req.body);
  });

  // ══ 版本 ═════════════════════════════════════════════════
  app.get("/api/v1/projects/:projectId/releases", async (req) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    return planningService.list(actor, projectId, "release");
  });
  app.post("/api/v1/projects/:projectId/releases", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    // 统一走 service：参数校验 + 项目可见 + **权限判定** + 落库（此前内联实现漏了权限判定）
    const row = await planningService.createPlan(actor, projectId, "release", req.body);
    reply.status(201);
    return row;
  });
  app.get("/api/v1/releases/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.get(actor, id, "release");
  });
  app.patch("/api/v1/releases/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.updatePlan(actor, id, "release", req.body);
  });

  // ══ 模块 ═════════════════════════════════════════════════
  app.get("/api/v1/projects/:projectId/modules", async (req) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    const q = req.query as { archived?: string };
    return planningService.list(actor, projectId, "module", { includeArchived: q.archived === "true" });
  });
  app.post("/api/v1/projects/:projectId/modules", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = pidParam.parse(req.params);
    // 统一走 service：参数校验 + 项目可见 + **权限判定** + 落库（此前内联实现漏了权限判定）
    const row = await planningService.createPlan(actor, projectId, "module", req.body);
    reply.status(201);
    return row;
  });
  app.get("/api/v1/modules/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.get(actor, id, "module");
  });
  app.patch("/api/v1/modules/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    return planningService.updatePlan(actor, id, "module", req.body);
  });

  // ══ 归档 / 取消归档 ═══════════════════════════════════════
  /**
   * ⚠️ **只给有 archived_at 列的实体注册**。
   *    iteration / release 在数据模型里**没有 archived_at**（它们的生命周期靠
   *    completed_at 表达），给它们挂 /archive 只会得到一个注定 409 的端点 ——
   *    那是把「服务层不支持」暴露成「用户操作失败」，纯属设计错误。
   *    实测踩到：调用 iteration 的 archive 抛 CONFLICT。
   */
  const ARCHIVABLE = ["milestone", "module"] as const;
  for (const kind of ARCHIVABLE) {
    for (const [action, fn] of [
      ["archive", planningService.archive],
      ["unarchive", planningService.unarchive],
    ] as const) {
      app.post(`/api/v1/${kind}s/:id/${action}`, { onRequest: app.csrfProtection }, async (req) => {
        const actor = actorOf(req);
        const { id } = idParam.parse(req.params);
        await fn(actor, id, kind);
        return { ok: true };
      });
    }
  }

// ══ 第二期：我的工作台 + 个人待办（S5）═══════════════════════
app.get("/api/v1/workbench", async (req) => {
  const actor = actorOf(req);
  const { workbench: svc } = await import("../services/workbench.service.ts");
  return svc(actor);
});

app.get("/api/v1/todos", async (req) => {
  const actor = actorOf(req);
  const q = req.query as { done?: string };
  const { listTodos } = await import("../services/workbench.service.ts");
  return listTodos(actor, { done: q.done === undefined ? undefined : q.done === "true" });
});

app.post("/api/v1/todos", { onRequest: app.csrfProtection }, async (req, reply) => {
  const actor = actorOf(req);
  const parsed = z.object({
    title: z.string().min(1, "请输入标题").max(500),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const { createTodo } = await import("../services/workbench.service.ts");
  reply.status(201);
  return createTodo(actor, parsed.data);
});

app.patch("/api/v1/todos/:id", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const { id } = idParam.parse(req.params);
  const parsed = z.object({
    title: z.string().min(1).max(500).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    done: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const { updateTodo } = await import("../services/workbench.service.ts");
  return updateTodo(actor, id, parsed.data);
});

app.delete("/api/v1/todos/:id", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const { id } = idParam.parse(req.params);
  const { deleteTodo } = await import("../services/workbench.service.ts");
  await deleteTodo(actor, id);
  return { ok: true };
});


// ══ 保存视图（Spec V8）════════════════════════════════════════
app.get("/api/v1/saved-views", async (req) => {
  const actor = actorOf(req);
  const q = req.query as { projectId?: string };
  const svc = await import("../services/planning.service.ts");
  return svc.listSavedViews(actor, q.projectId);
});

app.post("/api/v1/saved-views", { onRequest: app.csrfProtection }, async (req, reply) => {
  const actor = actorOf(req);
  const parsed = createSavedViewSchema.safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const svc = await import("../services/planning.service.ts");
  reply.status(201);
  return svc.createSavedView(actor, parsed.data);
});

app.get("/api/v1/saved-views/:id", async (req) => {
  const actor = actorOf(req);
  const { id } = idParam.parse(req.params);
  const svc = await import("../services/planning.service.ts");
  return svc.getSavedView(actor, id);
});

app.patch("/api/v1/saved-views/:id", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const { id } = idParam.parse(req.params);
  const parsed = z.object({
    name: z.string().min(1).max(120).optional(),
    isPinned: z.boolean().optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    sorts: z.array(z.unknown()).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const svc = await import("../services/planning.service.ts");
  return svc.updateSavedView(actor, id, parsed.data);
});

app.post("/api/v1/saved-views/reorder", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const parsed = z.object({ ids: z.array(z.string().uuid()).max(200) }).safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const svc = await import("../services/planning.service.ts");
  await svc.reorderSavedViews(actor, parsed.data.ids);
  return { ok: true };
});

app.delete("/api/v1/saved-views/:id", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const { id } = idParam.parse(req.params);
  const svc = await import("../services/planning.service.ts");
  await svc.deleteSavedView(actor, id);
  return { ok: true };
});


// ══ 通知（文档 REST 10 节契约）═════════════════════════════════
/**
 * 列表返回体**内嵌 unreadCount**（文档明确：顶栏铃铛用它，
 * 避免前端每次事件都多打一个计数端点）。此前拆了 /unread-count
 * 独立端点，与文档不一致 —— 已收敛。
 */
app.get("/api/v1/notifications", async (req) => {
  const actor = actorOf(req);
  const q = req.query as { unread?: string };
  const svc = await import("../services/notification.service.ts");
  const items = await svc.listNotifications(actor, { unreadOnly: q.unread === "true" });
  return { items, unreadCount: await svc.countUnread(actor) };
});

/** 标记已读：可批量（{ ids: [...] }）或全部（{ all: true }）—— 文档 10 节 */
app.post("/api/v1/notifications/read", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const parsed = z.object({
    ids: z.array(z.string().uuid()).optional(),
    all: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const svc = await import("../services/notification.service.ts");
  if (parsed.data.all) {
    await svc.markAllRead(actor);
    return { ok: true };
  }
  for (const id of parsed.data.ids ?? []) await svc.markRead(actor, id);
  return { ok: true };
});

// ══ 通知偏好 + 免打扰（文档 10 节：GET / PUT /notification-preferences）═══
app.get("/api/v1/notification-preferences", async (req) => {
  const actor = actorOf(req);
  const svc = await import("../services/notification.service.ts");
  return svc.getPreferences(actor);
});

app.put("/api/v1/notification-preferences", { onRequest: app.csrfProtection }, async (req) => {
  const actor = actorOf(req);
  const parsed = z.object({
    categoryPrefs: z.record(z.string(), z.object({ inApp: z.boolean().optional(), email: z.boolean().optional() })).optional(),
    dndStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    dndEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    dndTimezone: z.string().max(64).optional(),
    digestFrequency: z.enum(["OFF", "DAILY", "WEEKLY"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const svc = await import("../services/notification.service.ts");
  await svc.updatePreferences(actor, parsed.data);
  return svc.getPreferences(actor);
});

// ══ 全局搜索（W4，REST 7e）════════════════════════════════════
app.get("/api/v1/search", async (req) => {
  const actor = actorOf(req);
  const q = req.query as { q?: string; type?: string; limit?: string };
  const svc = await import("../services/search.service.ts");
  return svc.search(actor, q.q ?? "", {
    type: q.type,
    limit: q.limit ? Number(q.limit) : undefined,
  });
});

}
