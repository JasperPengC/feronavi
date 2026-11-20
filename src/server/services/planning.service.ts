/**
 * 计划实体领域服务（里程碑 / 迭代 / 版本 / 模块）
 *
 * 四条纪律：
 *   1 **删除 = 归档**（第 5.3 节）：只置 archived_at，不物理删
 *   2 列表与详情**按数据范围过滤**，不允许「先查全再内存过滤」（分页下会错）
 *   3 不可见与不存在返回**同形**错误
 *   4 权限判定走 `assertCan`，路由里不判
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import {
  milestone, iteration, release, module, project, workItem, workflowState, iterationCapacity, projectMembership,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { assertTreeParent, lockProjectTree } from "./project-tree.ts";

import { get, assertCanManage, assertProjectVisible, type PlanKind, type PlanRowMap } from "./planning-access.ts";
export { get, assertCanManage as assertPlanManagement } from "./planning-access.ts";
export type { PlanKind } from "./planning-access.ts";
type PlanDetail<K extends PlanKind> = PlanRowMap[K] & (K extends "iteration" | "release" ? { pendingWorkItemCount: number } : object);
const TABLE = { milestone, iteration, release, module } as const;
const SORT = { milestone: milestone.sortOrder, iteration: iteration.startDate, release: release.sortOrder, module: module.sortOrder };

/** 列表（**软删过滤只在这里做**） */
export async function list<K extends PlanKind>(actor: Actor, projectId: string, kind: K, opts: { includeArchived?: boolean } = {}): Promise<PlanDetail<K>[]> {
  await assertProjectVisible(actor, projectId);
  // milestone 列集是四表公共列超集，本服务只用公共列 + archivedAt，故统一按其类型访问
  const t = TABLE[kind]! as typeof milestone;

  const conds = [eq(t.projectId, projectId)];
  if (!opts.includeArchived) conds.push(isNull(t.archivedAt));

  // 运行时行形状由 kind 决定，编译期 cast 经 unknown 中转（列访问在 t 上已按公共列超集收口）
  const rows = await db.select().from(t).where(and(...conds)).orderBy(asc(SORT[kind]!)) as unknown as PlanRowMap[K][];
  return withPendingCounts(rows, kind);
}

/** 与完成/结转共用终态口径；软删除工作项不计入待处理项。 */
export function pendingWorkItemCondition() {
  return and(isNull(workItem.deletedAt), ne(workflowState.category, "TERMINAL"));
}

async function withPendingCounts<K extends PlanKind>(rows: PlanRowMap[K][], kind: K): Promise<PlanDetail<K>[]> {
  if ((kind !== "iteration" && kind !== "release") || rows.length === 0) return rows as PlanDetail<K>[];
  const column = kind === "iteration" ? workItem.iterationId : workItem.releaseId;
  const counts = await db.select({ id: column, count: sql<number>`count(*)::int` }).from(workItem)
    .innerJoin(workflowState, eq(workItem.statusId, workflowState.id))
    .where(and(inArray(column, rows.map(row => row.id)), pendingWorkItemCondition())).groupBy(column);
  const byId = new Map(counts.map(row => [row.id, row.count]));
  return rows.map(row => ({ ...row, pendingWorkItemCount: byId.get(row.id) ?? 0 })) as PlanDetail<K>[];
}

export async function getDetail<K extends PlanKind>(actor: Actor, id: string, kind: K): Promise<PlanDetail<K>> {
  return (await withPendingCounts([await get(actor, id, kind)], kind))[0]!;
}

/** REST/MCP 共用更新入口：权限、字段白名单、关系校验与事件在同一服务内。 */
export async function updatePlan(actor: Actor, id: string, kind: PlanKind, raw: unknown) {
  const schemas = { milestone: updateMilestoneSchema, iteration: updateIterationSchema, release: updateReleaseSchema, module: updateModuleSchema };
  const parsed = schemas[kind].safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "计划更新参数不合法", parsed.error.issues);
  const current = await get(actor, id, kind);
  await assertCanManage(actor, kind, current.projectId);
  const patch: Record<string, unknown> = { ...parsed.data };
  if (kind === "milestone") {
    patch.updatedAt = new Date();
    if (patch.progressValue !== undefined && patch.progressValue !== null) patch.progressValue = String(patch.progressValue);
  }
  const table = TABLE[kind] as typeof milestone;
  const write = () => db.update(table).set(patch).where(eq(table.id, id)).returning();
  const [row] = kind === "iteration" || kind === "release" || (kind === "module" && patch.parentId !== undefined)
    ? await db.transaction(async () => {
        await lockProjectTree(current.projectId);
        if (kind === "iteration" || kind === "release") {
          const locked = await get(actor, id, kind);
          if (locked.completedAt || locked.archivedAt) throw new DomainError("BLOCKED_BY_PREREQUISITE", "已完成或归档的计划不能修改", null);
        }
        if (typeof patch.parentId === "string") await assertTreeParent("module", current.projectId, patch.parentId, id);
        return write();
      })
    : await write();
  await recordBusinessEvent({
    actor, action: `plan.${kind}.updated`, targetType: kind.toUpperCase(), targetId: id, projectId: current.projectId,
    summary: `${actor.name} 更新了${planKindLabel(kind)}「${row!.name}」`, changes: parsed.data,
  });
  return row;
}

