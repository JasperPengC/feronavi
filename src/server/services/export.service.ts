/**
 * 导出（第八期 W4，REST 6 节 `GET /projects/:projectId/work-items/export`）
 *
 * 三处刻意的实现选择：
 *   1 **UTF-8 BOM**：不加 BOM 时 Excel 会把中文按本地编码解，打开是乱码（中文团队必踩）
 *   2 **CRLF 行尾**：RFC 4180 规定；Excel 与 pandas 都能正确解析
 *   3 **schemaVersion 走响应头**：CSV 里塞元数据会破坏解析器，头信息放 header 更干净
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { customFieldDef, customFieldValue, milestone, module, release, iteration, workItem, workflowState } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";

export const EXPORT_SCHEMA_VERSION = "1";

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

/** CSV 字段转义（RFC 4180）：含逗号/引号/换行的值必须加引号并把内部引号翻倍 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";   // BOM + CRLF
}

export interface WorkItemExportFilters {
  type?: string; severity?: string; priority?: string;
  statusCategory?: string; assigneeId?: string; milestoneId?: string;
  q?: string;
}

export async function exportWorkItemsCsv(actor: Actor, projectId: string, filters: WorkItemExportFilters = {}, options: { maxRows?: number } = {}): Promise<{ csv: string; count: number }> {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();

  const conds = [eq(workItem.projectId, projectId), isNull(workItem.deletedAt)];
  if (filters.type) conds.push(eq(workItem.type, filters.type));
  if (filters.severity) conds.push(eq(workItem.severity, filters.severity));
  if (filters.priority) conds.push(eq(workItem.priority, filters.priority));
  if (filters.assigneeId) conds.push(eq(workItem.assigneeId, filters.assigneeId));
  if (filters.milestoneId) conds.push(eq(workItem.milestoneId, filters.milestoneId));
  if (filters.q?.trim()) {
    const q = `%${filters.q.trim()}%`;
    conds.push(or(ilike(workItem.title, q), ilike(workItem.key, q))!);
  }
  if (filters.statusCategory) {
    const statusCondition = filters.statusCategory === "OPEN"
      ? sql`${workflowState.category} not in ('DONE', 'CANCELLED', 'TERMINAL')`
      : filters.statusCategory === "DONE"
        ? inArray(workflowState.category, ["DONE", "TERMINAL"])
        : eq(workflowState.category, filters.statusCategory);
    conds.push(inArray(workItem.statusId, db.select({ id: workflowState.id }).from(workflowState).where(statusCondition)));
  }
  const query = db.select().from(workItem).where(and(...conds)).orderBy(asc(workItem.number));
  let items = await (options.maxRows ? query.limit(options.maxRows + 1) : query);
  if (options.maxRows && items.length > options.maxRows) {
    throw new DomainError("VALIDATION", "导出行数超过上限，请收窄筛选条件", { limit: options.maxRows });
  }

  const states = items.length ? await db.select({ id: workflowState.id, key: workflowState.key, name: workflowState.name, category: workflowState.category }).from(workflowState).where(inArray(workflowState.id, [...new Set(items.map(item => item.statusId))])) : [];
  const stateName = new Map(states.map((s) => [s.id, s.name]));
  const stateCategory = new Map(states.map((s) => [s.id, s.category]));
  if (filters.statusCategory) {
    const closed = new Set(["DONE", "TERMINAL"]);
    items = items.filter((w) => {
      const cat = stateCategory.get(w.statusId) ?? "";
      if (filters.statusCategory === "OPEN") return !["DONE", "CANCELLED", "TERMINAL"].includes(cat);
      if (filters.statusCategory === "DONE") return closed.has(cat);
      return cat === filters.statusCategory;
    });
  }
  const ms = await db.select({ id: milestone.id, name: milestone.name }).from(milestone).where(eq(milestone.projectId, projectId));
  const it = await db.select({ id: iteration.id, name: iteration.name }).from(iteration).where(eq(iteration.projectId, projectId));
  const rl = await db.select({ id: release.id, name: release.name }).from(release).where(eq(release.projectId, projectId));
  const md = await db.select({ id: module.id, name: module.name }).from(module).where(eq(module.projectId, projectId));
  const name = (rows: { id: string; name: string }[], id: string | null) => (id ? (rows.find((r) => r.id === id)?.name ?? "") : "");

  // 自定义字段列（归档字段也导出 —— 已填的值不能因为归档就消失）
  const defs = await db.select().from(customFieldDef).where(eq(customFieldDef.projectId, projectId))
    .orderBy(asc(customFieldDef.sortOrder), asc(customFieldDef.key));
  const valueRows = items.length
    ? await db.select().from(customFieldValue).where(inArray(customFieldValue.workItemId, items.map(item => item.id)))
    : [];
  const valueByItem = new Map(valueRows.map((v) => [v.workItemId, (v.values ?? {}) as Record<string, unknown>]));

  const header = [
    "key", "title", "type", "status", "priority", "severity", "assignee",
    "start_date", "due_date", "estimate_points",
    "milestone", "iteration", "release", "module",
    ...defs.map((d) => `cf_${d.key}`),
  ];

  const rows = items.map((w) => {
    const cf = valueByItem.get(w.id) ?? {};
    return [
      w.key, w.title, w.type,
      stateName.get(w.statusId) ?? "",
      w.priority ?? "", w.severity ?? "", w.assigneeId ?? "",
      w.startDate ?? "", w.dueDate ?? "", w.estimatePoints ?? "",
      name(ms, w.milestoneId), name(it, w.iterationId), name(rl, w.releaseId), name(md, w.moduleId),
      // 多选值用 | 连接（导出是给人看的，不追求可逆）
      ...defs.map((d) => {
        const v = cf[d.id];
        if (v === undefined || v === null) return "";
        return Array.isArray(v) ? v.join("|") : (v as string | number);
      }),
    ] as (string | number | null)[];
  });

  return { csv: toCsv(header, rows), count: rows.length };
}
