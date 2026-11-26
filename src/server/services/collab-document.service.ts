import { createHash } from "node:crypto";
import { and, eq, gt, sql as drizzleSql } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "../../db/index.ts";
import { deferAfterCommit } from "../../db/context.ts";
import { collabMember, collabRoom, collabSnapshot, collabUpdate } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { publish } from "./events.service.ts";
import {
  assertRoomLogCapacity,
  MAX_ROOM_UPDATE_BYTES,
  MAX_ROOM_UPDATE_COUNT,
  shouldAutoSnapshot,
  validateDocumentUpdate,
} from "./collab-room.service.ts";
import {
  applyDocumentUpdate,
  assertPublishRevision,
  decodeDocumentState,
  createContentUpdate,
  type DocumentBinary,
} from "./collab-document-core.ts";
import type { Actor } from "../permission/actor.ts";
import * as wiki from "./wiki.service.ts";
import * as knowledge from "./knowledge.service.ts";
import { publishProjectEvent, publishResourceEvent, publishRoomEvent } from "./collab-events.service.ts";
import { lockProjectTree } from "./project-tree.ts";
import { loadActor } from "../auth/actor-loader.ts";

export interface DocumentState {
  state: Uint8Array;
  sequence: number;
  baseRevisionId: string | null;
}

export { applyDocumentUpdate, decodeDocumentState, encodeDocumentState } from "./collab-document-core.ts";

export function stateVectorHash(state: DocumentBinary): string {
  const doc = decodeDocumentState(state);
  return createHash("sha256").update(Y.encodeStateVector(doc)).digest("hex");
}

export async function loadDocument(roomId: string): Promise<DocumentState> {
  // 一条查询共享同一 MVCC 快照，避免读取期间发布提交导致旧基线混入新版本增量。
  const [loaded] = await db.execute(drizzleSql`
    with latest_snapshot as (
      select sequence, state_base64, base_revision_id from collab_snapshot
      where room_id = ${roomId} order by sequence desc, created_at desc limit 1
    )
    select
      (select jsonb_build_object('sequence', sequence, 'stateBase64', state_base64, 'baseRevisionId', base_revision_id)
       from latest_snapshot) as snapshot,
      coalesce((select jsonb_agg(jsonb_build_object('sequence', sequence, 'updateBase64', update_base64) order by sequence)
        from collab_update where room_id = ${roomId}
          and sequence > coalesce((select sequence from latest_snapshot), 0)), '[]'::jsonb) as updates
  `) as unknown as { snapshot: { sequence: number; stateBase64: string; baseRevisionId: string | null } | null; updates: { sequence: number; updateBase64: string }[] }[];
  const snapshot = loaded!.snapshot;
  let state: DocumentBinary = snapshot ? Uint8Array.from(Buffer.from(snapshot.stateBase64, "base64")) : new Uint8Array();
  const fromSequence = snapshot?.sequence ?? 0;
  const updates = loaded!.updates;
  for (const item of updates) state = applyDocumentUpdate(state, Uint8Array.from(Buffer.from(item.updateBase64, "base64")));
  return { state, sequence: updates.at(-1)?.sequence ?? fromSequence, baseRevisionId: snapshot?.baseRevisionId ?? null };
}

async function checkLogCapacity(roomId: string, updateBase64: string) {
  const totals = (await db.execute(drizzleSql`
    select count(*)::int as count, coalesce(sum(octet_length(update_base64)), 0)::bigint as bytes
    from collab_update where room_id = ${roomId}
  `) as unknown as { count: number; bytes: string }[])[0] ?? { count: 0, bytes: "0" };
  try { assertRoomLogCapacity(Number(totals.count), Number(totals.bytes), Buffer.byteLength(updateBase64, "utf8")); }
  catch (error) {
    throw new DomainError("CONFLICT", error instanceof Error ? error.message : "协作日志已达上限", {
      roomId, maxUpdates: MAX_ROOM_UPDATE_COUNT, maxBytes: MAX_ROOM_UPDATE_BYTES,
    });
  }
  return Number(totals.bytes) + Buffer.byteLength(updateBase64, "utf8");
}