/** REST/MCP 共用容量读取，成员集合和历史容量遵循同一口径。 */
export async function getIterationCapacity(actor: Actor, id: string) {
  const it = await get(actor, id, "iteration");
  const rows = await db.execute(sql`
    select pm.member_id::text as member_id, m.name, m.username,
           ic.capacity_points::float8 as capacity_points,
           ic.capacity_hours::float8 as capacity_hours,
           coalesce(ic.logged_points, 0)::float8 as logged_points
    from project_membership pm
    join member m on m.id = pm.member_id
    left join iteration_capacity ic on ic.iteration_id = ${id} and ic.member_id = pm.member_id
    where pm.project_id = ${it.projectId}
    order by m.name
  `) as unknown as { member_id: string; name: string; username: string; capacity_points: number | null; capacity_hours: number | null; logged_points: number }[];
  return { members: rows.map(row => ({ memberId: row.member_id, name: row.name, username: row.username,
    capacityPoints: row.capacity_points, capacityHours: row.capacity_hours, loggedPoints: row.logged_points })) };
}

/** 容量写入与完成共用项目锁；等待完成事务后必须重新检查迭代状态。 */
export async function setIterationCapacity(actor: Actor, id: string, memberId: string, raw: unknown) {
  const current = await get(actor, id, "iteration");
  await assertCanManage(actor, "iteration", current.projectId);
  const body = z.object({
    capacityPoints: z.number().min(0).max(99999).nullable().optional(),
    capacityHours: z.number().min(0).max(999999).nullable().optional(),
  }).safeParse(raw);
  if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
  const hasPoints = body.data.capacityPoints != null;
  const hasHours = body.data.capacityHours != null;
  if (hasPoints === hasHours) throw new DomainError("VALIDATION", "容量点数与容量小时必须二选一", null);
  return db.transaction(async () => {
    await lockProjectTree(current.projectId);
    const locked = await get(actor, id, "iteration");
    if (locked.completedAt || locked.archivedAt) throw new DomainError("BLOCKED_BY_PREREQUISITE", "已完成或归档的迭代不能修改容量", null);
    const [membership] = await db.select({ memberId: projectMembership.memberId }).from(projectMembership)
      .where(and(eq(projectMembership.projectId, locked.projectId), eq(projectMembership.memberId, memberId))).limit(1);
    if (!membership) throw new DomainError("VALIDATION", "成员不属于该项目", null);
    const values = {
      iterationId: id, memberId,
      capacityPoints: body.data.capacityPoints != null ? String(body.data.capacityPoints) : null,
      capacityHours: body.data.capacityHours != null ? String(body.data.capacityHours) : null,
    };
    const [row] = await db.insert(iterationCapacity).values(values).onConflictDoUpdate({
      target: [iterationCapacity.iterationId, iterationCapacity.memberId],
      set: { capacityPoints: values.capacityPoints, capacityHours: values.capacityHours },
    }).returning();
    await recordBusinessEvent({ actor, action: "plan.iteration.capacity_updated", targetType: "ITERATION", targetId: id, projectId: locked.projectId });
    return row;
  });
}

