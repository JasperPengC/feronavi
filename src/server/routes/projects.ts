/** 项目路由（R4）—— 薄层：解析入参、调服务、序列化 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import {
  createProjectSchema, updateProjectSchema, transitionProjectStatusSchema, listProjectsQuerySchema,
} from "../../shared/schemas/project.ts";
import * as projectService from "../services/project.service.ts";
import * as projectRepo from "../repos/project.repo.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { recordBusinessEvent } from "../services/event-log.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  // 项目级动作走 scope-aware 判定（Round 75：不再直接用权限并集）
  const canProject = (actor: Actor, action: string, projectId: string): boolean => {
    const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
    return can(actor, action, { projectId, teamId: null }, ctx);
  };

  // ── 列表（按数据范围过滤）──────────────────────────────────
  app.get("/api/v1/projects", async (req) => {
    const actor = actorOf(req);
    const q = listProjectsQuerySchema.parse(req.query);
    const hasOrg = actor.grants.some((g) => g.scopeType === "ORG");
    const { rows, total } = await projectRepo.listVisible(actor.memberId, hasOrg, {
      page: q.page, pageSize: q.pageSize, archived: q.archived === "true",
    });
    // 一次查回全部项目的工作项数（列表页 20 个项目不能发 20 次请求）
    const counts = await projectRepo.countWorkItemsByProject(rows.map((r) => String(r.id)));
    const insights = await projectService.projectInsights(rows.map((r) => String(r.id)));
    return {
      items: rows.map((r) => ({
        id: r.id, key: r.key, name: r.name, description: r.description,
        status: r.status_key ? { key: r.status_key, name: r.status_name, category: r.status_category, color: r.status_color } : null,
        archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
        // 负责人（第 25 轮）：没有负责人时为 null —— **不编造**、不用创建人顶替
        lead: r.lead_name ? { id: String(r.lead_member_id), name: String(r.lead_name) } : null,
        departmentId: r.department_id ?? null,
        departmentName: r.department_name ?? null,
        workItemCount: counts.get(String(r.id)) ?? 0,
        insights: insights.get(String(r.id)) ?? null,
      })),
      page: q.page, pageSize: q.pageSize, total,
    };
  });

  // ── 建项目（同事务复制工作流模板）──────────────────────────
  /**
   * 项目成员（文档 REST 第 4 节 line 136）。
   * ⚠️ 此前只有 MCP 工具与服务层，**REST 端点一直没实现** —— 而界面上的"指派给谁""给谁授页面权限"
   * 都需要它（人名 → ID 的唯一途径）。本次补齐只读的 GET；POST（加成员 + 项目级角色）留待后续。
   */
  app.get("/api/v1/projects/:id/members", async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("VALIDATION", "项目 ID 不合法", null);
    return { members: await projectService.membersOf(actor, id) };
  });

  app.post("/api/v1/projects/:id/members", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("VALIDATION", "项目 ID 不合法", null);
    const parsed = z.object({
      memberId: z.string().uuid(),
      roleId: z.string().uuid().optional(),
      roleIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    }).refine((v) => !!v.roleId || !!v.roleIds?.length, { message: "至少选择一个角色" }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { addProjectMember } = await import("../services/project-member.service.ts");
    reply.status(201);
    return addProjectMember(actor, id, parsed.data);
  });

  app.delete("/api/v1/projects/:id/members/:memberId", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id, memberId } = req.params as { id: string; memberId: string };
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(memberId)) {
      throw new DomainError("VALIDATION", "项目或成员 ID 不合法", null);
    }
    const { removeProjectMember } = await import("../services/project-member.service.ts");
    await removeProjectMember(actor, id, memberId);
    return { ok: true };
  });

  app.post("/api/v1/projects", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const created = await projectService.createProject(actor, parsed.data);
    reply.status(201);
    return created;
  });

  // ── 详情 ──────────────────────────────────────────────────
  app.get("/api/v1/projects/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    return projectService.getProjectDetail(actor, id);
  });

  // ── 更新（刻意不接受 key，A45）─────────────────────────────
  app.patch("/api/v1/projects/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    // strict() 让传 key 的请求直接 400，而不是被静默忽略
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法（项目标识创建后不可修改）", parsed.error.issues);

    const visible = await projectRepo.isVisibleTo(actor.memberId, id, actor.grants.some((g) => g.scopeType === "ORG"));
    if (!visible) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    if (!canProject(actor, "project:update", id)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    await projectService.assertDepartmentActive(parsed.data.departmentId);

    const row = await projectRepo.update(id, parsed.data);
    if (!row) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    await recordBusinessEvent({
      actor, action: "project.updated", targetType: "PROJECT", targetId: id, projectId: id,
      summary: `${actor.name} 更新了项目「${row.name}」`,
    });
    return { ok: true };
  });

  // ── 归档 / 取消归档 ───────────────────────────────────────
  for (const [path, flag] of [["archive", true], ["unarchive", false]] as const) {
    app.post(`/api/v1/projects/:id/${path}`, { onRequest: app.csrfProtection }, async (req) => {
      const actor = actorOf(req);
      const { id } = req.params as { id: string };
      const visible = await projectRepo.isVisibleTo(actor.memberId, id, actor.grants.some((g) => g.scopeType === "ORG"));
      if (!visible) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
      if (!canProject(actor, "project:archive", id)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
      const row = await projectRepo.setArchived(id, flag);
      if (!row) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
      await recordBusinessEvent({
        actor, action: flag ? "project.archived" : "project.unarchived",
        targetType: "PROJECT", targetId: id, projectId: id,
        summary: `${actor.name} ${flag ? "归档" : "取消归档"}了项目「${row.name}」`,
      });
      return { ok: true };
    });
  }

  app.get("/api/v1/project-statuses", async (req) => {
    actorOf(req);
    const rows = await projectRepo.listStatusDefs();
    return rows.map((s) => ({ key: s.key, name: s.name, category: s.category, color: s.color }));
  });

  // ── 项目状态流转（按 category 机械推导）────────────────────
  app.post("/api/v1/projects/:id/status", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = req.params as { id: string };
    if (!canProject(actor, "project:manage_status", id)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    const parsed = transitionProjectStatusSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);

    const p = await projectRepo.findById(id);
    if (!p) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    const target = await projectRepo.findStatusByKey(parsed.data.statusKey);
    if (!target) throw new DomainError("VALIDATION", `未知的项目状态「${parsed.data.statusKey}」`, null);

    // 数据模型 2.2 的流转规则：按 category 机械推导
    const cur = p.statusId ? (await projectRepo.listStatusDefs()).find((s) => s.id === p.statusId) : null;
    const from = cur?.category ?? "NOT_STARTED";
    const allowed =
      from === "NOT_STARTED" ? (target.category === "IN_PROGRESS" || target.key === "CANCELLED")
      : from === "IN_PROGRESS" ? target.category !== "NOT_STARTED"
      : /* TERMINAL */ target.category === "IN_PROGRESS";
    if (!allowed) {
      throw new DomainError("VALIDATION", `不允许从「${cur?.name ?? "未开始"}」流转到「${target.name}」`, null);
    }

    await projectRepo.setStatus(id, target.id);
    await recordBusinessEvent({
      actor, action: "project.status_changed", targetType: "PROJECT", targetId: id, projectId: id,
      summary: `${actor.name} 把项目「${p.name}」状态改为「${target.name}」`,
    });
    return { ok: true };
  });
}
