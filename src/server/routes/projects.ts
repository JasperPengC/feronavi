/** 项目路由（R4）—— 薄层：解析入参、调服务、序列化 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import {
  createProjectSchema, listProjectsQuerySchema,
} from "../../shared/schemas/project.ts";
import * as projectService from "../services/project.service.ts";
import * as projectRepo from "../repos/project.repo.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
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
    await projectService.updateProject(actor, id, req.body);
    return { ok: true };
  });

  // ── 归档 / 取消归档 ───────────────────────────────────────
  for (const [path, flag] of [["archive", true], ["unarchive", false]] as const) {
    app.post(`/api/v1/projects/:id/${path}`, { onRequest: app.csrfProtection }, async (req) => {
      const actor = actorOf(req);
      const { id } = req.params as { id: string };
      await projectService.setArchived(actor, id, flag);
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
    await projectService.transitionProjectStatus(actor, id, req.body);
    return { ok: true };
  });
}
