/**
 * 洞察（第十期，规范 8.1b / 8.2 + REST 9 节）
 *
 * 口径纪律：
 *   1 燃尽图的**历史点来自 `metric_snapshot`**（规范：由 worker 定时写入）；
 *      本期尚无 worker，因此端点对"没有快照的日期"给出**实时推算点**并标注 `source: "live"` ——
 *      不伪造历史，也不让页面在没跑快照时空白。
 *   2 累积流没有快照表，按 `work_item.created_at` + `activity_entry` 的状态变迁**实时推算**，
 *      统计口径写在返回体里（`metric` 字段），避免"图对了但没人知道怎么算的"。
 *   3 `metric_snapshot` **不暴露写端点**（规范明示，避免手改指标）；写入口只有
 *      `snapshotIteration()` 服务函数，供将来的 worker 调用。
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { activityEntry, dashboard, dashboardWidget, iteration, metricSnapshot, workItem, workflowState } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { recordBusinessEvent } from "./event-log.ts";

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}
async function assertProjectVisible(actor: Actor, projectId: string) {
  if (!(await projectRepo.findById(projectId))) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();
}
function assertCan(actor: Actor, action: string, projectId: string | null) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, action, { projectId, teamId: null }, ctx)) throw forbidden();
}

/** 日期工具：以迭代起止为准，给出逐日序列（含首尾） */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

/**
 * 完成类别的**权威取值**来自数据模型：`workflow_state.category` CHECK IN
 * (`NOT_STARTED`,`IN_PROGRESS`,`TERMINAL`) —— 终态就是完成，没有单独的 DONE/CANCELED。
 * （第一次写成 DONE/CANCELED 时所有完成点数恒为 0，实测才发现。）
 */
const DONE_CATEGORIES = ["TERMINAL"];

/**
 * 迭代的完成点数（截至某日）：
 *   scope = 该日之前创建的、迭代内工作项的故事点之和
 *   done  = 其中在**该日结束前**已进入 DONE/CANCELED 的
 * 口径写成函数而非散落在查询里，便于测试与将来对齐快照。
 */
async function computePointsAt(iterationId: string, day: string): Promise<{ scope: number; done: number }> {
  const items = await db.select({
    id: workItem.id, points: workItem.estimatePoints, createdAt: workItem.createdAt, statusId: workItem.statusId,
  }).from(workItem).where(and(eq(workItem.iterationId, iterationId), isNull(workItem.deletedAt)));

  const states = await db.select().from(workflowState);
  const cat = new Map(states.map((s) => [s.id, s.category]));
  const doneNames = new Set(states.filter((s) => DONE_CATEGORIES.includes(s.category)).map((s) => s.name));

  // 状态变迁的时点来自 activity_entry：`action = work_item.transitioned`，
  // 摘要形如「张三 把 DEMO-1 移到了「已完成」」—— 从中取出目标状态名做结构化判定，
  // 而不是靠模糊匹配整句文案。
  const moves = items.length
    ? await db.select({ targetId: activityEntry.targetId, summary: activityEntry.summary, createdAt: activityEntry.createdAt })
        .from(activityEntry)
        .where(and(
          eq(activityEntry.targetType, "WORK_ITEM"),
          eq(activityEntry.action, "work_item.transitioned"),
          inArray(activityEntry.targetId, items.map((i) => i.id)),
        ))
    : [];
  const movesByItem = new Map<string, { at: number; toDone: boolean }[]>();
  for (const m of moves) {
    if (!m.targetId) continue;
    const stateName = /「([^」]+)」/.exec(m.summary ?? "")?.[1] ?? "";
    const arr = movesByItem.get(m.targetId) ?? [];
    arr.push({ at: new Date(m.createdAt).getTime(), toDone: doneNames.has(stateName) });
    movesByItem.set(m.targetId, arr);
  }

  const dayEnd = new Date(`${day}T23:59:59.999Z`).getTime();
  let scope = 0, done = 0;
  for (const it of items) {
    if (new Date(it.createdAt).getTime() > dayEnd) continue;      // 当日之后才创建的不计入当日范围
    const pts = Number(it.points ?? 0);
    scope += pts;
    // 完成判定：取该日之前的**最后一次**流转 —— 它若指向完成类状态，则当日已完成
    const last = (movesByItem.get(it.id) ?? []).filter((m) => m.at <= dayEnd).sort((a, b) => b.at - a.at)[0];
    if (last?.toDone) done += pts;
    else if (!last && DONE_CATEGORIES.includes(cat.get(it.statusId) ?? "") && new Date(it.createdAt).getTime() <= dayEnd) {
      // 没有任何流转记录但当前已是完成态（如直接创建即完成）→ 以创建时点计
      done += pts;
    }
  }
  return { scope, done };
}

