/**
 * 我的工作台 + 个人待办（S5）
 *
 * 时区纪律（B7，本期最容易出错）：
 *   「今天」必须用 **Actor 的时区**算，不能用服务器时区。
 *   否则部署在 UTC 机器上时，北京时间凌晨 1 点前「今天的逾期」会算错一天。
 *   做法：把时区作为参数交给 PG 算，应用层不碰时钟。
 */
import { and, desc, eq, isNull } from "drizzle-orm";
// 同时需要两者：db（drizzle，做类型安全的 CRUD）+ sql（postgres.js 客户端，做聚合查询）
import { db, sql } from "../../db/index.ts";
import { todo, project, workflowState } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";
import { WORKBENCH_GROUP_KEYS, type WorkbenchGroupKey } from "../../shared/workbench.ts";

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

/** 数据范围条件：ORG 档全可见，否则只可见「显式指派 + 我是项目成员」 */
function scopeCond(actor: Actor) {
  if (hasOrgGrant(actor)) return sql`true`;
  return sql`(w.project_id in (select project_id from project_membership where member_id = ${actor.memberId})
              or w.project_id in (select scope_id from role_assignment
                                  where member_id = ${actor.memberId} and scope_type = 'PROJECT' and scope_id is not null))`;
}

export interface WorkbenchGroup {
  key: WorkbenchGroupKey;
  name: string;
  items: Record<string, unknown>[];
  count: number;
}

/** 总览与完整列表共用筛选口径；总数始终覆盖所有匹配工作项。 */
export async function workbenchGroup(actor: Actor, key: WorkbenchGroupKey, options: { page?: number; pageSize?: number } = {}) {
  const tz = actor.timezone ?? "Asia/Shanghai";
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.trunc(options.pageSize ?? 50)));
  const filter = key === "assignedToMe" ? sql`w.assignee_id = ${actor.memberId}`
    : key === "createdByMe" ? sql`w.reporter_id = ${actor.memberId}`
    : key === "overdue" ? sql`w.due_date < (now() at time zone ${tz})::date`
    : sql`w.due_date >= (now() at time zone ${tz})::date and w.due_date <= ((now() at time zone ${tz})::date + 7)`;
  const where = sql`w.deleted_at is null and ${scopeCond(actor)} and ${filter}`;
  const order = key === "overdue" || key === "dueSoon" ? sql`w.due_date asc, w.id asc` : sql`w.created_at desc, w.id desc`;
  const [items, counts] = await Promise.all([
    sql`select w.id, w.key, w.title, w.type, w.priority, w.due_date::text as "dueDate", w.version, p.key as "projectKey"
        from work_item w join project p on p.id = w.project_id where ${where}
        order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`,
    sql`select count(*)::int as n from work_item w join project p on p.id = w.project_id where ${where}`,
  ]);
  const names: Record<WorkbenchGroupKey, string> = { assignedToMe: "指派给我的", createdByMe: "我创建的", overdue: "已逾期", dueSoon: "7 天内到期" };
  return { key, name: names[key], items: items as Record<string, unknown>[], count: Number(counts[0]?.n ?? 0), page, pageSize };
}