/** 已发布版本和房间在同一事务内推进；所有页面写入按项目→房间顺序加锁。 */
export async function synchronizePublishedPage(actor: Actor, input: {
  pageId: string; projectId: string; revisionId: string; content?: string;
}) {
  return db.transaction(async tx => {
    await lockProjectTree(input.projectId);
    const room = (await tx.select().from(collabRoom).where(and(eq(collabRoom.resourceType, "PAGE"), eq(collabRoom.resourceId, input.pageId))).limit(1))[0];
    if (!room) return null;
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${room.id}, 0))`);
    const current = await loadDocument(room.id);
    const doc = current.state.byteLength ? decodeDocumentState(current.state) : new Y.Doc();
    const content = input.content ?? (current.state.byteLength ? undefined : (await wiki.getPage(actor, input.pageId)).content);
    // 元数据或相同正文用空增量记录版本边界，保留草稿及旧快照，不重建客户端历史。
    const update = content === undefined ? Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc))
      : createContentUpdate(current.state, content) ?? Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc));
    const state = applyDocumentUpdate(current.state, update);
    const sequence = current.sequence + 1;
    const updateBase64 = Buffer.from(update).toString("base64");
    await checkLogCapacity(room.id, updateBase64);
    const clientId = "server-page-revision";
    const operationId = `revision:${input.revisionId}`;
    await tx.insert(collabUpdate).values({ roomId: room.id, sequence, actorId: actor.memberId, clientId, operationId, updateBase64, stateVectorHash: stateVectorHash(state) });
    await tx.insert(collabSnapshot).values({ roomId: room.id, sequence, stateBase64: Buffer.from(state).toString("base64"), baseRevisionId: input.revisionId });
    await tx.update(collabRoom).set({ baseRevisionId: input.revisionId, snapshotSequence: sequence, updatedAt: new Date() }).where(eq(collabRoom.id, room.id));
    const signal = () => publishToRoomMembers(room.id, "collab.update", { roomId: room.id, sequence, clientId, operationId });
    if (!deferAfterCommit(signal)) await signal();
    return { roomId: room.id, sequence };
  });
}

export async function applyUpdate(input: {
  roomId: string;
  actorId: string;
  clientId: string;
  operationId: string;
  updateBase64: string;
}): Promise<{ sequence: number; duplicate: boolean; stateVectorHash: string }> {
  const room = (await db.select().from(collabRoom).where(eq(collabRoom.id, input.roomId)).limit(1))[0];
  if (!room) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
  const parsed = validateDocumentUpdate({ operationId: input.operationId, updateBase64: input.updateBase64 });
  const result = await db.transaction(async (tx) => {
    if (room.resourceType === "PAGE") {
      await lockProjectTree(room.projectId);
      const actor = await loadActor(input.actorId);
      if (!actor) throw new DomainError("FORBIDDEN", "账号不可用", null);
      await wiki.assertPageWritable(actor, room.resourceId, room.projectId);
    }
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${input.roomId}, 0))`);
    const lockedRoom = (await tx.select().from(collabRoom).where(eq(collabRoom.id, input.roomId)).limit(1))[0];
    if (!lockedRoom) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
    const duplicate = (await tx.select({ sequence: collabUpdate.sequence }).from(collabUpdate).where(and(
      eq(collabUpdate.roomId, input.roomId), eq(collabUpdate.actorId, input.actorId),
      eq(collabUpdate.clientId, input.clientId), eq(collabUpdate.operationId, parsed.operationId),
    )).limit(1))[0];
    if (duplicate) {
      const state = await loadDocument(input.roomId);
      return { sequence: duplicate.sequence, duplicate: true, stateVectorHash: stateVectorHash(state.state) };
    }
    const current = await loadDocument(input.roomId);
    const nextState = applyDocumentUpdate(current.state, parsed.update);
    const sequence = current.sequence + 1;
    const totalBytes = await checkLogCapacity(input.roomId, input.updateBase64);
    const hash = stateVectorHash(nextState);
    await tx.insert(collabUpdate).values({
      roomId: input.roomId, sequence, actorId: input.actorId, clientId: input.clientId,
      operationId: parsed.operationId, updateBase64: input.updateBase64, stateVectorHash: hash,
    });
    if (shouldAutoSnapshot(sequence, totalBytes)) {
      await tx.insert(collabSnapshot).values({
        roomId: input.roomId, sequence, stateBase64: Buffer.from(nextState).toString("base64"), baseRevisionId: lockedRoom.baseRevisionId,
      });
      await tx.update(collabRoom).set({ snapshotSequence: sequence }).where(eq(collabRoom.id, input.roomId));
    }
    await tx.update(collabRoom).set({ updatedAt: new Date() }).where(eq(collabRoom.id, input.roomId));
    return { sequence, duplicate: false, stateVectorHash: hash };
  });
  if (!result.duplicate) await publishToRoomMembers(input.roomId, "collab.update", {
    roomId: input.roomId, sequence: result.sequence, clientId: input.clientId, operationId: parsed.operationId,
  });
  return result;
}

