/** 项目仓储 —— 唯一碰 project / project_membership 的地方 */
import { and, eq, inArray, isNull, sql, desc } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { department, project, projectStatusDef, workItem } from "../../db/schema.ts";

export async function findByKey(key: string) {
  const rows = await db.select().from(project).where(eq(project.key, key)).limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string) {
  const rows = await db.select().from(project).where(eq(project.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insert(data: {
  key: string; name: string; description: string | null; createdBy: string; statusId: string | null;
  departmentId?: string | null;
}) {
  const [row] = await db.insert(project).values(data).returning();
  return row!;
}

export async function update(id: string, patch: { name?: string; description?: string | null; leadMemberId?: string | null; departmentId?: string | null }) {
  const [row] = await db.update(project)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(project.id, id))
    .returning();
  return row ?? null;
}

export async function setStatus(id: string, statusId: string) {
  const [row] = await db.update(project)
    .set({ statusId, updatedAt: new Date() })
    .where(eq(project.id, id))
    .returning();
  return row ?? null;
}

export async function setArchived(id: string, archived: boolean) {
  const [row] = await db.update(project)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(project.id, id))
    .returning();
  return row ?? null;
}

export async function findStatusByKey(key: string) {
  const rows = await db.select().from(projectStatusDef).where(eq(projectStatusDef.key, key)).limit(1);
  return rows[0] ?? null;
}

export async function listStatusDefs() {
  return db.select().from(projectStatusDef).orderBy(projectStatusDef.sortOrder);
}

/**
 * 列表（**按数据范围过滤**，第 5.2 节）。
 *
 * 过滤规则：
 *   - 有 ORG 指派 → 全组织可见，不加范围条件
 *   - 否则 → 仅「显式 PROJECT 指派」或「我是 project_membership 成员」的项目
 *
 * ⚠️ TEAM 档对项目不适用：`project` 表没有 team_id 列（数据模型 2.1）。
 *    团队档影响的是「团队可见的资源」（如团队级工作项），不是项目可见性本身。
 */
/**
 * 部门范围（Round 73）：actor 被指派到 DEPARTMENT 的项目可见性（**只读**）。
 * 语义 = 该部门及其全部子部门；写权限仍要求 TEAM/PROJECT/ORG 档（见 docs/对标分析）。
 */
async function departmentProjectCond(memberId: string): Promise<ReturnType<typeof sql> | null> {
  const seeds = await db.execute(sql`
    select scope_id::text as id from role_assignment
    where member_id = ${memberId} and scope_type = 'DEPARTMENT' and scope_id is not null
  `) as unknown as { id: string }[];
  if (seeds.length === 0) return null;
  const rows = await db.select({ id: department.id, parentId: department.parentId, archivedAt: department.archivedAt })
    .from(department);
  const children = new Map<string, string[]>();
  for (const d of rows) {
    if (d.parentId && !d.archivedAt) children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  }
  const ids = seeds.map((s) => s.id);
  for (let i = 0; i < ids.length; i++) {
    for (const child of children.get(ids[i]!) ?? []) ids.push(child);
  }
  if (ids.length === 0) return null;
  return sql`p.department_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
}

export async function listVisible(
  memberId: string,
  hasOrgGrant: boolean,
  opts: { page: number; pageSize: number; archived: boolean },
) {
  const archivedCond = opts.archived
    ? sql`p.archived_at is not null`
    : sql`p.archived_at is null`;

  const deptCond = hasOrgGrant ? null : await departmentProjectCond(memberId);
  const scopeCond = hasOrgGrant
    ? sql`true`
    : sql`(p.id in (select project_id from project_membership where member_id = ${memberId})
            or p.id in (select scope_id from role_assignment
                        where member_id = ${memberId} and scope_type = 'PROJECT' and scope_id is not null)
            ${deptCond ? sql`or ${deptCond}` : sql``})`;

  const rows = await db.execute(sql`
    select p.id, p.key, p.name, p.description, p.archived_at, p.created_at, p.updated_at,
           p.lead_member_id, m.name as lead_name,
           p.department_id, d.name as department_name,
           s.key as status_key, s.name as status_name, s.category as status_category, s.color as status_color
    from project p
    left join project_status_def s on s.id = p.status_id
    left join member m on m.id = p.lead_member_id
    left join department d on d.id = p.department_id
    where ${archivedCond} and ${scopeCond}
    order by p.created_at desc
    limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}
  `);

  const [cnt] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from project p
    where ${archivedCond} and ${scopeCond}
  `) as unknown as { n: number }[];

  return { rows: rows as unknown as Record<string, unknown>[], total: cnt?.n ?? 0 };
}

/** 该成员是否可见该项目（详情与写操作前的范围校验） */
export async function isVisibleTo(memberId: string, projectId: string, hasOrgGrant: boolean): Promise<boolean> {
  if (hasOrgGrant) return true;
  const deptCond = await departmentProjectCond(memberId);
  const rows = await db.execute(sql`
    select 1 from project p
    where p.id = ${projectId}
      and (p.id in (select project_id from project_membership where member_id = ${memberId})
           or p.id in (select scope_id from role_assignment
                       where member_id = ${memberId} and scope_type = 'PROJECT' and scope_id is not null)
           ${deptCond ? sql`or ${deptCond}` : sql``})
    limit 1
  `);
  return (rows as unknown as unknown[]).length > 0;
}

void and; void isNull; void desc;


/**
 * 批量取项目的工作项数（列表页用）。
 *
 * ⚠️ 刻意**一次查询**而不是 N 次：列表有 20 个项目就是 20 次往返。
 * ⚠️ 只数未软删的（deleted_at IS NULL）—— 删掉的不该还占计数。
 */
export async function countWorkItemsByProject(projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (projectIds.length === 0) return out;
  // ⚠️ 不用 `= any($1::uuid[])`：postgres.js 不会把 JS 数组自动绑成 PG 数组
  //    （实测报 22P02 Array value must start with "{"）。改用 drizzle 的 inArray，
  //    它自己生成 `in (...)` 并逐个绑定参数。
  const rows = await db
    .select({ projectId: workItem.projectId, n: sql<number>`count(*)::int` })
    .from(workItem)
    .where(and(inArray(workItem.projectId, projectIds), isNull(workItem.deletedAt)))
    .groupBy(workItem.projectId);
  for (const r of rows) out.set(r.projectId, r.n);
  return out;
}
