/**
 * 项目集与组合（第十一期，数据模型第 1477 行登记表 + 3.1/8.1 P3 承诺）
 *
 * 规范给的范围边界很清楚：**只做「分组 + 汇总视图」，不做跨项目依赖**。
 * 权限沿用既有动作 `project:create`（权限动作清单已定稿，无 `portfolio:*`，
 * 不擅自新增动作 —— 已在 REST 清单与登记表留痕）。
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { activityEntry, milestone, portfolio, portfolioProject, project, projectStatusDef, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { writeSecurityAudit } from "./audit.service.ts";

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
function assertCanManage(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  // 项目集是组织级分组：无项目资源 + 非 _own → 需 ORG 档（第七期 A1 修法刻意不放宽组织级动作）
  if (!can(actor, "project:create", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

/** 汇总口径：项目数 + 活跃工作项数（只读，按调用者的数据范围过滤） */
async function summarize(actor: Actor, portfolioIds: string[]) {
  if (portfolioIds.length === 0) return new Map<string, { projectCount: number; workItemCount: number }>();
  const links = await db.select().from(portfolioProject).where(inArray(portfolioProject.portfolioId, portfolioIds));
  const visible = new Set<string>();
  for (const l of links) {
    if (await projectRepo.isVisibleTo(actor.memberId, l.projectId, hasOrg(actor))) visible.add(l.projectId);
  }
  const counts = new Map<string, { projectCount: number; workItemCount: number }>();
  const wiCounts = visible.size
    ? await db.select({ projectId: workItem.projectId, n: sql<number>`count(*)::int` })
        .from(workItem).where(and(inArray(workItem.projectId, [...visible]), isNull(workItem.deletedAt)))
        .groupBy(workItem.projectId)
    : [];
  const wiByProject = new Map(wiCounts.map((w) => [w.projectId, w.n]));
  for (const id of portfolioIds) {
    const mine = links.filter((l) => l.portfolioId === id && visible.has(l.projectId));
    counts.set(id, {
      projectCount: mine.length,
      workItemCount: mine.reduce((sum, l) => sum + (wiByProject.get(l.projectId) ?? 0), 0),
    });
  }
  return counts;
}

export async function listPortfolios(actor: Actor) {
  const rows = await db.select().from(portfolio).orderBy(asc(portfolio.createdAt));
  const sums = await summarize(actor, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, ...(sums.get(r.id) ?? { projectCount: 0, workItemCount: 0 }) }));
}

export async function createPortfolio(actor: Actor, input: { name: string }) {
  assertCanManage(actor);
  const [row] = await db.insert(portfolio).values({ name: input.name, ownerId: actor.memberId }).returning();
  await writeSecurityAudit({
    actorId: actor.memberId, actorSnapshot: actor.username,
    action: "portfolio.created", targetType: "PORTFOLIO", targetId: row!.id,
  });
  return { ...row!, projectCount: 0, workItemCount: 0 };
}

async function loadPortfolio(id: string) {
  const p = (await db.select().from(portfolio).where(eq(portfolio.id, id)).limit(1))[0];
  if (!p) throw new DomainError("NOT_FOUND", "项目集不存在", null);
  return p;
}

export async function getPortfolio(actor: Actor, id: string) {
  const p = await loadPortfolio(id);
  const links = await db.select().from(portfolioProject).where(eq(portfolioProject.portfolioId, id));
  const projects = [];
  for (const l of links) {
    // 只列出调用者可见的项目（汇总视图也不能越权）
    if (!(await projectRepo.isVisibleTo(actor.memberId, l.projectId, hasOrg(actor)))) continue;
    const pr = (await db.select({ id: project.id, key: project.key, name: project.name }).from(project)
      .where(eq(project.id, l.projectId)).limit(1))[0];
    if (pr) projects.push(pr);
  }
  const sums = await summarize(actor, [id]);
  // ⚠️ 计数与项目列表不能同名：早先都叫 projects，展开时后者把前者覆盖掉（TS 也会报重复属性）
  return { ...p, projects, ...(sums.get(id) ?? { projectCount: 0, workItemCount: 0 }) };
}

export async function updatePortfolio(actor: Actor, id: string, patch: { name?: string }) {
  assertCanManage(actor);
  await loadPortfolio(id);
  const [row] = await db.update(portfolio).set(patch).where(eq(portfolio.id, id)).returning();
  await writeSecurityAudit({
    actorId: actor.memberId, actorSnapshot: actor.username,
    action: "portfolio.updated", targetType: "PORTFOLIO", targetId: id,
  });
  return row;
}

export async function deletePortfolio(actor: Actor, id: string): Promise<void> {
  assertCanManage(actor);
  await loadPortfolio(id);
  await db.delete(portfolio).where(eq(portfolio.id, id));
  await writeSecurityAudit({
    actorId: actor.memberId, actorSnapshot: actor.username,
    action: "portfolio.deleted", targetType: "PORTFOLIO", targetId: id,
  });
}

export async function addProject(actor: Actor, portfolioId: string, projectId: string) {
  assertCanManage(actor);
  await loadPortfolio(portfolioId);
  if (!(await projectRepo.findById(projectId))) throw new DomainError("NOT_FOUND", "项目不存在", null);
  await db.insert(portfolioProject).values({ portfolioId, projectId }).onConflictDoNothing();
  await writeSecurityAudit({
    actorId: actor.memberId, actorSnapshot: actor.username,
    action: "portfolio.project_added", targetType: "PORTFOLIO", targetId: portfolioId,
    changes: { projectId },
  });
  return { ok: true };
}

