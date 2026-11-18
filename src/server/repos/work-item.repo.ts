/**
 * 工作项仓储 —— 唯一碰 work_item 的地方
 *
 * 两条**不可动摇**的规则在这里落地：
 *   1 编号分配用**单语句原子递增**，禁止 `SELECT max(number)+1`（并发下必然重号）
 *   2 软删过滤（`deleted_at IS NULL`）**只在本层做**，领域层不重复判断（数据模型第 0 节）
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { workItem, workflow, workflowState } from "../../db/schema.ts";

export interface CreateRow {
  projectId: string;
  type: string;
  title: string;
  description: string | null;
  workflowId: string;
  statusId: string;
  reporterId: string;
  assigneeId: string | null;
  priority: string | null;
  severity: string | null;
  estimatePoints: string | null;
  estimateHours: string | null;
  startDate: string | null;
  dueDate: string | null;
  parentId: string | null;
  // 计划实体关联（创建时即挂接，第十期补：此前 repo 层没有这四个字段，
  // 服务层就算传了也进不了库）
  milestoneId?: string | null;
  iterationId?: string | null;
  releaseId?: string | null;
  moduleId?: string | null;
}

/**
 * 建工作项 —— 编号分配与插入**在同一个 CTE 里完成**（数据模型 3.1 的分配伪代码）。
 *
 * 为什么必须这样：计数器递增与插入若分成两条语句，就没法保证「计数器的值 = 插入的编号」。
 * 单条 `WITH p AS (UPDATE ... RETURNING) INSERT ... SELECT FROM p` 是原子的，
 * 且失败时整个事务回滚，**计数器不跳号**。
 *
 * ⚠️ `next_issue_number` 是「下一个要用的号」，所以返回值要 `- 1`。
 */
export async function insertWithNumber(row: CreateRow): Promise<{ id: string; key: string; number: number }> {
  const rows = await db.execute<{ id: string; key: string; number: number }>(sql`
    WITH p AS (
      UPDATE project
         SET next_issue_number = next_issue_number + 1
       WHERE id = ${row.projectId}
      RETURNING key, next_issue_number - 1 AS n
    )
    INSERT INTO work_item (
      project_id, number, key, type, title, description, workflow_id, status_id,
      reporter_id, assignee_id, priority, severity, estimate_points, estimate_hours,
      start_date, due_date, parent_id,
      milestone_id, iteration_id, release_id, module_id
    )
    SELECT ${row.projectId}, p.n, p.key || '-' || p.n, ${row.type}, ${row.title}, ${row.description},
           ${row.workflowId}, ${row.statusId}, ${row.reporterId}, ${row.assigneeId},
           ${row.priority}, ${row.severity},
           ${row.estimatePoints}::numeric, ${row.estimateHours}::numeric,
           ${row.startDate}::date, ${row.dueDate}::date, ${row.parentId},
           ${row.milestoneId ?? null}, ${row.iterationId ?? null}, ${row.releaseId ?? null}, ${row.moduleId ?? null}
      FROM p
    RETURNING id, key, number
  `);
  return rows[0]!;
}

/** 按 id 取（**软删过滤在本层**） */
export async function findById(id: string) {
  const rows = await db.select().from(workItem)
    .where(and(eq(workItem.id, id), isNull(workItem.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 乐观锁更新（第 4.9 节）。
 *
 * `WHERE id = ? AND version = ?` 命中才更新，同时 `version + 1`。
 * 返回 null 表示**版本不匹配**（别人先改了）——调用方据此返回 `VERSION_CONFLICT`。
 */
export async function updateWithVersion(
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
): Promise<ReturnType<typeof findById> extends Promise<infer T> ? T | null : never> {
  const rows = await db.update(workItem)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(workItem.id, id),
      eq(workItem.version, expectedVersion),
      isNull(workItem.deletedAt),
    ))
    .returning();
  return (rows[0] ?? null) as never;
}

/** 软删：编号**不复用**（计数器不回退） */
export async function softDelete(id: string): Promise<boolean> {
  const rows = await db.update(workItem)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workItem.id, id), isNull(workItem.deletedAt)))
    .returning({ id: workItem.id });
  return rows.length > 0;
}

