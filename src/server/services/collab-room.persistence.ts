import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { approvalRequest, automationRule, collabMember, collabRoom, collabSnapshot, collabUpdate, comment, idea, iteration, milestone, module, page, release, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as wiki from "./wiki.service.ts";
import * as workItems from "./work-item.service.ts";
import * as planning from "./planning.service.ts";
import * as ideas from "./idea.service.ts";
import { isCollabResourceType, modeForResource, type CollabResourceType, validateClientId } from "./collab-room.service.ts";
import * as Y from "yjs";

async function resolveProjectId(resourceType: CollabResourceType, resourceId: string): Promise<string | null> {
  if (resourceType === "PAGE") return (await db.select({ projectId: page.projectId }).from(page).where(eq(page.id, resourceId)).limit(1))[0]?.projectId ?? null;
  if (resourceType === "WORK_ITEM") return (await db.select({ projectId: workItem.projectId }).from(workItem).where(eq(workItem.id, resourceId)).limit(1))[0]?.projectId ?? null;
  if (resourceType === "APPROVAL") return (await db.select({ projectId: workItem.projectId }).from(approvalRequest).innerJoin(workItem, eq(workItem.id, approvalRequest.workItemId)).where(eq(approvalRequest.id, resourceId)).limit(1))[0]?.projectId ?? null;
  if (resourceType === "AUTOMATION") return (await db.select({ projectId: automationRule.projectId }).from(automationRule).where(eq(automationRule.id, resourceId)).limit(1))[0]?.projectId ?? null;
  if (resourceType === "COMMENT") {
    const row = (await db.select({ targetType: comment.targetType, targetId: comment.targetId }).from(comment).where(eq(comment.id, resourceId)).limit(1))[0];
    if (!row) return null;
    if (row.targetType === "PAGE") return resolveProjectId("PAGE", row.targetId);
    if (row.targetType === "WORK_ITEM") return resolveProjectId("WORK_ITEM", row.targetId);
    if (row.targetType === "IDEA") return (await db.select({ projectId: idea.projectId }).from(idea).where(eq(idea.id, row.targetId)).limit(1))[0]?.projectId ?? null;
    return null;
  }
  for (const table of [milestone, iteration, release, module]) {
    const row = (await db.select({ projectId: table.projectId }).from(table).where(eq(table.id, resourceId)).limit(1))[0];
    if (row) return row.projectId;
  }
  return null;
}

async function assertResourceVisible(actor: Actor, resourceType: CollabResourceType, resourceId: string, projectId: string): Promise<void> {
  if (resourceType === "PAGE") { await wiki.getPage(actor, resourceId); return; }
  if (resourceType === "WORK_ITEM") { await workItems.getWorkItem(actor, resourceId); return; }
  if (resourceType === "COMMENT") {
    const row = (await db.select({ targetType: comment.targetType, targetId: comment.targetId, deletedAt: comment.deletedAt })
      .from(comment).where(eq(comment.id, resourceId)).limit(1))[0];
    if (!row || row.deletedAt) throw new DomainError("NOT_FOUND", "协作资源不存在", null);
    if (row.targetType === "PAGE") await wiki.getPage(actor, row.targetId);
    else if (row.targetType === "WORK_ITEM") await workItems.getWorkItem(actor, row.targetId);
    else if (row.targetType === "IDEA") await ideas.getIdea(actor, row.targetId);
    else throw new DomainError("NOT_FOUND", "协作资源不存在", null);
    return;
  }
  if (resourceType === "APPROVAL") {
    const row = (await db.select({ workItemId: approvalRequest.workItemId }).from(approvalRequest).where(eq(approvalRequest.id, resourceId)).limit(1))[0];
    if (!row) throw new DomainError("NOT_FOUND", "协作资源不存在", null);
    await workItems.getWorkItem(actor, row.workItemId);
    return;
  }
  if (resourceType === "PLAN") {
    for (const [kind, table] of [["milestone", milestone], ["iteration", iteration], ["release", release], ["module", module]] as const) {
      const row = (await db.select({ id: table.id }).from(table).where(eq(table.id, resourceId)).limit(1))[0];
      if (row) { await planning.get(actor, resourceId, kind); return; }
    }
    throw new DomainError("NOT_FOUND", "协作资源不存在", null);
  }
  const org = actor.grants.some((grant) => grant.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, org))) throw forbidden();
  const rule = (await db.select({ id: automationRule.id }).from(automationRule).where(and(eq(automationRule.id, resourceId), eq(automationRule.projectId, projectId))).limit(1))[0];
  if (!rule) throw new DomainError("NOT_FOUND", "协作资源不存在", null);
}

async function assertVisible(actor: Actor, room: typeof collabRoom.$inferSelect): Promise<void> {
  await assertResourceVisible(actor, room.resourceType as CollabResourceType, room.resourceId, room.projectId);
}