export async function workbench(actor: Actor) {
  const tz = actor.timezone ?? "Asia/Shanghai";
  const scope = scopeCond(actor);
  const groups: WorkbenchGroup[] = await Promise.all(WORKBENCH_GROUP_KEYS.map(async (key) => {
    const group = await workbenchGroup(actor, key, { pageSize: 8 });
    return { key: group.key, name: group.name, items: group.items, count: group.count };
  }));

  // ── 跨域聚合（Round 68 对标 YouQu 工作台：缺陷/里程碑）────────────────
  // 口径全部来自真实数据；关闭态同时覆盖通用流 DONE/CANCELLED 与缺陷流 TERMINAL。
  const closedSql = sql`s.category in ('DONE','CANCELLED','TERMINAL')`;
  const [defectRows, myDefectRows, milestoneRows] = await Promise.all([
    sql`
      select
        count(*)::int as total,
        count(*) filter (where not (${closedSql}))::int as open,
        count(*) filter (where not (${closedSql}) and w.severity = 'S1')::int as p0,
        count(*) filter (where ${closedSql})::int as done,
        count(*) filter (where not (${closedSql}) and w.due_date < (now() at time zone ${tz})::date)::int as overdue
      from work_item w
      join workflow_state s on s.id = w.status_id
      where w.deleted_at is null and w.type = 'DEFECT' and ${scope}
    `,
    sql`
      select count(*)::int as n
      from work_item w join workflow_state s on s.id = w.status_id
      where w.deleted_at is null and w.type = 'DEFECT' and w.assignee_id = ${actor.memberId}
        and not (${closedSql}) and ${scope}
    `,
    sql`
      select m.id, m.name, m.due_date::text as "dueDate", p.id as "projectId", p.key as "projectKey"
      from milestone m join project p on p.id = m.project_id
      where m.archived_at is null and m.due_date is not null
        and m.due_date <= ((now() at time zone ${tz})::date + 14)
        and (p.id in (select project_id from project_membership where member_id = ${actor.memberId})
             or p.id in (select scope_id from role_assignment
                         where member_id = ${actor.memberId} and scope_type = 'PROJECT' and scope_id is not null)
             or ${hasOrgGrant(actor)})
      order by m.due_date asc limit 10
    `,
  ]) as unknown as Record<string, unknown>[][];
  const d = (defectRows?.[0] ?? {}) as { total?: number; open?: number; p0?: number; done?: number; overdue?: number };
  const total = Number(d.total ?? 0), done = Number(d.done ?? 0);
  const milestoneItems = (milestoneRows ?? []) as { id: string; name: string; dueDate: string; projectId: string; projectKey: string }[];
  const today = new Date().toISOString().slice(0, 10);
  const crossDomain = {
    defects: {
      total, open: Number(d.open ?? 0), p0: Number(d.p0 ?? 0), done, overdue: Number(d.overdue ?? 0),
      donePercent: total > 0 ? Math.round((done / total) * 100) : 0,
    },
    myOpenDefects: Number((myDefectRows?.[0] as { n?: number } | undefined)?.n ?? 0),
    milestones: {
      overdue: milestoneItems.filter((m) => m.dueDate < today).length,
      dueSoon: milestoneItems.filter((m) => m.dueDate >= today).length,
      items: milestoneItems.slice(0, 5),
    },
  };

  return { groups, total: groups.reduce((n, g) => n + g.count, 0), crossDomain };
}

// ── 个人待办 ────────────────────────────────────────────────

export async function listTodos(actor: Actor, opts: { done?: boolean }) {
  const conds = [eq(todo.memberId, actor.memberId)];
  if (opts.done !== undefined) conds.push(eq(todo.done, opts.done));
  return db.select().from(todo).where(and(...conds)).orderBy(desc(todo.createdAt));
}

export async function createTodo(actor: Actor, input: { title: string; dueDate?: string | null }) {
  const [row] = await db.insert(todo).values({
    memberId: actor.memberId, title: input.title, dueDate: input.dueDate ?? null,
  }).returning();
  await publishWorkspaceInvalidation({ domain: "todo", resourceType: "TODO", resourceId: row!.id, memberId: actor.memberId });
  return row;
}

export async function updateTodo(
  actor: Actor, id: string,
  patch: { title?: string; dueDate?: string | null; done?: boolean },
) {
  const rows = await db.select().from(todo)
    .where(and(eq(todo.id, id), eq(todo.memberId, actor.memberId))).limit(1);
  if (!rows[0]) throw forbidden();      // 别人的待办与不存在同形

  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.done !== undefined) {
    set.done = patch.done;
    set.doneAt = patch.done ? new Date() : null;   // 完成时间随状态写入/清空
  }
  const [row] = await db.update(todo).set(set).where(eq(todo.id, id)).returning();
  await publishWorkspaceInvalidation({ domain: "todo", resourceType: "TODO", resourceId: id, memberId: actor.memberId });
  return row;
}

export async function deleteTodo(actor: Actor, id: string) {
  const res = await db.delete(todo)
    .where(and(eq(todo.id, id), eq(todo.memberId, actor.memberId)))
    .returning({ id: todo.id });
  if (res.length === 0) throw forbidden();
  await publishWorkspaceInvalidation({ domain: "todo", resourceType: "TODO", resourceId: id, memberId: actor.memberId });
}

void isNull;
void workflowState;
void project;
void DomainError;
