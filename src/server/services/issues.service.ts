/**
 * 问题追踪（Round 64 · 对标 YouQu「问题追踪」P1）
 *
 * 复用工作项（type=DEFECT）与工作流状态，不另建 Bug 表：
 *   · 统计卡：总登记 / 未完成 / 未完成 S1 / 逾期 / 处理率（真实聚合，非前端自造）
 *   · 列表：状态分类、严重度、优先级、关键字过滤 + 分页（join 状态名/分类与指派人名）
 *   · 处理进展：结构化 summary/nextSteps/blockers，写入项目活动
 * 权限与工作项一致：列表要求项目可见；处理进展 = 作者/指派人本人或 work_item:update_any。
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.ts";
import { member, project, workItem, workflowState, workItemProgressUpdate } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import * as wiService from "./work-item.service.ts";
import { writeActivity } from "./audit.service.ts";

function hasOrgGrant(actor: Actor): boolean { return actor.grants.some((g) => g.scopeType === "ORG"); }
async function assertVisible(actor: Actor, projectId: string): Promise<void> {
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor)))) throw forbidden();
}
// 用服务器本地时区的自然日（自托管部署的本地时区即团队时区）；
// toISOString() 是 UTC，东八区 0-8 点会把「逾期」判断整体偏移一天
function today(): string { return new Date().toLocaleDateString("en-CA"); }
/** 趋势子查询的可见范围（与列表同一套 project 过滤；work_item 别名 w） */
function scopeFor(projectId: string) {
  return sql`w.project_id = ${projectId}`;
}
/** 跨项目时趋势子查询的可见范围（project ids 经参数化 UUID 列表） */
function scopeForIds(ids: string[]) {
  return sql`w.project_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
}

/** 当前 actor 可见项目 id（与项目列表同一可见性口径；跨项目问题总览用） */
async function visibleProjectIds(actor: Actor): Promise<string[]> {
  const visible = await projectRepo.listVisible(actor.memberId, hasOrgGrant(actor), { page: 1, pageSize: 500, archived: false });
  return visible.rows.map((r) => String(r.id));
}

function emptyStats() {
  return {
    total: 0, open: 0, done: 0, cancelled: 0, p0: 0, overdue: 0, donePercent: 0,
    trend: [] as { date: string; created: number; resolved: number }[],
    severity: { S1: 0, S2: 0, S3: 0, S4: 0, none: 0 } as Record<string, number>,
  };
}

/** 跨项目问题统计（可见项目聚合；口径与单项目一致） */
export async function issueStatsGlobal(actor: Actor) {
  const ids = await visibleProjectIds(actor);
  if (ids.length === 0) return emptyStats();
  const base = and(inArray(workItem.projectId, ids), eq(workItem.type, "DEFECT"), isNull(workItem.deletedAt));
  const one = async (extra: SQL | undefined) => {
    const [r] = await db.select({ n: count() }).from(workItem)
      .leftJoin(workflowState, eq(workflowState.id, workItem.statusId))
      .where(and(base, extra));
    return Number(r?.n ?? 0);
  };
  const total = await one(sql`true`);
  const open = await one(notInCategories);
  const done = await one(CLOSED);
  const cancelled = await one(eq(workflowState.category, "CANCELLED"));
  const p0 = await one(and(notInCategories, eq(workItem.severity, "S1")));
  const overdue = await one(and(notInCategories, lt(workItem.dueDate, today())));
  const tz = actor.timezone ?? "Asia/Shanghai";
  const trend = await db.execute(sql`
    with days as (
      select generate_series(((now() at time zone ${tz})::date - 13), (now() at time zone ${tz})::date, interval '1 day')::date as day
    ),
    created as (
      select (w.created_at at time zone ${tz})::date as d, count(*)::int as n
      from work_item w where w.deleted_at is null and w.type = 'DEFECT' and ${scopeForIds(ids)} group by 1
    ),
    resolved as (
      select (w.completed_at at time zone ${tz})::date as d, count(*)::int as n
      from work_item w where w.deleted_at is null and w.type = 'DEFECT' and w.completed_at is not null and ${scopeForIds(ids)} group by 1
    )
    select to_char(days.day, 'MM-DD') as date, coalesce(created.n, 0)::int as created, coalesce(resolved.n, 0)::int as resolved
    from days left join created on created.d = days.day left join resolved on resolved.d = days.day
    order by days.day
  `) as unknown as { date: string; created: number; resolved: number }[];
  const severityRows = await db.select({ severity: workItem.severity, n: count() }).from(workItem)
    .where(and(inArray(workItem.projectId, ids), eq(workItem.type, "DEFECT"), isNull(workItem.deletedAt)))
    .groupBy(workItem.severity);
  const severity = { S1: 0, S2: 0, S3: 0, S4: 0, none: 0 } as Record<string, number>;
  for (const row of severityRows) {
    const key = row.severity ?? "none";
    severity[key] = (severity[key] ?? 0) + Number(row.n);
  }
  return {
    total, open, done, cancelled, p0, overdue,
    donePercent: total > 0 ? Math.round((done / total) * 100) : 0,
    trend, severity,
  };
}

/** 跨项目问题导出（全量匹配，不分页；CSV 由统一导出工具生成） */
export async function exportIssuesCsv(actor: Actor, f: IssueFilters = {}): Promise<{ csv: string; count: number }> {
  const ids = await visibleProjectIds(actor);
  if (f.projectId) {
    if (!ids.includes(f.projectId)) throw forbidden();
    ids.splice(0, ids.length, f.projectId);
  }
  if (ids.length === 0) return { csv: "", count: 0 };
  const conds = [inArray(workItem.projectId, ids), eq(workItem.type, "DEFECT"), isNull(workItem.deletedAt)];
  if (f.statusCategory === "OPEN") conds.push(notInCategories);
  else if (f.statusCategory === "DONE") conds.push(CLOSED);
  else if (f.statusCategory === "CANCELLED") conds.push(eq(workflowState.category, "CANCELLED"));
  if (f.severity) conds.push(eq(workItem.severity, f.severity));
  if (f.priority) conds.push(eq(workItem.priority, f.priority));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(workItem.title, q), ilike(workItem.key, q))!);
  }
  const qcExport = quickCond(actor, f.quick);
  if (qcExport) conds.push(qcExport);
  const reporterE = alias(member, "reporter");
  const rows = await db.select({
    key: workItem.key, title: workItem.title, type: workItem.type,
    severity: workItem.severity, priority: workItem.priority,
    statusName: workflowState.name, assigneeName: member.name, reporterName: reporterE.name, dueDate: workItem.dueDate,
    projectKey: project.key, projectName: project.name,
  }).from(workItem)
    .leftJoin(workflowState, eq(workflowState.id, workItem.statusId))
    .leftJoin(member, eq(member.id, workItem.assigneeId))
    .leftJoin(reporterE, eq(reporterE.id, workItem.reporterId))
    .innerJoin(project, eq(project.id, workItem.projectId))
    .where(and(...conds))
    .orderBy(project.key, workItem.key);
  const { toCsv } = await import("./export.service.ts");
  const csv = toCsv(
    ["key", "project", "type", "title", "status", "severity", "priority", "assignee", "reporter", "due_date"],
    rows.map((r) => [r.key, `${r.projectKey} · ${r.projectName}`, r.type, r.title, r.statusName ?? "", r.severity ?? "", r.priority ?? "", r.assigneeName ?? "", r.reporterName ?? "", r.dueDate ?? ""]),
  );
  return { csv, count: rows.length };
}


/** 个人快捷筛选（对标 YouQu：指派给我/我登记/我关注的/我协作的） */
function quickCond(actor: Actor, quick: IssueFilters["quick"]): SQL | undefined {
  if (!quick) return undefined;
  if (quick === "ASSIGNED") return eq(workItem.assigneeId, actor.memberId);
  if (quick === "REPORTED") return eq(workItem.reporterId, actor.memberId);
  if (quick === "WATCHING") return sql`exists (select 1 from subscription s where s.target_type = 'WORK_ITEM' and s.target_id = ${workItem.id} and s.member_id = ${actor.memberId})`;
  if (quick === "COLLABORATING") return sql`exists (select 1 from work_item_collaborator c where c.work_item_id = ${workItem.id} and c.member_id = ${actor.memberId})`;
  return undefined;
}

function sortClause(f: IssueFilters): SQL[] {
  if (f.sort === "OLDEST") return [asc(workItem.createdAt)];
  if (f.sort === "DUE") return [sql`${workItem.dueDate} asc nulls last`];
  if (f.sort === "SEVERITY") return [sql`case ${workItem.severity} when 'S1' then 1 when 'S2' then 2 when 'S3' then 3 when 'S4' then 4 else 5 end asc`, desc(workItem.createdAt)];
  return [desc(workItem.createdAt)];
}

/** 跨项目问题列表（可见项目聚合；projectId 可选过滤） */
export async function listIssuesGlobal(actor: Actor, f: IssueFilters = {}) {
  const ids = await visibleProjectIds(actor);
  if (f.projectId) {
    if (!ids.includes(f.projectId)) throw forbidden();
    ids.splice(0, ids.length, f.projectId);
  }
  if (ids.length === 0) return { items: [], total: 0, page: 1, pageSize: f.pageSize ?? 50 };
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const conds = [inArray(workItem.projectId, ids), eq(workItem.type, "DEFECT"), isNull(workItem.deletedAt)];
  if (f.statusCategory === "OPEN") conds.push(notInCategories);
  else if (f.statusCategory === "DONE") conds.push(CLOSED);
  else if (f.statusCategory === "CANCELLED") conds.push(eq(workflowState.category, "CANCELLED"));
  if (f.severity) conds.push(eq(workItem.severity, f.severity));
  if (f.priority) conds.push(eq(workItem.priority, f.priority));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(workItem.title, q), ilike(workItem.key, q))!);
  }
  const qc = quickCond(actor, f.quick);
  if (qc) conds.push(qc);
  const reporter = alias(member, "reporter");
  const where = and(...conds);
  const rows = await db.select({
    id: workItem.id, key: workItem.key, title: workItem.title, type: workItem.type,
    severity: workItem.severity, priority: workItem.priority,
    statusName: workflowState.name, statusCategory: workflowState.category,
    assigneeName: member.name, reporterName: reporter.name,
    dueDate: workItem.dueDate, createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
    projectId: project.id, projectKey: project.key, projectName: project.name,
  }).from(workItem)
    .leftJoin(workflowState, eq(workflowState.id, workItem.statusId))
    .leftJoin(member, eq(member.id, workItem.assigneeId))
    .leftJoin(reporter, eq(reporter.id, workItem.reporterId))
    .innerJoin(project, eq(project.id, workItem.projectId))
    .where(where)
    .orderBy(...sortClause(f))
    .limit(pageSize).offset((page - 1) * pageSize);
  const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(workItem)
    .leftJoin(workflowState, eq(workflowState.id, workItem.statusId)).where(where);
  return { items: rows, total: cnt[0]?.n ?? 0, page, pageSize };
}

export interface IssueFilters {
  projectId?: string;
  statusCategory?: "OPEN" | "DONE" | "CANCELLED";
  severity?: string;
  priority?: string;
  q?: string;
  quick?: "ASSIGNED" | "REPORTED" | "WATCHING" | "COLLABORATING";
  sort?: "NEWEST" | "OLDEST" | "SEVERITY" | "DUE";
  page?: number;
  pageSize?: number;
}

export async function listIssues(actor: Actor, projectId: string, f: IssueFilters = {}) {
  await assertVisible(actor, projectId);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const conds = [
    eq(workItem.projectId, projectId),
    eq(workItem.type, "DEFECT"),
    isNull(workItem.deletedAt),
  ];
  if (f.statusCategory === "OPEN") conds.push(notInCategories);
  else if (f.statusCategory === "DONE") conds.push(CLOSED);
  else if (f.statusCategory === "CANCELLED") conds.push(eq(workflowState.category, "CANCELLED"));
  if (f.severity) conds.push(eq(workItem.severity, f.severity));
  if (f.priority) conds.push(eq(workItem.priority, f.priority));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(workItem.title, q), ilike(workItem.key, q))!);
  }
  const qcProject = quickCond(actor, f.quick);
  if (qcProject) conds.push(qcProject);
  const reporterP = alias(member, "reporter");
  const where = and(...conds);
  const rows = await db.select({
    id: workItem.id, key: workItem.key, title: workItem.title, type: workItem.type,
    severity: workItem.severity, priority: workItem.priority,
    statusName: workflowState.name, statusCategory: workflowState.category,
    assigneeName: member.name, reporterName: reporterP.name,
    dueDate: workItem.dueDate, createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  }).from(workItem)
    .leftJoin(workflowState, eq(workflowState.id, workItem.statusId))
    .leftJoin(member, eq(member.id, workItem.assigneeId))
    .leftJoin(reporterP, eq(reporterP.id, workItem.reporterId))
    .where(where)
    .orderBy(...sortClause(f))
    .limit(pageSize).offset((page - 1) * pageSize);
  const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(workItem)
    .leftJoin(workflowState, eq(workflowState.id, workItem.statusId)).where(where);
  return { items: rows, total: cnt[0]?.n ?? 0, page, pageSize };
}

// 缺陷流默认用 TERMINAL 表示"已解决/已关闭"（与通用流的 DONE/CANCELLED 并存），统计两者都算关闭。
const CLOSED = sql`${workflowState.category} IN ('DONE','TERMINAL')`;
const notInCategories = sql`${workflowState.category} NOT IN ('DONE','CANCELLED','TERMINAL')`;

export async function issueStats(actor: Actor, projectId: string) {
  await assertVisible(actor, projectId);
  const base = and(eq(workItem.projectId, projectId), eq(workItem.type, "DEFECT"), isNull(workItem.deletedAt));
  const one = async (extra: SQL | undefined) => {
    const [r] = await db.select({ n: count() }).from(workItem)
      .leftJoin(workflowState, eq(workflowState.id, workItem.statusId))
      .where(and(base, extra));
    return Number(r?.n ?? 0);
  };
  const total = await one(sql`true`);
  const open = await one(notInCategories);
  const done = await one(CLOSED);
  const cancelled = await one(eq(workflowState.category, "CANCELLED"));
  const p0 = await one(and(notInCategories, eq(workItem.severity, "S1")));
  const overdue = await one(and(notInCategories, lt(workItem.dueDate, today())));
  // 近 14 天趋势（新增/关闭）：按 actor 时区切日，PG 侧生成完整日期序列（缺数据补 0）
  const tz = actor.timezone ?? "Asia/Shanghai";
  const trend = await db.execute(sql`
    with days as (
      select generate_series(
        ((now() at time zone ${tz})::date - 13),
        (now() at time zone ${tz})::date,
        interval '1 day'
      )::date as day
    ),
    created as (
      select (w.created_at at time zone ${tz})::date as d, count(*)::int as n
      from work_item w
      where w.deleted_at is null and w.type = 'DEFECT' and ${scopeFor(projectId)}
      group by 1
    ),
    resolved as (
      select (w.completed_at at time zone ${tz})::date as d, count(*)::int as n
      from work_item w
      where w.deleted_at is null and w.type = 'DEFECT' and w.completed_at is not null and ${scopeFor(projectId)}
      group by 1
    )
    select to_char(days.day, 'MM-DD') as date,
           coalesce(created.n, 0)::int as created,
           coalesce(resolved.n, 0)::int as resolved
    from days
    left join created on created.d = days.day
    left join resolved on resolved.d = days.day
    order by days.day
  `) as unknown as { date: string; created: number; resolved: number }[];
  const severityRows = await db.select({
    severity: workItem.severity, n: count(),
  }).from(workItem).where(and(
    eq(workItem.projectId, projectId), eq(workItem.type, "DEFECT"), isNull(workItem.deletedAt),
  )).groupBy(workItem.severity);
  const severity = { S1: 0, S2: 0, S3: 0, S4: 0, none: 0 } as Record<string, number>;
  for (const row of severityRows) {
    const key = row.severity ?? "none";
    severity[key] = (severity[key] ?? 0) + Number(row.n);
  }
  return {
    total, open, done, cancelled, p0, overdue,
    donePercent: total > 0 ? Math.round((done / total) * 100) : 0,
    trend, severity,
  };
}

export async function listProgressUpdates(actor: Actor, workItemId: string) {
  await wiService.getWorkItem(actor, workItemId);   // 可见性校验（不存在与无权同形）
  const rows = await db.select({
    id: workItemProgressUpdate.id, summary: workItemProgressUpdate.summary,
    nextSteps: workItemProgressUpdate.nextSteps, blockers: workItemProgressUpdate.blockers,
    createdAt: workItemProgressUpdate.createdAt, authorId: workItemProgressUpdate.authorId,
    authorName: member.name,
  }).from(workItemProgressUpdate).leftJoin(member, eq(member.id, workItemProgressUpdate.authorId))
    .where(eq(workItemProgressUpdate.workItemId, workItemId))
    .orderBy(desc(workItemProgressUpdate.createdAt));
  return rows;
}

function canEditProgress(actor: Actor, wi: { reporterId: string | null; assigneeId: string | null; projectId: string }): boolean {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  return can(actor, "work_item:update_any", { projectId: wi.projectId, createdBy: wi.reporterId }, ctx)
    || wi.reporterId === actor.memberId || wi.assigneeId === actor.memberId;
}

export async function addProgressUpdate(actor: Actor, workItemId: string, input: {
  summary: string; nextSteps?: string | null; blockers?: string | null;
}) {
  const wi = await wiService.getWorkItem(actor, workItemId);
  const full = wi as unknown as { reporterId: string | null; assigneeId: string | null; projectId: string };
  if (!canEditProgress(actor, full)) throw forbidden();
  const [row] = await db.insert(workItemProgressUpdate).values({
    projectId: full.projectId, workItemId, authorId: actor.memberId,
    summary: input.summary.trim(),
    nextSteps: input.nextSteps?.trim() || null,
    blockers: input.blockers?.trim() || null,
  }).returning();
  await writeActivity({
    projectId: full.projectId, actorId: actor.memberId, targetType: "WORK_ITEM", targetId: workItemId,
    action: "work_item.progress_added",
    summary: `${actor.name} 更新了问题「${(wi as unknown as { key: string }).key}」处理进展：${input.summary.slice(0, 60)}`,
  });
  return row;
}

export async function deleteProgressUpdate(actor: Actor, updateId: string): Promise<void> {
  const row = (await db.select().from(workItemProgressUpdate).where(eq(workItemProgressUpdate.id, updateId)).limit(1))[0];
  if (!row) throw forbidden();
  const wi = await wiService.getWorkItem(actor, row.workItemId).catch(() => null);
  if (!wi) throw forbidden();
  const full = wi as unknown as { reporterId: string | null; assigneeId: string | null; projectId: string };
  if (row.authorId !== actor.memberId && !canEditProgress(actor, full)) throw forbidden();
  await db.delete(workItemProgressUpdate).where(eq(workItemProgressUpdate.id, updateId));
}
