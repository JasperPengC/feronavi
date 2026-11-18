/**
 * 项目领域服务
 *
 * 最要紧的一条：**建项目与复制工作流模板必须在同一事务**（数据模型 3.2）。
 * 规范原话：「绝不允许出现『项目建好了但没有工作流』」——那会让新项目建不出工作项，
 * 而且用户看不出原因（界面只显示"创建成功"）。
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, sql } from "../../db/index.ts";
import { and as _and, eq as _eq, inArray } from "drizzle-orm";
import { department, project, workflow, workflowState, workflowTransition, projectMembership, role } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { CreateProjectInput } from "../../shared/schemas/project.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { recordBusinessEvent } from "./event-log.ts";

/** 项目可见性判定用的上下文（ORG 档直接全可见） */
function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

/**
 * 建项目。
 *
 * 事务内依次：建项目 → 复制工作流模板（workflow → workflow_state → workflow_transition）。
 * 任一步失败整体回滚。
 */
/** 归属部门校验（Round 72）：必须存在且未归档；null 合法（= 未归属） */
export async function assertDepartmentActive(departmentId: string | null | undefined): Promise<void> {
  if (!departmentId) return;
  const [d] = await db.select({ id: department.id }).from(department)
    .where(and(eq(department.id, departmentId), isNull(department.archivedAt))).limit(1);
  if (!d) throw new DomainError("VALIDATION", "归属部门不存在或已归档", null);
}

export async function createProject(
  actor: Actor,
  input: CreateProjectInput,
): Promise<{ id: string; key: string }> {
  await assertDepartmentActive(input.departmentId);
  // 权限：project:create。此时还没有项目，用组织级资源判定范围
  const ctx: PermissionContext = {
    memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
  };
  if (!can(actor, "project:create", { projectId: null, teamId: null }, ctx)) {
    throw forbidden();
  }

  const existing = await projectRepo.findByKey(input.key);
  if (existing) throw new DomainError("CONFLICT", `项目标识 ${input.key} 已被占用`, null);

  const plannedStatus = await projectRepo.findStatusByKey("PLANNED");

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(project).values({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      statusId: plannedStatus?.id ?? null,
      createdBy: actor.memberId,
      departmentId: input.departmentId ?? null,
    }).returning({ id: project.id, key: project.key });

    const projectId = created!.id;

    // ── 复制工作流模板（同一事务，不可跳过）──────────────────
    const templates = await tx.select().from(workflow)
      .where(and(isNull(workflow.projectId), eq(workflow.isBuiltin, true)));

    const chosen = input.template
      ? templates.filter((t) => t.appliesToType === input.template || t.name === input.template)
      : templates;
    if (chosen.length === 0) {
      throw new DomainError("VALIDATION", `找不到工作流模板「${input.template}」`, null);
    }

    for (const tpl of chosen) {
      const [newWf] = await tx.insert(workflow).values({
        projectId,
        name: tpl.name,
        appliesToType: tpl.appliesToType,
        isDefault: true,          // 每种类型在项目内恰好一个默认（部分唯一索引约束）
        isBuiltin: false,         // 副本不是内置模板，可被修改
      }).returning({ id: workflow.id });

      const srcStates = await tx.select().from(workflowState)
        .where(eq(workflowState.workflowId, tpl.id));

      // key 与 category **原样保留**：MCP meta.workflow 与前端枚举依赖跨项目一致的 key，
      // 而终态判定依赖 category（C-3）
      const idMap = new Map<string, string>();
      for (const s of srcStates) {
        const [ns] = await tx.insert(workflowState).values({
          workflowId: newWf!.id,
          key: s.key,
          name: s.name,
          category: s.category,
          color: s.color,
          sortOrder: s.sortOrder,
        }).returning({ id: workflowState.id });
        idMap.set(s.id, ns!.id);
      }

      const srcEdges = await tx.select().from(workflowTransition)
        .where(eq(workflowTransition.workflowId, tpl.id));
      for (const e of srcEdges) {
        const from = idMap.get(e.fromStateId), to = idMap.get(e.toStateId);
        if (!from || !to) continue;   // 模板数据不完整时跳过，不因单条坏边整体失败
        await tx.insert(workflowTransition).values({
          workflowId: newWf!.id,
          fromStateId: from,
          toStateId: to,
          allowedRoleIds: e.allowedRoleIds,
          requiredFields: e.requiredFields,
          label: e.label,
          sortOrder: e.sortOrder,
        });
      }
    }

    /**
     * 建项目的人自动成为项目成员。
     *
     * ⚠️ 为什么必须做：`PROJECT` 档数据范围的一条回落路径是「我是 project_membership 成员」。
     *    不建这条关系，创建者自己都会在列表里看不到刚建的项目。
     *
     * ⚠️ 规范缺口：数据模型没写「创建者自动入组时用哪个项目级角色」。
     *    这里用 ADMIN（项目级），理由是他的组织级角色已允许他建项目，
     *    项目内不应反而降权。已补进规范 2.3 节。
     */
    const [adminRole] = await tx.select({ id: role.id }).from(role)
      .where(eq(role.key, "ADMIN")).limit(1);
    if (adminRole) {
      await tx.insert(projectMembership).values({
        projectId, memberId: actor.memberId, roleId: adminRole.id,
      });
    }

    return { id: projectId, key: created!.key };
  });
  await recordBusinessEvent({
    actor, action: "project.created", targetType: "PROJECT", targetId: result.id, projectId: result.id,
    summary: `${actor.name} 创建了项目 ${result.key} · ${input.name}`,
  });
  return result;
}