export async function removeProject(actor: Actor, portfolioId: string, projectId: string) {
  assertCanManage(actor);
  await loadPortfolio(portfolioId);
  await db.delete(portfolioProject).where(and(
    eq(portfolioProject.portfolioId, portfolioId), eq(portfolioProject.projectId, projectId),
  ));
  await writeSecurityAudit({
    actorId: actor.memberId, actorSnapshot: actor.username,
    action: "portfolio.project_removed", targetType: "PORTFOLIO", targetId: portfolioId,
    changes: { projectId },
  });
  return { ok: true };
}

/**
 * 项目集高级汇总（P1-5）：项目进度、风险、里程碑与最近活动。
 * 所有项目先过 `isVisibleTo`，不可见项目直接排除，不泄露项目名。
 */
export async function getSummary(actor: Actor, id: string) {
  const p = await loadPortfolio(id);
  const links = await db.select().from(portfolioProject).where(eq(portfolioProject.portfolioId, id));
  const visibleIds: string[] = [];
  for (const l of links) {
    if (await projectRepo.isVisibleTo(actor.memberId, l.projectId, hasOrg(actor))) visibleIds.push(l.projectId);
  }
  const { projectInsights } = await import("./project.service.ts");
  const visible = visibleIds.length ? await db.select({
    id: project.id, key: project.key, name: project.name,
    status: { key: projectStatusDef.key, name: projectStatusDef.name, category: projectStatusDef.category },
  }).from(project).leftJoin(projectStatusDef, eq(projectStatusDef.id, project.statusId))
    .where(and(inArray(project.id, visibleIds), isNull(project.archivedAt))) : [];
  const insights = await projectInsights(visible.map((x) => x.id));
  const { sql: pgsql } = await import("../../db/index.ts");
  const counts = visibleIds.length ? await pgsql<{ project_id: string; total: number; done: number; overdue: number }[]>`
    select w.project_id,
      count(*)::int as total,
      count(*) filter (where s.category in ('DONE','TERMINAL'))::int as done,
      count(*) filter (where w.due_date < current_date and s.category not in ('DONE','CANCELLED','TERMINAL'))::int as overdue
    from work_item w join workflow_state s on s.id = w.status_id
    where w.deleted_at is null and w.project_id in ${pgsql(visibleIds)}
    group by w.project_id
  ` : [];
  const byProject = new Map(counts.map((c) => [c.project_id, c]));
  const milestones = visibleIds.length ? await db.select({
    id: milestone.id, projectId: milestone.projectId, name: milestone.name,
    dueDate: milestone.dueDate, completedAt: milestone.completedAt, archivedAt: milestone.archivedAt,
  }).from(milestone).where(and(inArray(milestone.projectId, visibleIds), isNull(milestone.archivedAt))).orderBy(asc(milestone.dueDate)) : [];
  const activity = visibleIds.length ? await db.select({
    id: activityEntry.id, projectId: activityEntry.projectId, summary: activityEntry.summary,
    createdAt: activityEntry.createdAt,
  }).from(activityEntry).where(inArray(activityEntry.projectId, visibleIds)).orderBy(desc(activityEntry.createdAt)).limit(8) : [];
  const projectName = new Map(visible.map((x) => [x.id, x.name]));
  const projects = visible.map((x) => {
    const c = byProject.get(x.id);
    const total = c?.total ?? 0;
    const done = c?.done ?? 0;
    return {
      ...x,
      id: x.id, key: x.key, name: x.name,
      status: x.status, total, done, overdue: c?.overdue ?? 0,
      progress: total === 0 ? 0 : Math.round((done / total) * 100),
      insights: insights.get(x.id) ?? null,
    };
  });
  const risks = projects.flatMap((x) => {
    const i = x.insights; if (!i) return [];
    const out: { projectId: string; projectName: string; type: string; count: number }[] = [];
    if (i.overdueWorkItems > 0) out.push({ projectId: x.id, projectName: x.name, type: "OVERDUE_ITEM", count: i.overdueWorkItems });
    if (i.overdueMilestones > 0) out.push({ projectId: x.id, projectName: x.name, type: "OVERDUE_MILESTONE", count: i.overdueMilestones });
    if (i.urgentDefects > 0) out.push({ projectId: x.id, projectName: x.name, type: "URGENT_DEFECT", count: i.urgentDefects });
    return out;
  });
  return {
    portfolio: { id: p.id, name: p.name, createdAt: p.createdAt },
    projects,
    totals: {
      projectCount: projects.length,
      workItemCount: projects.reduce((n, x) => n + x.total, 0),
      doneCount: projects.reduce((n, x) => n + x.done, 0),
      overdueCount: projects.reduce((n, x) => n + x.overdue, 0),
      completionPercent: (() => { const t = projects.reduce((n, x) => n + x.total, 0); const d = projects.reduce((n, x) => n + x.done, 0); return t === 0 ? 0 : Math.round((d / t) * 100); })(),
    },
    risks,
    milestones: milestones.map((m) => ({ ...m, projectName: projectName.get(m.projectId) ?? "" })),
    activity: activity.map((a) => ({ ...a, projectName: projectName.get(a.projectId ?? "") ?? "" })),
  };
}
