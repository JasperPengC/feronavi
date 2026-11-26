/**
 * 跨域引用链接（数据模型 3.3 / REST 第 3 节）
 *
 * 语义：工作项 ↔ 想法 / 文档 / 里程碑 / 迭代（多态，因此**没有 FK**）。
 * 纪律（C-15 / C-21）：
 *   1 目标必须与工作项**同项目且可见**（否则工作项链接成了跨项目越权入口）；
 *   2 同一对实体只展示一个逻辑引用，创建时双向查重、移除时清理双向行；
 *   3 目标是软删实体时不允许链接；
 *   4 目标删除时**应用层清理**（`cleanupLinksFor`），不做"只靠定时任务兜底"。
 */
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { idea, iteration, milestone, workItem, workItemLink } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { lockProjectTree } from "./project-tree.ts";

export const LINK_TYPES = ["WORK_ITEM", "IDEA", "PAGE", "MILESTONE", "ITERATION"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function loadWorkItem(actor: Actor, id: string) {
  const wi = (await db.select().from(workItem).where(eq(workItem.id, id)).limit(1))[0];
  if (!wi || wi.deletedAt) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, wi.projectId, hasOrg(actor)))) throw forbidden();
  return wi;
}

function assertUpdateAny(actor: Actor, projectId: string): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "work_item:update_any", { projectId, teamId: null }, ctx)) throw forbidden();
}

export interface LinkTarget { type: LinkType; id: string; title: string; key: string | null }

/** 解析目标实体（必须同项目、未软删），返回可展示的标题 */
async function resolveTarget(actor: Actor, type: LinkType, id: string, projectId: string): Promise<LinkTarget> {
  let row: { title: string; key: string | null } | undefined;
  if (type === "WORK_ITEM") {
    const r = (await db.select({ title: workItem.title, key: workItem.key, projectId: workItem.projectId, deletedAt: workItem.deletedAt })
      .from(workItem).where(eq(workItem.id, id)).limit(1))[0];
    if (r && r.projectId === projectId && !r.deletedAt) row = { title: r.title, key: r.key };
  } else if (type === "IDEA") {
    const r = (await db.select({ title: idea.title, projectId: idea.projectId, deletedAt: idea.deletedAt })
      .from(idea).where(eq(idea.id, id)).limit(1))[0];
    if (r && r.projectId === projectId && !r.deletedAt) row = { title: r.title, key: null };
  } else if (type === "PAGE") {
    const { getPage } = await import("./wiki.service.ts");
    const r = await getPage(actor, id);
    if (r.projectId === projectId) row = { title: r.title, key: null };
  } else if (type === "MILESTONE") {
    const r = (await db.select({ name: milestone.name, projectId: milestone.projectId }).from(milestone).where(eq(milestone.id, id)).limit(1))[0];
    if (r && r.projectId === projectId) row = { title: r.name, key: null };
  } else {
    const r = (await db.select({ name: iteration.name, projectId: iteration.projectId }).from(iteration).where(eq(iteration.id, id)).limit(1))[0];
    if (r && r.projectId === projectId) row = { title: r.name, key: null };
  }
  if (!row) throw new DomainError("VALIDATION", "目标不存在或不属于本项目", { type, id });
  return { type, id, title: row.title, key: row.key };
}

export async function listLinks(actor: Actor, workItemId: string) {
  const wi = await loadWorkItem(actor, workItemId);
  const rows = await db.select().from(workItemLink).where(or(
    and(eq(workItemLink.sourceType, "WORK_ITEM"), eq(workItemLink.sourceId, workItemId)),
    and(eq(workItemLink.targetType, "WORK_ITEM"), eq(workItemLink.targetId, workItemId)),
  ));
  const items = [];
  const seen = new Set<string>();
  // 保留历史双向数据，以出向行作为稳定入口；旧单向入向引用仍可展示。
  rows.sort((a, b) => Number(b.sourceType === "WORK_ITEM" && b.sourceId === workItemId)
    - Number(a.sourceType === "WORK_ITEM" && a.sourceId === workItemId) || a.id.localeCompare(b.id));
  for (const r of rows) {
    const otherIsSource = r.targetType === "WORK_ITEM" && r.targetId === workItemId;
    const type = (otherIsSource ? r.sourceType : r.targetType) as LinkType;
    const id = otherIsSource ? r.sourceId : r.targetId;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    try {
      const target = await resolveTarget(actor, type, id, wi.projectId);
      items.push({ id: r.id, direction: otherIsSource ? "incoming" : "outgoing", target });
      seen.add(key);
    } catch {
      // 目标已删但清理还没跑：列表静默跳过孤儿（不把内部不一致暴露给用户）
    }
  }
  return items;
}