/** 燃尽图：理想线 + 实际线（快照优先，缺日用实时推算并标注来源） */
export async function burnDown(actor: Actor, iterationId: string) {
  const it = (await db.select().from(iteration).where(eq(iteration.id, iterationId)).limit(1))[0];
  if (!it) throw forbidden();
  await assertProjectVisible(actor, it.projectId);

  const start = it.startDate;
  const end = it.endDate;
  if (!start || !end) throw new DomainError("VALIDATION", "该迭代没有起止日期，无法绘制燃尽图", null);

  const snaps = await db.select().from(metricSnapshot)
    .where(and(eq(metricSnapshot.iterationId, iterationId), isNull(metricSnapshot.memberId)))
    .orderBy(asc(metricSnapshot.snapshotDate));
  const snapByDay = new Map(snaps.map((s) => [String(s.snapshotDate), s]));

  const days = eachDay(String(start), String(end));
  const points: { date: string; scope: number; done: number; remaining: number; ideal: number; source: string }[] = [];
  let totalScope = 0;
  for (const d of days) {
    const snap = snapByDay.get(d);
    let scope: number, done: number, source: string;
    if (snap) { scope = Number(snap.scopePoints); done = Number(snap.donePoints); source = "snapshot"; }
    else { const live = await computePointsAt(iterationId, d); scope = live.scope; done = live.done; source = "live"; }
    totalScope = Math.max(totalScope, scope);
    points.push({ date: d, scope, done, remaining: Math.max(0, scope - done), ideal: 0, source });
  }
  // 理想线：从首日范围线性降到 0
  const n = points.length;
  points.forEach((p, i) => { p.ideal = n <= 1 ? 0 : Number(((totalScope * (n - 1 - i)) / (n - 1)).toFixed(1)); });

  return {
    iteration: { id: it.id, name: it.name, startDate: start, endDate: end },
    metric: "remaining = scope - done；scope 为截至当日的迭代内故事点总和，done 为其中已进入 DONE/CANCELED 的点数",
    points,
  };
}