/** 关联工作项数（归档前提示用） */
export async function countLinkedWorkItems(kind: PlanKind, id: string): Promise<number> {
  const col = {
    milestone: "milestone_id", iteration: "iteration_id",
    release: "release_id", module: "module_id",
  }[kind]!;
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from work_item
    where ${sql.raw(col)} = ${id} and deleted_at is null
  `) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** 归档（= 删除）。有关联工作项时拒绝，避免用户以为数据丢了。 */
export async function archive(actor: Actor, id: string, kind: PlanKind): Promise<void> {
  if (kind === "iteration" || kind === "release") {
    await (await import("./planning-lifecycle.service.ts")).setArchived(actor, id, kind, true);
    return;
  }
  // milestone 列集是四表公共列超集，本服务只用公共列 + archivedAt，故统一按其类型访问
  const t = TABLE[kind]! as typeof milestone;
  const current = await get(actor, id, kind);
  await assertCanManage(actor, kind, current.projectId);
  if (!t.archivedAt) throw new DomainError("CONFLICT", "该实体不支持归档操作", null);

  await db.transaction(async () => {
    // 与工作项挂接共用项目锁，保证关联计数与归档写入不可交错。
    await lockProjectTree(current.projectId);
    const row = await get(actor, id, kind);
    if (row.archivedAt) return;
    const linked = await countLinkedWorkItems(kind, id);
    if (linked > 0) {
      throw new DomainError("BLOCKED_BY_PREREQUISITE",
        `该${kind === "milestone" ? "里程碑" : "模块"}下还有 ${linked} 个工作项，请先移出或归档它们`,
        { linked });
    }
    await db.update(t).set({ archivedAt: new Date(), ...(kind === "milestone" ? { updatedAt: new Date() } : {}) })
      .where(eq(t.id, id));
    await recordBusinessEvent({
      actor, action: `plan.${kind}.archived`, targetType: kind.toUpperCase(), targetId: id, projectId: row.projectId,
      summary: `${actor.name} 归档了${planKindLabel(kind)}「${row.name}」`,
    });
  });
}

export async function unarchive(actor: Actor, id: string, kind: PlanKind): Promise<void> {
  if (kind === "iteration" || kind === "release") {
    await (await import("./planning-lifecycle.service.ts")).setArchived(actor, id, kind, false);
    return;
  }
  // milestone 列集是四表公共列超集，本服务只用公共列 + archivedAt，故统一按其类型访问
  const t = TABLE[kind]! as typeof milestone;
  const row = await get(actor, id, kind);
  await assertCanManage(actor, kind, row.projectId);
  await db.transaction(async () => {
    await lockProjectTree(row.projectId);
    if (!(await get(actor, id, kind)).archivedAt) return;
    await db.update(t).set({ archivedAt: null, ...(kind === "milestone" ? { updatedAt: new Date() } : {}) }).where(eq(t.id, id));
    await recordBusinessEvent({
      actor, action: `plan.${kind}.unarchived`, targetType: kind.toUpperCase(), targetId: id, projectId: row.projectId,
      summary: `${actor.name} 取消了${planKindLabel(kind)}「${row.name}」的归档`,
    });
  });
}

export { completeIteration, completeRelease } from "./plan-lifecycle.service.ts";

function planKindLabel(kind: PlanKind): string {
  return kind === "milestone" ? "里程碑" : kind === "iteration" ? "迭代" : kind === "release" ? "版本" : "模块";
}

void desc;
void module;
void project;

// ── 保存视图（Spec V8）──────────────────────────────────────
import { savedView } from "../../db/schema.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { businessEffects } from "./business-effects.ts";
import {
  createMilestoneSchema, createIterationSchema, createReleaseSchema, createModuleSchema,
  updateMilestoneSchema, updateIterationSchema, updateReleaseSchema, updateModuleSchema,
} from "../../shared/schemas/planning.ts";

/**
 * 保存视图：PERSONAL（project_id 可空）/ PROJECT_SHARED（必填）。
 * 一致性由 DB 的 CHECK 兜底（saved_view_shared_needs_project / personal_no_project），
 * 这里再前置校验一次，给出可读文案。
 */
/** 创建与幂等重放共用当前项目可见性检查；个人视图仅依赖当前身份。 */
export async function authorizeSavedViewCreation(actor: Actor, input: { scope?: string; projectId?: string | null }) {
  const scope = input.scope ?? "PERSONAL";
  if (scope === "PROJECT_SHARED" && !input.projectId) {
    throw new DomainError("VALIDATION", "项目共享视图必须指定项目", null);
  }
  if (scope === "PERSONAL" && input.projectId) {
    throw new DomainError("VALIDATION", "个人视图不应指定项目", null);
  }
  if (input.projectId) await assertProjectVisible(actor, input.projectId);
  return scope;
}

export async function createSavedView(actor: Actor, input: {
  name: string; viewType: string; scope?: string; projectId?: string | null;
  filters?: Record<string, unknown>; sorts?: unknown[];
}) {
  const scope = await authorizeSavedViewCreation(actor, input);

  const maxOrder = (await db.select({ n: savedView.sortOrder }).from(savedView)
    .where(eq(savedView.ownerId, actor.memberId))).reduce((m, r) => Math.max(m, r.n), -1);
  const [row] = await db.insert(savedView).values({
    sortOrder: maxOrder + 1,
    ownerId: actor.memberId,
    scope,
    projectId: input.projectId ?? null,
    viewType: input.viewType,
    name: input.name,
    filters: (input.filters ?? {}) as object,
    sorts: (input.sorts ?? []) as unknown as object[],
  }).returning();
  await publishWorkspaceInvalidation({ domain: "savedView", resourceType: "SAVED_VIEW", resourceId: row!.id, projectId: row!.projectId, ...(row!.projectId ? {} : { memberId: row!.ownerId }) });
  return row;
}

export async function listSavedViews(actor: Actor, projectId?: string) {
  if (projectId) await assertProjectVisible(actor, projectId);
  const rows = await db.select().from(savedView).where(
    projectId
      ? and(eq(savedView.projectId, projectId), eq(savedView.scope, "PROJECT_SHARED"))
      : eq(savedView.ownerId, actor.memberId),
  ).orderBy(asc(savedView.sortOrder), asc(savedView.createdAt));
  return rows;
}

/** 读取：owner 本人，或 PROJECT_SHARED 且项目可见（共享视图对其他项目成员可读但不可改） */
export async function getSavedView(actor: Actor, id: string) {
  const row = (await db.select().from(savedView).where(eq(savedView.id, id)).limit(1))[0];
  if (!row) throw forbidden();
  if (row.ownerId === actor.memberId) return row;
  if (row.scope === "PROJECT_SHARED" && row.projectId
    && await projectRepo.isVisibleTo(actor.memberId, row.projectId, actor.grants.some((g) => g.scopeType === "ORG"))) {
    return row;
  }
  throw forbidden();
}

/** 拖拽排序：仅本人；ids 必须**全部属于自己**（不能把共享视图塞进个人排序） */
export async function reorderSavedViews(actor: Actor, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (new Set(ids).size !== ids.length) throw new DomainError("VALIDATION", "ids 不能重复", null);
  const rows = await db.select({ id: savedView.id, ownerId: savedView.ownerId, projectId: savedView.projectId }).from(savedView).where(inArray(savedView.id, ids));
  if (rows.length !== ids.length || rows.some((r) => r.ownerId !== actor.memberId)) throw forbidden();
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.update(savedView).set({ sortOrder: i, updatedAt: new Date() }).where(eq(savedView.id, id));
      const row = rows.find(row => row.id === id)!;
      await publishWorkspaceInvalidation({ domain: "savedView", resourceType: "SAVED_VIEW", resourceId: id, projectId: row.projectId, ...(row.projectId ? {} : { memberId: row.ownerId }) });
    }
  });
}

/** 改名 / 改 pinned / 改筛选排序：**仅 owner**（共享视图也不能被他人改） */
export async function updateSavedView(actor: Actor, id: string, patch: {
  name?: string; isPinned?: boolean; filters?: Record<string, unknown>; sorts?: unknown[];
}) {
  const row = (await db.select().from(savedView).where(eq(savedView.id, id)).limit(1))[0];
  if (!row || row.ownerId !== actor.memberId) throw forbidden();
  const [updated] = await db.update(savedView).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
    ...(patch.filters !== undefined ? { filters: patch.filters as object } : {}),
    ...(patch.sorts !== undefined ? { sorts: patch.sorts as unknown as object[] } : {}),
    updatedAt: new Date(),
  }).where(eq(savedView.id, id)).returning();
  await publishWorkspaceInvalidation({ domain: "savedView", resourceType: "SAVED_VIEW", resourceId: id, projectId: row.projectId, ...(row.projectId ? {} : { memberId: row.ownerId }) });
  return updated;
}

export async function deleteSavedView(actor: Actor, id: string): Promise<void> {
  const res = await db.delete(savedView)
    .where(and(eq(savedView.id, id), eq(savedView.ownerId, actor.memberId)))
    .returning({ id: savedView.id, projectId: savedView.projectId });
  // 删别人的视图与删不存在的同形
  if (res.length === 0) throw forbidden();
  await publishWorkspaceInvalidation({ domain: "savedView", resourceType: "SAVED_VIEW", resourceId: id, projectId: res[0]!.projectId, ...(res[0]!.projectId ? {} : { memberId: actor.memberId }) });
}

/**
 * 创建计划实体（第十三期抽取）
 *
 * 为什么抽出来：里程碑/迭代/版本/模块的创建逻辑此前**内联在路由里**，导致
 * ① MCP 工具无法映射（工具只做映射、不写查询，也不允许另造第二条创建路径）；
 * ② **权限判定整个缺失** —— 路由只检查了"项目存在"，任何能看到该项目的人都能建里程碑。
 *    文档给这四个动作都定了权限（`milestone:manage` / `iteration:manage` / `release:manage` / `module:manage`）。
 * 现统一在本函数内完成：参数校验 → 项目可见 → **权限判定** → 落库。
 */

type CreateSchemas = {
  milestone: typeof createMilestoneSchema;
  iteration: typeof createIterationSchema;
  release: typeof createReleaseSchema;
  module: typeof createModuleSchema;
};

type PlanCreateKind = keyof CreateSchemas;

/** 各 kind 的校验 schema（分别解析：联合 schema 的 data 是联合类型，逐分支解析才类型安全） */
function parseCreate(kind: "milestone", raw: unknown) { return createMilestoneSchema.safeParse(raw); }
function parseCreate2(kind: "iteration", raw: unknown) { return createIterationSchema.safeParse(raw); }
function parseCreate3(kind: "release", raw: unknown) { return createReleaseSchema.safeParse(raw); }
function parseCreate4(kind: "module", raw: unknown) { return createModuleSchema.safeParse(raw); }

export async function createPlan(actor: Actor, projectId: string, kind: PlanCreateKind, raw: unknown) {
  if (!(await projectRepo.findById(projectId))) throw new DomainError("FORBIDDEN", "无权访问该资源", null);

  // 权限判定（此前内联在路由里的实现完全漏掉了这一步）
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, `${kind}:manage`, { projectId, teamId: null }, ctx)) throw forbidden();

  if (kind === "milestone") {
    const parsed = parseCreate("milestone", raw);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    // ⚠️ numeric 列在 Drizzle 里必须是 string（避免 JS 浮点误差把 0.1 变 0.100000001）
    const { progressValue, ...rest } = parsed.data;   // progressMode 必须随 rest 一起落库，不能拆掉
    /**
     * DB 有 CHECK：`(progress_mode = 'MANUAL') = (progress_value IS NOT NULL)` ——
     * 非 MANUAL 模式带进度值会被数据库拒掉。这里提前给出**可读的** VALIDATION，
     * 而不是把原始约束错误抛给调用方（agent 拿到 "Failed query" 是没法自助修复的）。
     */
    if (progressValue != null && parsed.data.progressMode !== "MANUAL") {
      throw new DomainError("VALIDATION", "只有 MANUAL 进度模式才能设置 progressValue", { progressMode: parsed.data.progressMode });
    }
    const [row] = await db.insert(milestone).values({
      ...rest, projectId,
      ...(progressValue != null ? { progressValue: String(progressValue) } : {}),
    }).returning();
    await recordBusinessEvent({
      actor, action: "plan.milestone.created", targetType: "MILESTONE", targetId: row!.id, projectId,
      summary: `${actor.name} 创建了里程碑「${row!.name}」`,
    });
    await businessEffects().deliverWebhook("milestone.created", {
      id: row!.id, projectId, actorId: actor.memberId,
    }, projectId);
    return row;
  }
  if (kind === "iteration") {
    const parsed = parseCreate2("iteration", raw);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const [row] = await db.insert(iteration).values({ ...parsed.data, projectId }).returning();
    await recordBusinessEvent({
      actor, action: "plan.iteration.created", targetType: "ITERATION", targetId: row!.id, projectId,
      summary: `${actor.name} 创建了迭代「${row!.name}」`,
    });
    return row;
  }
  if (kind === "release") {
    const parsed = parseCreate3("release", raw);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const [row] = await db.insert(release).values({ ...parsed.data, projectId }).returning();
    await recordBusinessEvent({
      actor, action: "plan.release.created", targetType: "RELEASE", targetId: row!.id, projectId,
      summary: `${actor.name} 创建了版本「${row!.name}」`,
    });
    return row;
  }
  const parsed = parseCreate4("module", raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
  const [row] = await db.transaction(async () => {
    await lockProjectTree(projectId);
    if (parsed.data.parentId) await assertTreeParent("module", projectId, parsed.data.parentId);
    return db.insert(module).values({ ...parsed.data, projectId }).returning();
  });
  await recordBusinessEvent({
    actor, action: "plan.module.created", targetType: "MODULE", targetId: row!.id, projectId,
    summary: `${actor.name} 创建了模块「${row!.name}」`,
  });
  return row;
}

/** MCP 缓存重放与实际写入共用领域管理权限判定。 */