async function publishToRoomMembers(roomId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const joined = await db.select({ memberId: collabMember.memberId }).from(collabMember).where(and(
    eq(collabMember.roomId, roomId), eq(collabMember.connected, true), gt(collabMember.lastSeenAt, new Date(Date.now() - 60_000)),
  ));
  const targets = new Set(joined.map((row) => row.memberId));
  await Promise.all([...targets].map((memberId) => publish(event, data, memberId).catch(() => 0)));
}

export async function createSnapshot(roomId: string): Promise<{ sequence: number; stateBase64: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`);
    const room = (await tx.select().from(collabRoom).where(eq(collabRoom.id, roomId)).limit(1))[0];
    if (!room) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
    const state = await loadDocument(roomId);
    const encoded = Buffer.from(state.state).toString("base64");
    await tx.insert(collabSnapshot).values({ roomId, sequence: state.sequence, stateBase64: encoded, baseRevisionId: room.baseRevisionId }).onConflictDoNothing();
    await tx.update(collabRoom).set({ snapshotSequence: state.sequence, updatedAt: new Date() }).where(eq(collabRoom.id, roomId));
    return { sequence: state.sequence, stateBase64: encoded };
  });
}

export { publishProjectEvent, publishResourceEvent, publishRoomEvent };

type PageIndexing = { status: "SUCCEEDED"; jobId: string; generation: number; embedded: number }
  | { status: "FAILED"; message: string } | { status: "QUEUED" };

/** 调用方须在提交之后执行；失败不会把已提交页面误报为写入失败。 */
export async function finishPagePublication(actor: Actor, input: {
  pageId: string; revisionId: string; roomId?: string; sequence?: number;
}): Promise<PageIndexing> {
  let indexing: PageIndexing;
  try {
    const result = await knowledge.reindexPublishedPage(actor, input.pageId, input.revisionId);
    indexing = { status: "SUCCEEDED", jobId: result.jobId, generation: result.generation, embedded: result.embedded };
  } catch (error) {
    indexing = { status: "FAILED", message: error instanceof Error ? error.message : "知识索引未能启动" };
    console.error("[wiki-index] 已发布版本的知识索引失败", { pageId: input.pageId, revisionId: input.revisionId, message: indexing.message });
  }
  if (input.roomId) await publishRoomEvent(input.roomId, "collab.published", { ...input, indexing });
  return indexing;
}

export async function publishPage(actor: Actor, roomId: string, input: {
  expectedRevisionId: string;
  expectedStructureVersion?: number;
  title?: string;
  changeSummary?: string;
}) {
  const room = (await db.select().from(collabRoom).where(eq(collabRoom.id, roomId)).limit(1))[0];
  if (!room) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
  if (room.resourceType !== "PAGE" || room.mode !== "TEXT_CRDT") {
    throw new DomainError("VALIDATION", "只有页面协作房间支持发布", null);
  }
  await wiki.assertPageWritable(actor, room.resourceId, room.projectId);
  const published = await db.transaction(async (tx) => {
    await lockProjectTree(room.projectId);
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`);
    const lockedRoom = (await tx.select().from(collabRoom).where(eq(collabRoom.id, roomId)).limit(1))[0];
    if (!lockedRoom) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
    assertPublishRevision(lockedRoom.baseRevisionId, input.expectedRevisionId);
    const state = await loadDocument(roomId);
    const doc = decodeDocumentState(state.state);
    const content = doc.getText("content").toString();
    const page = await wiki.updatePage(actor, lockedRoom.resourceId, {
      title: input.title,
      content,
      expectedRevisionId: input.expectedRevisionId,
      expectedStructureVersion: input.expectedStructureVersion,
      changeSummary: input.changeSummary ?? "协作草稿发布",
    }, { collaborationPublish: true });
    const synchronized = await loadDocument(roomId);
    return { page: { ...page, content }, sequence: synchronized.sequence };
  });
  if (!published.page.currentRevisionId) throw new DomainError("VALIDATION", "发布后缺少 revision", null);
  const complete = () => finishPagePublication(actor, { roomId, pageId: published.page.id, revisionId: published.page.currentRevisionId!, sequence: published.sequence });
  const indexing: PageIndexing = deferAfterCommit(complete) ? { status: "QUEUED" } : await complete();
  return { page: published.page, sequence: published.sequence, publishedRevisionId: published.page.currentRevisionId, indexing };
}