export async function getRoom(actor: Actor, resourceType: string, resourceId: string) {
  if (!isCollabResourceType(resourceType)) throw new DomainError("VALIDATION", "不支持的协作资源类型", null);
  const room = (await db.select().from(collabRoom).where(and(eq(collabRoom.resourceType, resourceType), eq(collabRoom.resourceId, resourceId))).limit(1))[0];
  if (!room) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
  await assertVisible(actor, room);
  return room;
}

export async function getOrCreateRoom(actor: Actor, resourceType: string, resourceId: string) {
  if (!isCollabResourceType(resourceType)) throw new DomainError("VALIDATION", "不支持的协作资源类型", null);
  const existing = (await db.select().from(collabRoom).where(and(eq(collabRoom.resourceType, resourceType), eq(collabRoom.resourceId, resourceId))).limit(1))[0];
  if (existing) await assertVisible(actor, existing);
  const projectId = existing?.projectId ?? await resolveProjectId(resourceType, resourceId);
  if (!projectId) throw new DomainError("NOT_FOUND", "协作资源不存在", null);
  const currentPage = resourceType === "PAGE" ? await wiki.getPage(actor, resourceId) : null;
  if (!currentPage) await assertResourceVisible(actor, resourceType, resourceId, projectId);
  const [created] = existing ? [undefined] : await db.insert(collabRoom).values({
    resourceType, resourceId, projectId, mode: modeForResource(resourceType),
    baseRevisionId: currentPage?.currentRevisionId ?? null,
  }).onConflictDoNothing({ target: [collabRoom.resourceType, collabRoom.resourceId] }).returning();
  const room = existing ?? created ?? (await db.select().from(collabRoom)
    .where(and(eq(collabRoom.resourceType, resourceType), eq(collabRoom.resourceId, resourceId))).limit(1))[0];
  if (!room) throw new DomainError("CONFLICT", "协作房间创建冲突，请重试", null);
  await assertVisible(actor, room);
  if (currentPage) await db.transaction(async (tx) => {
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${room.id}, 0))`);
    const hasSnapshot = (await tx.select({ id: collabSnapshot.id }).from(collabSnapshot).where(eq(collabSnapshot.roomId, room.id)).limit(1))[0];
    const hasUpdates = (await tx.select({ id: collabUpdate.id }).from(collabUpdate).where(eq(collabUpdate.roomId, room.id)).limit(1))[0];
    if (!hasSnapshot && !hasUpdates) {
      const doc = new Y.Doc();
      if (currentPage.content) doc.getText("content").insert(0, currentPage.content);
      await tx.insert(collabSnapshot).values({
        roomId: room.id, sequence: 0, stateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
        baseRevisionId: currentPage.currentRevisionId,
      });
    }
  });
  return room;
}

export async function canWriteRoom(actor: Actor, room: typeof collabRoom.$inferSelect): Promise<boolean> {
  if (room.mode !== "TEXT_CRDT") return false;
  if (room.resourceType === "PAGE") {
    try { await wiki.assertPageWritable(actor, room.resourceId, room.projectId); return true; }
    catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN") return false;
      throw error;
    }
  }
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  return can(actor, "project:update", { projectId: room.projectId, teamId: null }, ctx);
}

export async function joinRoom(actor: Actor, resourceType: string, resourceId: string, clientId: string) {
  const validatedClientId = validateClientId(clientId);
  const room = await getOrCreateRoom(actor, resourceType, resourceId);
  const write = await canWriteRoom(actor, room);
  await db.insert(collabMember).values({ roomId: room.id, memberId: actor.memberId, clientId: validatedClientId, connected: true, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: [collabMember.roomId, collabMember.memberId, collabMember.clientId], set: { connected: true, lastSeenAt: new Date() } });
  return { room, canWrite: write };
}

export async function heartbeatRoom(actor: Actor, resourceType: string, resourceId: string, clientId: string) {
  const validatedClientId = validateClientId(clientId);
  const room = await getRoom(actor, resourceType, resourceId);
  const updated = await db.update(collabMember).set({ connected: true, lastSeenAt: new Date() })
    .where(and(eq(collabMember.roomId, room.id), eq(collabMember.memberId, actor.memberId), eq(collabMember.clientId, validatedClientId)))
    .returning({ roomId: collabMember.roomId });
  if (!updated[0]) throw new DomainError("FORBIDDEN", "请先加入协作房间", null);
  return { ok: true, roomId: room.id };
}

export async function leaveRoom(actor: Actor, resourceType: string, resourceId: string, clientId: string) {
  const validatedClientId = validateClientId(clientId);
  const room = await getRoom(actor, resourceType, resourceId);
  await db.update(collabMember).set({ connected: false, lastSeenAt: new Date() })
    .where(and(eq(collabMember.roomId, room.id), eq(collabMember.memberId, actor.memberId), eq(collabMember.clientId, validatedClientId)));
  return { ok: true, roomId: room.id };
}