/** 该项目按 type 取默认工作流（建工作项时用） */
export async function findDefaultWorkflow(projectId: string, appliesToType: string) {
  const rows = await db.select().from(workflow)
    .where(and(
      eq(workflow.projectId, projectId),
      eq(workflow.appliesToType, appliesToType),
      eq(workflow.isDefault, true),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/** 取工作流的起始状态（`category='NOT_STARTED'`，按 sort_order 第一个） */
export async function findInitialState(workflowId: string) {
  const rows = await db.select().from(workflowState)
    .where(and(eq(workflowState.workflowId, workflowId), eq(workflowState.category, "NOT_STARTED")))
    .orderBy(workflowState.sortOrder)
    .limit(1);
  return rows[0] ?? null;
}

export { workflowState };

/**
 * 日历聚合（S4）：某月内按日期分组的工作项。
 *
 * ⚠️ 一天可能命中两次（`start_date` 与 `due_date` 同日），必须去重 ——
 *    否则用户会看到同一个工作项在格子里出现两遍。
 * ⚠️ `unscheduled` 单独返回：既无 start 也无 due 的工作项不该「消失」，
 *    用户需要知道「还有 N 个没日期」。
 */
export async function loadCalendar(projectId: string, from: string, to: string) {
  const rows = (await db.execute(sql<{ d: string; id: string; key: string; title: string; type: string }[]>`
    with days as (
      select generate_series(
        ${from}::date,
        ${to}::date,
        interval '1 day'
      )::date as d
    ),
    hits as (
      select start_date as d, id, key, title, type from work_item
       where project_id = ${projectId} and deleted_at is null and start_date is not null
      union
      select due_date as d, id, key, title, type from work_item
       where project_id = ${projectId} and deleted_at is null and due_date is not null
    )
    select days.d::text as d, h.id, h.key, h.title, h.type
    from days left join hits h on h.d = days.d
    order by days.d
  `)) as unknown as { d: string; id: string; key: string; title: string; type: string }[];

  const unscheduled = (await db.execute(sql<{ n: number }[]>`
    select count(*)::int as n from work_item
    where project_id = ${projectId} and deleted_at is null
      and start_date is null and due_date is null
  `)) as unknown as { n: number }[];

  /**
   * ⚠️ 去重靠 SQL 的 `UNION`（不是 `UNION ALL`）—— 它按整行去重，
   *    而 select 的列完全相同，因此同一工作项在同一天只会出现一次。
   *
   *    这里**刻意不再做 JS 层去重**：实测发现那是个冗余的死分支 ——
   *    把 JS 去重删掉后测试依然全绿，说明去重实际发生在 SQL 层。
   *    留着一个不起作用的去重会让人误以为"这里保住了正确性"。
   */
  const byDay = new Map<string, { id: string; key: string; title: string; type: string }[]>();
  for (const r of rows) {
    if (!r.id) continue;
    const list = byDay.get(r.d) ?? [];
    list.push({ id: r.id, key: r.key, title: r.title, type: r.type });
    byDay.set(r.d, list);
  }

  return {
    from, to,
    days: [...byDay.entries()].map(([date, items]) => ({ date, items, count: items.length })),
    unscheduled: unscheduled[0]?.n ?? 0,
  };
}

/**
 * 时间线聚合（S4）：按计划实体分行，每行是该实体下的工作项「条」。
 *
 * ⚠️ 只返回 `start_date` 与 `due_date` **都有**的工作项 —— 缺一个就画不出条。
 */
export async function loadTimeline(projectId: string, from: string, to: string) {
  const rows = (await db.execute(sql<{
    kind: string; id: string; name: string; category: string;
    item_id: string | null; item_key: string | null; item_title: string | null;
    start_date: string | null; due_date: string | null;
    entity_start: string | null; entity_due: string | null;
  }[]>`
    -- 里程碑行。⚠️ milestone **没有 status_id 列**（规范 4.1：它用 completed_at
    --    表达生命周期），所以 category 只能由 completed_at 推导。
    select 'milestone' as kind, m.id, m.name,
           case when m.completed_at is null then 'IN_PROGRESS' else 'TERMINAL' end as category,
           w.id as item_id, w.key as item_key, w.title as item_title,
           coalesce(w.start_date, w.due_date)::text as start_date,
           coalesce(w.due_date, w.start_date)::text as due_date,
           -- 第 43 轮：实体**自身**的区间也要返回，否则前端无从画它自己的条
           --（里程碑只有截止日，故为单日条；这是数据事实，不编造起始日）
           m.due_date::text as entity_start, m.due_date::text as entity_due
    from milestone m
    left join work_item w on w.milestone_id = m.id and w.deleted_at is null
                        and (w.start_date is not null or w.due_date is not null)
    where m.project_id = ${projectId} and m.archived_at is null

    union all

    -- 迭代行
    select 'iteration' as kind, i.id, i.name, 'IN_PROGRESS' as category,
           w.id as item_id, w.key as item_key, w.title as item_title,
           coalesce(w.start_date, w.due_date)::text as start_date,
           coalesce(w.due_date, w.start_date)::text as due_date,
           i.start_date::text as entity_start, i.end_date::text as entity_due
    from iteration i
    left join work_item w on w.iteration_id = i.id and w.deleted_at is null
                        and (w.start_date is not null or w.due_date is not null)
    where i.project_id = ${projectId}
    order by kind, name
  `)) as unknown as {
    kind: string; id: string; name: string; category: string;
    item_id: string | null; item_key: string | null; item_title: string | null;
    start_date: string | null; due_date: string | null;
    entity_start: string | null; entity_due: string | null;
  }[];

  const byEntity = new Map<string, {
    kind: string; id: string; name: string; category: string;
    bars: { id: string; key: string; title: string; startDate: string; dueDate: string }[];
  }>();

  for (const r of rows) {
    const k = `${r.kind}:${r.id}`;
    let row = byEntity.get(k);
    if (!row) {
      row = { kind: r.kind, id: r.id, name: r.name, category: r.category, bars: [] };
      // 第 43 轮：实体自身的区间作为**第一条 bar**（title 用实体名，不编造文案）
      if (r.entity_start && r.entity_due) {
        row.bars.push({ id: `${r.kind}:${r.id}`, key: "", title: r.name,
          startDate: r.entity_start, dueDate: r.entity_due });
      }
      byEntity.set(k, row);
    }
    if (r.item_id && r.start_date && r.due_date) {
      row.bars.push({
        id: r.item_id, key: r.item_key ?? "", title: r.item_title ?? "",
        startDate: r.start_date, dueDate: r.due_date,
      });
    }
  }

  return { from, to, rows: [...byEntity.values()] };
}

/**
 * 表格视图（T5）：与看板同源，只是**按列排平**。
 *
 * ⚠️ 刻意不新增 SQL：复用 listByStatus 的过滤语义，改为按
 *    `ORDER BY` 排序列排序，这样表格与看板的可见集合永远一致。
 */
export async function loadTable(projectId: string, opts: {
  page?: number; pageSize?: number;
  type?: string; priority?: string; unscheduled?: boolean;
  sortBy?: "created_at" | "updated_at" | "due_date" | "priority" | "number";
  sortDir?: "asc" | "desc";
} = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));

  // 排序列用白名单，绝不拼接用户输入
  const SORTABLE = {
    created_at: workItem.createdAt,
    updated_at: workItem.updatedAt,
    due_date: workItem.dueDate,
    priority: workItem.priority,
    number: workItem.number,
  } as const;
  const col = SORTABLE[opts.sortBy ?? "number"];
  const dir = opts.sortDir === "desc" ? desc : asc;

  const where = and(
    eq(workItem.projectId, projectId),
    isNull(workItem.deletedAt),
    opts.type ? eq(workItem.type, opts.type) : undefined,
    opts.priority ? eq(workItem.priority, opts.priority) : undefined,
    opts.unscheduled ? and(isNull(workItem.startDate), isNull(workItem.dueDate)) : undefined,
  );

  const rows = await db.select({
    id: workItem.id,
    number: workItem.number,
    key: workItem.key,
    title: workItem.title,
    type: workItem.type,
    priority: workItem.priority,
    severity: workItem.severity,
    statusId: workItem.statusId,
    assigneeId: workItem.assigneeId,
    milestoneId: workItem.milestoneId,
    iterationId: workItem.iterationId,
    startDate: workItem.startDate,
    dueDate: workItem.dueDate,
    estimatePoints: workItem.estimatePoints,
    version: workItem.version,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  }).from(workItem).where(where).orderBy(dir(col), asc(workItem.number))
    .limit(pageSize).offset((page - 1) * pageSize);

  const cnt = await db.select({ n: sql<number>`count(*)::int` })
    .from(workItem).where(where);

  return { rows, total: cnt[0]?.n ?? 0, page, pageSize };
}