/** 项目详情（含状态定义与本项目的工作流副本） */
export async function getProjectDetail(actor: Actor, projectId: string) {
  const visible = await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor));
  if (!visible) throw forbidden();      // 不可见与不存在同形
  const p = await projectRepo.findById(projectId);
  if (!p) throw forbidden();

  const statuses = await projectRepo.listStatusDefs();
  const wfs = await db.select().from(workflow).where(eq(workflow.projectId, projectId));
  const states = wfs.length
    ? await db.select().from(workflowState).where(
        wfs.length === 1
          ? eq(workflowState.workflowId, wfs[0]!.id)
          : inArray(workflowState.workflowId, wfs.map((w) => w.id)))
    : [];

  const dept = p.departmentId
    ? (await db.select({ id: department.id, name: department.name }).from(department).where(eq(department.id, p.departmentId)).limit(1))[0] ?? null
    : null;
  return {
    id: p.id, key: p.key, name: p.name, description: p.description,
    departmentId: p.departmentId, department: dept,
    archivedAt: p.archivedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
    statusDefs: statuses.map((s) => ({ key: s.key, name: s.name, category: s.category, color: s.color })),
    workflows: wfs.map((w) => ({
      id: w.id, name: w.name, appliesToType: w.appliesToType, isDefault: w.isDefault,
      states: states.filter((s) => s.workflowId === w.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({ key: s.key, name: s.name, category: s.category, color: s.color })),
    })),
  };
}


/**
 * 可见项目列表（第六期：MCP `project.list` 等工具的读路径）
 * 与 REST 列表同一口径：ORG 档全可见，否则只看成员关系/项目指派。
 */
export async function listVisibleFor(
  actor: Actor,
  opts: { page?: number; pageSize?: number; archived?: boolean } = {},
) {
  const hasOrg = actor.grants.some((g) => g.scopeType === "ORG");
  const { rows, total } = await projectRepo.listVisible(actor.memberId, hasOrg, {
    page: opts.page ?? 1,
    pageSize: Math.min(100, opts.pageSize ?? 50),
    archived: opts.archived ?? false,
  });
  const counts = await projectRepo.countWorkItemsByProject(rows.map((r) => String(r.id)));
  return {
    items: rows.map((r) => ({
      id: r.id, key: r.key, name: r.name,
      status: r.status_key ? { key: r.status_key, name: r.status_name, category: r.status_category } : null,
      workItemCount: counts.get(String(r.id)) ?? 0,
    })),
    total,
  };
}

/** 项目成员（含项目级角色）：MCP `project.members` —— 规范称这是「人名 → ID 的唯一途径」 */
export async function membersOf(actor: Actor, projectId: string) {
  const hasOrg = actor.grants.some((g) => g.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg))) throw forbidden();
  // ⚠️ 项目成员有**两个来源**，只查 membership 会漏掉"被项目档角色指派的人"——
  //    实测踩到：导入的用户映射校验用的是本函数，合法成员被判成"不属于该项目"；
  //    同时第六期 MCP 的 project.members（规范称"人名 → ID 的唯一途径"）也会漏报。
  // 注意：这里的 sql 是 postgres.js 客户端，直接 await 即可（不要套 db.execute）
  return (await sql`
    select distinct on (m.id) m.id, m.username, m.name, r.key as role_key, r.name as role_name
    from (
      select pm.member_id, pm.role_id from project_membership pm where pm.project_id = ${projectId}
      union
      select ra.member_id, ra.role_id from role_assignment ra
        where ra.scope_type = 'PROJECT' and ra.scope_id = ${projectId}
    ) src
    join member m on m.id = src.member_id
    left join role r on r.id = src.role_id
    where m.status = 'ACTIVE' and m.anonymized_at is null
    order by m.id, m.name
  `) as unknown as { id: string; username: string; name: string; role_key: string | null; role_name: string | null }[];
}

/** 项目风险信号（Round 83 · 对标 YouQu 项目卡）：逾期里程碑/逾期工作项/高优缺陷/最近活动/成员数，全部真实聚合 */
export interface ProjectInsight {
  overdueMilestones: number;
  overdueWorkItems: number;
  urgentDefects: number;
  lastActivityAt: string | null;
  memberCount: number;
}

export async function projectInsights(projectIds: string[]): Promise<Map<string, ProjectInsight>> {
  if (projectIds.length === 0) return new Map();
  const { sql: pgsql } = await import("../../db/index.ts");
  const rows = await pgsql<{
    id: string; overdue_milestones: number; overdue_work_items: number; urgent_defects: number;
    last_activity_at: Date | null; member_count: number;
  }[]>`
    select p.id,
      (select count(*)::int from milestone m
        where m.project_id = p.id and m.due_date < current_date and m.completed_at is null and m.archived_at is null) as overdue_milestones,
      (select count(*)::int from work_item w join workflow_state s on s.id = w.status_id
        where w.project_id = p.id and w.deleted_at is null and w.due_date < current_date
          and s.category not in ('DONE','CANCELLED','TERMINAL')) as overdue_work_items,
      (select count(*)::int from work_item w join workflow_state s on s.id = w.status_id
        where w.project_id = p.id and w.deleted_at is null and w.type = 'DEFECT'
          and w.severity in ('S1','S2') and s.category not in ('DONE','CANCELLED','TERMINAL')) as urgent_defects,
      (select max(a.created_at) from activity_entry a where a.project_id = p.id) as last_activity_at,
      (select count(*)::int from project_membership pm where pm.project_id = p.id) as member_count
    from project p where p.id in ${pgsql(projectIds)}
  `;
  return new Map(rows.map((r) => [String(r.id), {
    overdueMilestones: Number(r.overdue_milestones), overdueWorkItems: Number(r.overdue_work_items),
    urgentDefects: Number(r.urgent_defects),
    lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
    memberCount: Number(r.member_count),
  }]));
}