/** 累积流：按状态类别逐日统计（实时推算，口径随返回体给出） */
export async function cumulativeFlow(actor: Actor, iterationId: string) {
  const it = (await db.select().from(iteration).where(eq(iteration.id, iterationId)).limit(1))[0];
  if (!it) throw forbidden();
  await assertProjectVisible(actor, it.projectId);
  const start = it.startDate, end = it.endDate;
  if (!start || !end) throw new DomainError("VALIDATION", "该迭代没有起止日期，无法绘制累积流图", null);

  const items = await db.select({ id: workItem.id, createdAt: workItem.createdAt, statusId: workItem.statusId })
    .from(workItem).where(and(eq(workItem.iterationId, iterationId), isNull(workItem.deletedAt)));
  const states = await db.select().from(workflowState);
  const catOf = new Map(states.map((s) => [s.id, s.category]));

  // 当日所处类别 = 该日之前**最后一次流转**的目标状态名所对应的类别；
  // 没有流转记录则按当前状态（适用于"创建即处于某状态"）。
  const moves = items.length
    ? await db.select({ targetId: activityEntry.targetId, summary: activityEntry.summary, createdAt: activityEntry.createdAt })
        .from(activityEntry)
        .where(and(
          eq(activityEntry.targetType, "WORK_ITEM"),
          eq(activityEntry.action, "work_item.transitioned"),
          inArray(activityEntry.targetId, items.map((i) => i.id)),
        ))
    : [];
  const nameToCat = new Map(states.map((s) => [s.name, s.category]));
  const movesByItem = new Map<string, { at: number; cat: string }[]>();
  for (const m of moves) {
    if (!m.targetId) continue;
    const stateName = /「([^」]+)」/.exec(m.summary ?? "")?.[1] ?? "";
    const arr = movesByItem.get(m.targetId) ?? [];
    arr.push({ at: new Date(m.createdAt).getTime(), cat: nameToCat.get(stateName) ?? "NOT_STARTED" });
    movesByItem.set(m.targetId, arr);
  }

  const CATEGORIES = ["NOT_STARTED", "IN_PROGRESS", "TERMINAL"];
  const series = eachDay(String(start), String(end)).map((d) => {
    const dayEnd = new Date(`${d}T23:59:59.999Z`);
    const bucket: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const it2 of items) {
      if (new Date(it2.createdAt) > dayEnd) continue;             // 当日尚未创建的不计入
      const last = (movesByItem.get(it2.id) ?? []).filter((m) => m.at <= dayEnd.getTime()).sort((a, b) => b.at - a.at)[0];
      const c = last?.cat ?? catOf.get(it2.statusId) ?? "NOT_STARTED";
      bucket[c] = (bucket[c] ?? 0) + 1;
    }
    return { date: d, ...bucket, total: Object.values(bucket).reduce((a, b) => a + b, 0) };
  });

  return {
    iteration: { id: it.id, name: it.name, startDate: start, endDate: end },
    metric: "每个横条 = 当日已存在且处于该状态类别的工作项数（按创建日与状态变迁推算；当日之后才创建的不计入）",
    categories: CATEGORIES,
    series,
  };
}

/**
 * 写当日的指标快照（**唯一写入口**，供 worker 调用；幂等）。
 * 规范：metric_snapshot 不暴露 CRUD 端点，避免"手改指标"。
 */
export async function snapshotIteration(iterationId: string, day?: string) {
  const it = (await db.select().from(iteration).where(eq(iteration.id, iterationId)).limit(1))[0];
  if (!it) throw new DomainError("VALIDATION", "迭代不存在", null);
  const d = day ?? new Date().toLocaleDateString("en-CA"); // 本地时区自然日（同 issues.service 的 today()）
  const { scope, done } = await computePointsAt(iterationId, d);
  // ⚠️ 全项目快照走的是**部分唯一索引**（member_id IS NULL），
  //    onConflict 的列目标对这种索引无效 —— 因此先查后写（幂等由唯一索引兜底）。
  const existing = await db.select().from(metricSnapshot)
    .where(and(
      eq(metricSnapshot.iterationId, iterationId),
      eq(metricSnapshot.snapshotDate, d),
      isNull(metricSnapshot.memberId),
    )).limit(1);
  if (existing[0]) {
    await db.update(metricSnapshot)
      .set({ scopePoints: String(scope), donePoints: String(done) })
      .where(eq(metricSnapshot.id, existing[0].id));
  } else {
    await db.insert(metricSnapshot)
      .values({ iterationId, memberId: null, snapshotDate: d, scopePoints: String(scope), donePoints: String(done) });
  }
  return { date: d, scope, done };
}

// ── 仪表盘（8.2）─────────────────────────────────────────────

export async function listDashboards(actor: Actor, projectId?: string) {
  if (projectId) await assertProjectVisible(actor, projectId);
  const rows = await db.select().from(dashboard).orderBy(desc(dashboard.isDefault), asc(dashboard.name));
  // 可见性：自己的 + 全局 + 自己能看到项目的
  return rows.filter((d) => d.ownerId === actor.memberId || d.projectId === null || (projectId && d.projectId === projectId));
}