/** 创建前与缓存重放前共用来源权限和目标同项目检查。 */
export async function authorizeContentLinkCreate(actor: Actor, workItemId: string, input: { targetType: string; targetId: string }) {
  const wi = await loadWorkItem(actor, workItemId);
  assertUpdateAny(actor, wi.projectId);
  const type = input.targetType as LinkType;
  if (!(LINK_TYPES as readonly string[]).includes(type)) throw new DomainError("VALIDATION", "链接类型不合法", { type });
  if (type === "WORK_ITEM" && input.targetId === workItemId) throw new DomainError("VALIDATION", "不能链接到自身", null);
  return resolveTarget(actor, type, input.targetId, wi.projectId);
}

export async function createLink(actor: Actor, workItemId: string, input: { targetType: string; targetId: string }) {
  const item=await loadWorkItem(actor,workItemId);
  return db.transaction(async()=>{await lockProjectTree(item.projectId);return createLinkLocked(actor,workItemId,input);});
}
async function createLinkLocked(actor: Actor, workItemId: string, input: { targetType: string; targetId: string }) {
  const target = await authorizeContentLinkCreate(actor, workItemId, input);
  const type = input.targetType as LinkType;
  const dup = (await db.select({ id: workItemLink.id }).from(workItemLink).where(or(
    and(eq(workItemLink.sourceType, "WORK_ITEM"), eq(workItemLink.sourceId, workItemId),
      eq(workItemLink.targetType, type), eq(workItemLink.targetId, input.targetId)),
    and(eq(workItemLink.targetType, "WORK_ITEM"), eq(workItemLink.targetId, workItemId),
      eq(workItemLink.sourceType, type), eq(workItemLink.sourceId, input.targetId)),
  )).limit(1))[0];
  if (dup) throw new DomainError("VALIDATION", "该链接已存在", null);
  const [row] = await db.insert(workItemLink).values({
    sourceType: "WORK_ITEM", sourceId: workItemId, targetType: type, targetId: input.targetId,
  }).returning();
  return { id: row!.id, direction: "outgoing", target };
}

export async function authorizeContentLinkDelete(actor: Actor, linkId: string): Promise<void> {
  const link = (await db.select().from(workItemLink).where(eq(workItemLink.id, linkId)).limit(1))[0];
  if (!link) throw forbidden();
  const wiId = link.sourceType === "WORK_ITEM" ? link.sourceId : link.targetType === "WORK_ITEM" ? link.targetId : null;
  if (!wiId) throw forbidden();
  const wi = await loadWorkItem(actor, wiId);
  assertUpdateAny(actor, wi.projectId);
}

export async function deleteLink(actor: Actor, linkId: string): Promise<void> {
  const [link]=await db.select().from(workItemLink).where(eq(workItemLink.id,linkId)).limit(1);
  if(!link)throw forbidden();
  const item=await loadWorkItem(actor,link.sourceType==="WORK_ITEM"?link.sourceId:link.targetId);
  await db.transaction(async()=>{await lockProjectTree(item.projectId);await authorizeContentLinkDelete(actor, linkId);
    await db.delete(workItemLink).where(or(
      and(eq(workItemLink.sourceType, link.sourceType), eq(workItemLink.sourceId, link.sourceId),
        eq(workItemLink.targetType, link.targetType), eq(workItemLink.targetId, link.targetId)),
      and(eq(workItemLink.sourceType, link.targetType), eq(workItemLink.sourceId, link.targetId),
        eq(workItemLink.targetType, link.sourceType), eq(workItemLink.targetId, link.sourceId)),
    ));});
}

export { cleanupLinksFor } from "../repos/content-link.repo.ts";

/** 想法转工作项时写双向引用（单行双向表达会在删除清理时被漏掉，这里显式两行） */
export async function createPromoteLinks(workItemId: string, ideaId: string): Promise<void> {
  await db.insert(workItemLink).values([
    { sourceType: "WORK_ITEM", sourceId: workItemId, targetType: "IDEA", targetId: ideaId },
    { sourceType: "IDEA", sourceId: ideaId, targetType: "WORK_ITEM", targetId: workItemId },
  ]).onConflictDoNothing();
}
