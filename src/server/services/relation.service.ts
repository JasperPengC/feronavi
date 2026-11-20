/**
 * 工作项关系（B1，REST 6 节 + 数据模型 3.3）
 *
 * C-13：BLOCKS 有向图**不允许环** —— 否则甘特/依赖推导会死循环。
 * 写入统一存 BLOCKS（BLOCKED_BY 是反向视角，由查询端翻转）。
 */
import { eq, and, or } from "drizzle-orm";
import { db, sql } from "../../db/index.ts";
import { workItem, workItemRelation } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";

const TYPES = ["BLOCKS", "RELATES_TO", "DUPLICATES"] as const;
export type RelationType = (typeof TYPES)[number];

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function assertVisible(actor: Actor, projectId: string): Promise<void> {
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor)))) throw forbidden();
}

/** C-13 无环检测：从 target 出发沿 BLOCKS 往下走，走回 source 即成环 */
async function wouldCycle(sourceId: string, targetId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    with recursive walk as (
      select target_id from work_item_relation where source_id = ${targetId} and type = 'BLOCKS'
      union
      select r.target_id from work_item_relation r join walk w on r.source_id = w.target_id
      where r.type = 'BLOCKS'
    )
    select target_id as id from walk where target_id = ${sourceId} limit 1
  `;
  return rows.length > 0;
}

export async function addRelation(actor: Actor, sourceId: string, input: {
  targetId: string; type: string;
}) {
  const src = await db.select().from(workItem).where(eq(workItem.id, sourceId)).limit(1);
  if (!src[0] || src[0].deletedAt) throw forbidden();
  await assertVisible(actor, src[0].projectId);

  // 归一：BLOCKED_BY(a,b) == BLOCKS(b,a)
  let type = input.type;
  let from = sourceId;
  let to = input.targetId;
  if (type === "BLOCKED_BY") { type = "BLOCKS"; from = input.targetId; to = sourceId; }
  if (!(TYPES as readonly string[]).includes(type)) {
    throw new DomainError("VALIDATION", "关系类型只支持 BLOCKS / BLOCKED_BY / RELATES_TO / DUPLICATES", null);
  }
  if (from === to) throw new DomainError("VALIDATION", "不能与自己建立关系", null);

  const tgt = await db.select().from(workItem).where(eq(workItem.id, input.targetId)).limit(1);
  if (!tgt[0] || tgt[0].deletedAt) throw new DomainError("VALIDATION", "对方工作项不存在", null);
  await assertVisible(actor, tgt[0].projectId);

  if (type === "BLOCKS" && (await wouldCycle(from, to))) {
    throw new DomainError("VALIDATION", "该依赖会形成环（C-13），已拒绝", null);
  }

  // 已存在的关系幂等返回，供 REST/MCP 安全重试。
  const dup = await db.select().from(workItemRelation)
    .where(and(
      eq(workItemRelation.sourceId, from),
      eq(workItemRelation.targetId, to),
      eq(workItemRelation.type, type),
    )).limit(1);
  if (dup[0]) return dup[0];

  const [row] = await db.insert(workItemRelation).values({
    projectId: src[0].projectId, sourceId: from, targetId: to, type,
  }).returning();
  return row;
}

/** 某项的关系视图：blocks（我阻塞谁）+ blockedBy（谁阻塞我）+ others */
export async function listRelations(actor: Actor, workItemId: string, allowedProjectIds?: readonly string[]) {
  const src = await db.select().from(workItem).where(eq(workItem.id, workItemId)).limit(1);
  if (!src[0] || src[0].deletedAt) throw forbidden();
  await assertVisible(actor, src[0].projectId);

  const rows = await sql<{
    id: string; type: string; source_id: string; target_id: string;
    source_key: string; target_key: string; source_title: string; target_title: string;
    source_project_id: string; target_project_id: string;
  }[]>`
    select r.id, r.type, r.source_id, r.target_id,
           sw.key as source_key, tw.key as target_key,
           sw.title as source_title, tw.title as target_title,
           sw.project_id as source_project_id, tw.project_id as target_project_id
    from work_item_relation r
    join work_item sw on sw.id = r.source_id
    join work_item tw on tw.id = r.target_id
    where (r.source_id = ${workItemId} or r.target_id = ${workItemId})
      and sw.deleted_at is null and tw.deleted_at is null
  `;
  const projectIds = [...new Set(rows.flatMap((row) => [row.source_project_id, row.target_project_id]))];
  const visibility = new Map(await Promise.all(projectIds.map(async (projectId) =>
    [projectId, await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrgGrant(actor))] as const)));
  const allowed = (projectId: string) => !allowedProjectIds || allowedProjectIds.includes(projectId);
  const permitted = rows.filter((row) => visibility.get(row.source_project_id) && visibility.get(row.target_project_id)
    && allowed(row.source_project_id) && allowed(row.target_project_id));
  return {
    blocks: permitted.filter((r) => r.type === "BLOCKS" && r.source_id === workItemId)
      .map((r) => ({ id: r.id, workItemId: r.target_id, relatedWorkItemId: r.target_id, projectId: r.target_project_id, key: r.target_key, title: r.target_title })),
    blockedBy: permitted.filter((r) => r.type === "BLOCKS" && r.target_id === workItemId)
      .map((r) => ({ id: r.id, workItemId: r.source_id, relatedWorkItemId: r.source_id, projectId: r.source_project_id, key: r.source_key, title: r.source_title })),
    others: permitted.filter((r) => r.type !== "BLOCKS")
      .map((r) => ({ id: r.id, type: r.type, workItemId: r.source_id === workItemId ? r.target_id : r.source_id,
                     relatedWorkItemId: r.source_id === workItemId ? r.target_id : r.source_id,
                     projectId: r.source_id === workItemId ? r.target_project_id : r.source_project_id,
                     key: r.source_id === workItemId ? r.target_key : r.source_key,
                     title: r.source_id === workItemId ? r.target_title : r.source_title })),
  };
}

export async function removeRelation(actor: Actor, workItemId: string, relId: string): Promise<void> {
  const src = await db.select().from(workItem).where(eq(workItem.id, workItemId)).limit(1);
  if (!src[0] || src[0].deletedAt) throw forbidden();
  await assertVisible(actor, src[0].projectId);
  const visible = await listRelations(actor, workItemId);
  if (![...visible.blocks, ...visible.blockedBy, ...visible.others].some((row) => row.id === relId)) throw forbidden();
  const del = await db.delete(workItemRelation)
    .where(and(eq(workItemRelation.id, relId), or(eq(workItemRelation.sourceId, workItemId), eq(workItemRelation.targetId, workItemId))))
    .returning({ id: workItemRelation.id });
  if (del.length === 0) throw forbidden();
}