export async function createDashboard(actor: Actor, input: { name: string; projectId?: string | null; isDefault?: boolean }) {
  if (input.projectId) { await assertProjectVisible(actor, input.projectId); assertCan(actor, "dashboard:manage", input.projectId); }
  const [row] = await db.insert(dashboard).values({
    projectId: input.projectId ?? null, ownerId: actor.memberId, name: input.name, isDefault: input.isDefault ?? false,
  }).returning();
  // 全局看板（projectId=null）只写审计，不写活动（活动时间线按项目归属）
  await recordBusinessEvent({
    actor, action: "insight.dashboard_created", targetType: "DASHBOARD", targetId: row!.id, projectId: input.projectId ?? null,
    ...(input.projectId ? { summary: `${actor.name} 创建了洞察看板「${input.name}」` } : {}),
  });
  return row;
}

async function loadDashboard(actor: Actor, id: string) {
  const d = (await db.select().from(dashboard).where(eq(dashboard.id, id)).limit(1))[0];
  if (!d) throw forbidden();
  if (d.projectId) await assertProjectVisible(actor, d.projectId);
  return d;
}

export async function getDashboard(actor: Actor, id: string) {
  const d = await loadDashboard(actor, id);
  const widgets = await db.select().from(dashboardWidget).where(eq(dashboardWidget.dashboardId, id)).orderBy(asc(dashboardWidget.sortOrder));
  return { ...d, widgets };
}

export async function updateDashboard(actor: Actor, id: string, patch: { name?: string; isDefault?: boolean }) {
  const d = await loadDashboard(actor, id);
  assertCan(actor, "dashboard:manage", d.projectId);
  if (d.ownerId !== actor.memberId && d.projectId) assertCan(actor, "dashboard:manage", d.projectId);
  const [row] = await db.update(dashboard).set(patch).where(eq(dashboard.id, id)).returning();
  await recordBusinessEvent({
    actor, action: "insight.dashboard_updated", targetType: "DASHBOARD", targetId: id, projectId: d.projectId,
    ...(d.projectId ? { summary: `${actor.name} 更新了洞察看板「${row!.name}」` } : {}),
  });
  return row;
}

export async function deleteDashboard(actor: Actor, id: string): Promise<void> {
  const d = await loadDashboard(actor, id);
  assertCan(actor, "dashboard:manage", d.projectId);
  await db.delete(dashboard).where(eq(dashboard.id, id));
  await recordBusinessEvent({
    actor, action: "insight.dashboard_deleted", targetType: "DASHBOARD", targetId: id, projectId: d.projectId,
    ...(d.projectId ? { summary: `${actor.name} 删除了洞察看板「${d.name}」` } : {}),
  });
}

export async function listWidgets(actor: Actor, dashboardId: string) {
  await loadDashboard(actor, dashboardId);
  return db.select().from(dashboardWidget).where(eq(dashboardWidget.dashboardId, dashboardId)).orderBy(asc(dashboardWidget.sortOrder));
}

export async function addWidget(actor: Actor, dashboardId: string, input: { type: string; config?: Record<string, unknown>; sortOrder?: number }) {
  const d = await loadDashboard(actor, dashboardId);
  assertCan(actor, "dashboard:manage", d.projectId);
  const TYPES = ["BURNDOWN", "CUMULATIVE_FLOW", "ACTIVITY_HEATMAP", "PIE", "LIST", "COUNT"];
  if (!TYPES.includes(input.type)) throw new DomainError("VALIDATION", `挂件类型只支持 ${TYPES.join(" / ")}`, null);
  if (input.type === "BURNDOWN" && !(input.config as { iterationId?: string })?.iterationId) {
    throw new DomainError("VALIDATION", "BURNDOWN 挂件必须指定 iterationId", null);
  }
  const [row] = await db.insert(dashboardWidget).values({
    dashboardId, type: input.type, config: (input.config ?? {}) as object, sortOrder: input.sortOrder ?? 0,
  }).returning();
  await recordBusinessEvent({
    actor, action: "insight.widget_added", targetType: "DASHBOARD_WIDGET", targetId: row!.id, projectId: d.projectId,
    ...(d.projectId ? { summary: `${actor.name} 在看板「${d.name}」添加了挂件（${input.type}）` } : {}),
  });
  return row;
}

