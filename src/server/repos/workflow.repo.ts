/**
 * 工作流仓储 —— 状态、迁移边与看板聚合
 *
 * ⚠️ 一条贯穿本文件的纪律：**终态判定一律读 `category`，禁止硬编码状态码**（C-3）。
 *    `DONE` / `CLOSED` / `VERIFIED` 都可能是终态，硬编码某几个 key 必然漏。
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { workflow, workflowState, workflowTransition } from "../../db/schema.ts";
import { sql } from "drizzle-orm";

export async function findStateById(id: string) {
  const rows = await db.select().from(workflowState).where(eq(workflowState.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findStateByKey(workflowId: string, key: string) {
  const rows = await db.select().from(workflowState)
    .where(and(eq(workflowState.workflowId, workflowId), eq(workflowState.key, key)))
    .limit(1);
  return rows[0] ?? null;
}

/** 取某条迁移边；不存在即「该流转不被允许」 */
export async function findTransition(workflowId: string, fromStateId: string, toStateId: string) {
  const rows = await db.select().from(workflowTransition)
    .where(and(
      eq(workflowTransition.workflowId, workflowId),
      eq(workflowTransition.fromStateId, fromStateId),
      eq(workflowTransition.toStateId, toStateId),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/** 当前状态的全部出边（供详情页的 `allowedTransitions`） */
export async function listTransitionsFrom(workflowId: string, fromStateId: string) {
  const rows = await db
    .select({
      toStateId: workflowTransition.toStateId,
      toKey: workflowState.key,
      toName: workflowState.name,
      toCategory: workflowState.category,
      allowedRoleIds: workflowTransition.allowedRoleIds,
      requiredFields: workflowTransition.requiredFields,
      label: workflowTransition.label,
      sortOrder: workflowTransition.sortOrder,
    })
    .from(workflowTransition)
    .innerJoin(workflowState, eq(workflowState.id, workflowTransition.toStateId))
    .where(and(
      eq(workflowTransition.workflowId, workflowId),
      eq(workflowTransition.fromStateId, fromStateId),
    ))
    // 默认迁移边可同序；用目标状态顺序和唯一key稳定并列项，避免助手复核误报事实变化。
    .orderBy(workflowTransition.sortOrder, workflowState.sortOrder, workflowState.key);
  return rows;
}

export async function listStates(workflowId: string) {
  return db.select().from(workflowState)
    .where(eq(workflowState.workflowId, workflowId))
    .orderBy(workflowState.sortOrder);
}

export interface BoardColumn {
  stateKey: string;
  name: string;
  category: string;
  color: string;
  sortOrder: number;
  wipLimit: number | null;
  items: {
    id: string; key: string; number: number; title: string;
    priority: string | null; assigneeId: string | null; version: number;
  }[];
  count: number;
}

/**
 * 看板聚合：一次查询取回全部列与列内卡片。
 *
 * ⚠️ 列顺序按 `workflow_state.sort_order`，**不是插入顺序** —— 否则改过状态排序后看板列序会乱。
 * ⚠️ `left join` 保证**空列也要出现**（用户需要看到"这一列现在没有卡片"，
 *    而不是那一列凭空消失）。
 */
export interface BoardFilters { q?: string; priority?: string; type?: string; workflowId?: string }

function boardFilterSql(filters: BoardFilters) {
  const keyword = filters.q?.trim();
  return sql`${keyword ? sql`and (strpos(lower(wi.key), lower(${keyword})) > 0 or strpos(lower(wi.title), lower(${keyword})) > 0)` : sql``}
    ${filters.priority ? sql`and wi.priority = ${filters.priority}` : sql``}
    ${filters.type ? sql`and wi.type = ${filters.type}` : sql``}`;
}

function boardWorkflowSql(filters: BoardFilters) {
  // 子任务继承父项工作流，不能只查 applies_to_type=SUBTASK。
  return sql`${filters.workflowId ? sql`and w.id = ${filters.workflowId}` : sql``}
    ${filters.type && filters.type !== "SUBTASK" ? sql`and w.applies_to_type = ${filters.type}` : sql``}`;
}

/** 看板只读元数据，不依赖工作流配置管理权限。 */
export async function listBoardWorkflows(projectId: string) {
  return db.select({ id: workflow.id, name: workflow.name, appliesToType: workflow.appliesToType })
    .from(workflow).where(eq(workflow.projectId, projectId)).orderBy(workflow.appliesToType, workflow.name);
}

export async function loadBoard(projectId: string, perColumnLimit: number, filters: BoardFilters = {}): Promise<BoardColumn[]> {
  // 每个状态只取前 N 条 + 独立 count：不再把整列几百条 json_agg 进内存。
  const rows = await db.execute(sql`
    with selected_states as (
      select distinct on (s.key) s.key, s.name, s.category, s.color,
        case when count(*) over (partition by s.key) = 1 then s.wip_limit else null end as wip_limit, s.sort_order
      from workflow_state s join workflow w on w.id = s.workflow_id
      where w.project_id = ${projectId} and s.archived_at is null ${boardWorkflowSql(filters)}
      order by s.key, w.is_default desc, w.id
    ), board_items as (
      select wi.id, wi.key, wi.number, wi.title, wi.priority, wi.assignee_id, wi.version, wi.created_at, s.key as state_key
      from work_item wi join workflow_state s on s.id = wi.status_id join workflow w on w.id = s.workflow_id
      where wi.project_id = ${projectId} and w.project_id = ${projectId} and wi.deleted_at is null
        ${boardWorkflowSql(filters)} ${boardFilterSql(filters)}
    )
    select s.key as state_key, s.name, s.category, s.color, s.wip_limit, s.sort_order,
      coalesce((
        select json_agg(json_build_object(
          'id', x.id, 'key', x.key, 'number', x.number, 'title', x.title,
          'priority', x.priority, 'assigneeId', x.assignee_id, 'version', x.version
        ))
        from (
          select wi.* from board_items wi where wi.state_key = s.key
          order by wi.created_at desc, wi.id desc
          limit ${perColumnLimit}
        ) x
      ), '[]'::json) as items,
      (select count(*)::int from board_items wi where wi.state_key = s.key) as count
    from selected_states s order by s.sort_order, s.key
  `) as unknown as {
    state_key: string; name: string; category: string; color: string; wip_limit: number | null; sort_order: number;
    items: BoardColumn["items"] | null; count: number;
  }[];
  return rows.map((r) => ({
    stateKey: r.state_key, name: r.name, category: r.category, color: r.color,
    sortOrder: r.sort_order, wipLimit: r.wip_limit, items: r.items ?? [], count: r.count,
  }));
}

/** 单列分页：看板“加载更多”只取该列下一页，不重拉全看板。 */
export async function loadBoardColumn(projectId: string, stateKey: string, offset: number, limit: number, filters: BoardFilters = {}) {
  const rows = await db.execute(sql`
    select
      wi.id, wi.key, wi.number, wi.title, wi.priority, wi.assignee_id, wi.version
    from work_item wi
    join workflow_state s on s.id = wi.status_id
    join workflow w on w.id = s.workflow_id
    where wi.project_id = ${projectId} and w.project_id = ${projectId} and s.key = ${stateKey}
      and wi.deleted_at is null
      ${boardWorkflowSql(filters)} ${boardFilterSql(filters)}
    order by wi.created_at desc, wi.id desc
    offset ${offset} limit ${limit}
  `) as unknown as { id: string; key: string; number: number; title: string; priority: string | null; assignee_id: string | null; version: number }[];
  const cnt = await db.execute(sql`
    select count(*)::int as n from work_item wi
    join workflow_state s on s.id = wi.status_id
    join workflow w on w.id = s.workflow_id
    where wi.project_id = ${projectId} and w.project_id = ${projectId} and s.key = ${stateKey} and wi.deleted_at is null
      ${boardWorkflowSql(filters)} ${boardFilterSql(filters)}
  `) as unknown as { n: number }[];
  return {
    items: rows.map((r) => ({ id: r.id, key: r.key, number: r.number, title: r.title,
      priority: r.priority, assigneeId: r.assignee_id, version: r.version })),
    count: cnt[0]?.n ?? 0,
  };
}