export async function updateWidget(actor: Actor, id: string, patch: { type?: string; config?: Record<string, unknown>; sortOrder?: number }) {
  const w = (await db.select().from(dashboardWidget).where(eq(dashboardWidget.id, id)).limit(1))[0];
  if (!w) throw forbidden();
  const d = await loadDashboard(actor, w.dashboardId);
  assertCan(actor, "dashboard:manage", d.projectId);
  const [row] = await db.update(dashboardWidget).set(patch as object).where(eq(dashboardWidget.id, id)).returning();
  await recordBusinessEvent({
    actor, action: "insight.widget_updated", targetType: "DASHBOARD_WIDGET", targetId: id, projectId: d.projectId,
    ...(d.projectId ? { summary: `${actor.name} 更新了看板「${d.name}」的挂件` } : {}),
  });
  return row;
}

export async function deleteWidget(actor: Actor, id: string): Promise<void> {
  const w = (await db.select().from(dashboardWidget).where(eq(dashboardWidget.id, id)).limit(1))[0];
  if (!w) throw forbidden();
  const d = await loadDashboard(actor, w.dashboardId);
  assertCan(actor, "dashboard:manage", d.projectId);
  await db.delete(dashboardWidget).where(eq(dashboardWidget.id, id));
  await recordBusinessEvent({
    actor, action: "insight.widget_deleted", targetType: "DASHBOARD_WIDGET", targetId: id, projectId: d.projectId,
    ...(d.projectId ? { summary: `${actor.name} 删除了看板「${d.name}」的挂件` } : {}),
  });
}

/** 挂件数据：详情端点带上"每个挂件当前的数据"，避免前端为每个挂件各打一次 */
export async function widgetData(actor: Actor, w: typeof dashboardWidget.$inferSelect) {
  const cfg = (w.config ?? {}) as { iterationId?: string };
  if (w.type === "BURNDOWN" && cfg.iterationId) return burnDown(actor, cfg.iterationId);
  if (w.type === "CUMULATIVE_FLOW" && cfg.iterationId) return cumulativeFlow(actor, cfg.iterationId);

  // ── 第 19 轮补：其余四类此前**直接返回 null**（页面因此只能显示占位），现在给**真实聚合** ──
  // 口径纪律与 burnDown 一致：返回体带 `metric` 说明"这个数怎么算的"，不伪造。
  const dash = (await db.select().from(dashboard).where(eq(dashboard.id, w.dashboardId)).limit(1))[0];
  if (!dash) throw forbidden();
  if (dash.projectId) await assertProjectVisible(actor, dash.projectId);
  else return { type: w.type, metric: "该仪表盘未绑定项目，无法聚合", data: null };

  const rows = await db.select({
    key: workItem.key, title: workItem.title, priority: workItem.priority, createdAt: workItem.createdAt,
  }).from(workItem).where(eq(workItem.projectId, dash.projectId)).orderBy(desc(workItem.createdAt));

  switch (w.type) {
    case "COUNT":
      return { type: w.type, metric: "该项目工作项总数", data: { total: rows.length } };
    case "PIE": {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.priority ?? "—", (m.get(r.priority ?? "—") ?? 0) + 1);
      return { type: w.type, metric: "按优先级分组计数",
        data: { slices: [...m.entries()].map(([label, value]) => ({ label, value })) } };
    }
    case "LIST":
      return { type: w.type, metric: "按创建时间倒序取 8 条",
        data: { rows: rows.slice(0, 8).map((r) => ({ key: r.key, title: r.title, priority: r.priority })) } };
    case "ACTIVITY_HEATMAP": {
      const m = new Map<string, number>();
      for (const r of rows) {
        // ⚠️ 必须用 toISOString().slice(0,10)：对 Date 直接 String() 会得到 "Sat Oct 17" 这种
        // 日期字符串前缀，而不是 2026-10-17（实测踩到，与之前 toISOString 那次同族）
        const d = (r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt))).toISOString().slice(0, 10);
        m.set(d, (m.get(d) ?? 0) + 1);
      }
      return { type: w.type, metric: "按创建日期聚合",
        data: { cells: [...m.entries()].sort().map(([date, value]) => ({ date, value })) } };
    }
    default:
      return null;
  }
}

void gte; void lte;

/** 取单个挂件（第 19 轮）：先校验它确实属于该仪表盘，再交给 widgetData 聚合 */
export async function getWidget(actor: Actor, dashboardId: string, widgetId: string) {
  const w = (await db.select().from(dashboardWidget)
    .where(and(eq(dashboardWidget.id, widgetId), eq(dashboardWidget.dashboardId, dashboardId))).limit(1))[0];
  if (!w) throw forbidden();
  const dash = (await db.select().from(dashboard).where(eq(dashboard.id, dashboardId)).limit(1))[0];
  if (!dash) throw forbidden();
  if (dash.projectId) await assertProjectVisible(actor, dash.projectId);
  return w;
}

/**
 * 批量快照（第 54 轮）—— 供调度调用。
 *
 * 背景：`snapshotIteration()` 早已实现且被 e2e 覆盖（32/32 通过），
 * 但**服务端没有任何调度** → 运行中的实例 `metric_snapshot` 永远是空的
 * → 燃尽图只有"实时推算点"、趋势图没有真实历史。
 * 这里补上"谁来定时调用"这一环（写入逻辑本身不动，幂等由 snapshotIteration 保证）。
 */
export async function snapshotAllIterations(day?: string): Promise<number> {
  const its = await db.select({ id: iteration.id }).from(iteration);
  let n = 0;
  for (const it of its) {
    try { await snapshotIteration(it.id, day); n += 1; }
    catch (e) { console.error("[snapshot] 迭代快照失败:", (e as Error).message); }
  }
  return n;
}

/**
 * 项目级活动趋势（第 55 轮）—— 供工作台主面板的 trend-chart 使用。
 *
 * 口径：**按天统计**（最近 N 天）两类真实事件之和 ——
 *   ① `activity_entry`（工作项更新/流转、想法创建等，写入路径已核实可用）
 *   ② `work_item.created_at`（工作项创建；创建路径目前不写活动，所以单独算）
 * ⚠️ **不编造历史**：没有事件的那天就是 0；前端画出来是一条平线也是**真实**的。
 * 返回体带 `metric` 说明口径（沿用本项目纪律）。
 */
export async function projectActivitySeries(actor: Actor, projectId: string, days = 56) {
  await assertProjectVisible(actor, projectId);
  const n = Math.min(Math.max(days, 7), 180);
  const rows = await db.execute(sql<{ d: string; act: number; made: number }[]>`
    with span as (
      select generate_series(current_date - ${n - 1}::int, current_date, '1 day')::date as d
    )
    select to_char(s.d, 'YYYY-MM-DD') as d,
           coalesce(a.cnt, 0)::int as act,
           coalesce(w.cnt, 0)::int as made
    from span s
    left join (
      select created_at::date as d, count(*)::int as cnt
      from activity_entry where project_id = ${projectId} group by 1
    ) a on a.d = s.d
    left join (
      select created_at::date as d, count(*)::int as cnt
      from work_item where project_id = ${projectId} and deleted_at is null group by 1
    ) w on w.d = s.d
    order by s.d
  `);
  // 第 11 轮：拆成两个序列（活动 / 新建）—— 原型的趋势图是**双线**（完成 / 进行），
  // 我这边只有一条真实序列可画，故把两类真实事件分开返回，用它们画双线（**不编造第二条线**）。
  const pts = rows as unknown as { d: string; act: number; made: number }[];
  return {
    metric: "按天统计：活动条数 + 新建工作项数",
    days: n,
    points: pts.map((r) => ({ d: r.d, n: r.act + r.made })),
    series: {
      activity: pts.map((r) => ({ d: r.d, n: r.act })),
      created: pts.map((r) => ({ d: r.d, n: r.made })),
    },
  };
}
