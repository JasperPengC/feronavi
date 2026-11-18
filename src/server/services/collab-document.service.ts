import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, sql as drizzleSql } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "../../db/index.ts";
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
  type DocumentBinary,
} from "./collab-document-core.ts";
import type { Actor } from "../permission/actor.ts";
import * as wiki from "./wiki.service.ts";
import * as knowledge from "./knowledge.service.ts";

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
  const snapshot = (await db.select().from(collabSnapshot)
    .where(eq(collabSnapshot.roomId, roomId)).orderBy(desc(collabSnapshot.sequence), desc(collabSnapshot.createdAt)).limit(1))[0];
  let state: DocumentBinary = snapshot ? Uint8Array.from(Buffer.from(snapshot.stateBase64, "base64")) : new Uint8Array();
  const fromSequence = snapshot?.sequence ?? 0;
  const updates = await db.select().from(collabUpdate)
    .where(and(eq(collabUpdate.roomId, roomId), gt(collabUpdate.sequence, fromSequence)))
    .orderBy(asc(collabUpdate.sequence));
  for (const item of updates) state = applyDocumentUpdate(state, Uint8Array.from(Buffer.from(item.updateBase64, "base64")));
  return { state, sequence: updates.at(-1)?.sequence ?? fromSequence, baseRevisionId: snapshot?.baseRevisionId ?? null };
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
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${input.roomId}, 0))`);
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
    const totals = (await tx.execute(drizzleSql`
      select count(*)::int as count, coalesce(sum(octet_length(update_base64)), 0)::bigint as bytes
      from collab_update where room_id = ${input.roomId}
    `) as unknown as { count: number; bytes: string }[])[0] ?? { count: 0, bytes: "0" };
    try {
      assertRoomLogCapacity(Number(totals.count), Number(totals.bytes), Buffer.byteLength(input.updateBase64, "utf8"));
    } catch (error) {
      throw new DomainError("CONFLICT", error instanceof Error ? error.message : "协作日志已达上限", {
        roomId: input.roomId, maxUpdates: MAX_ROOM_UPDATE_COUNT, maxBytes: MAX_ROOM_UPDATE_BYTES,
      });
    }
    const hash = stateVectorHash(nextState);
    await tx.insert(collabUpdate).values({
      roomId: input.roomId, sequence, actorId: input.actorId, clientId: input.clientId,
      operationId: parsed.operationId, updateBase64: input.updateBase64, stateVectorHash: hash,
    });
    const totalBytes = Number(totals.bytes) + Buffer.byteLength(input.updateBase64, "utf8");
    if (shouldAutoSnapshot(sequence, totalBytes)) {
      await tx.insert(collabSnapshot).values({
        roomId: input.roomId, sequence, stateBase64: Buffer.from(nextState).toString("base64"), baseRevisionId: room.baseRevisionId,
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
  const room = (await db.select().from(collabRoom).where(eq(collabRoom.id, roomId)).limit(1))[0];
  if (!room) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
  const state = await loadDocument(roomId);
  const encoded = Buffer.from(state.state).toString("base64");
  await db.transaction(async (tx) => {
    await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`);
    await tx.insert(collabSnapshot).values({ roomId, sequence: state.sequence, stateBase64: encoded, baseRevisionId: room.baseRevisionId }).onConflictDoNothing();
    await tx.update(collabRoom).set({ snapshotSequence: state.sequence, updatedAt: new Date() }).where(eq(collabRoom.id, roomId));
  });
  return { sequence: state.sequence, stateBase64: encoded };
}

export async function publishRoomEvent(roomId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const joined = await db.select({ memberId: collabMember.memberId }).from(collabMember).where(and(
    eq(collabMember.roomId, roomId), eq(collabMember.connected, true), gt(collabMember.lastSeenAt, new Date(Date.now() - 60_000)),
  ));
  await Promise.all([...new Set(joined.map((row) => row.memberId))].map((memberId) => publish(event, data, memberId).catch(() => 0)));
}

export async function publishPage(actor: Actor, roomId: string, input: {
  expectedRevisionId: string;
  title?: string;
  changeSummary?: string;
}) {
  const room = (await db.select().from(collabRoom).where(eq(collabRoom.id, roomId)).limit(1))[0];
  if (!room) throw new DomainError("NOT_FOUND", "协作房间不存在", null);
  if (room.resourceType !== "PAGE" || room.mode !== "TEXT_CRDT") {
    throw new DomainError("VALIDATION", "只有页面协作房间支持发布", null);
  }
  await wiki.assertPageWritable(actor, room.resourceId, room.projectId);
  assertPublishRevision(room.baseRevisionId, input.expectedRevisionId);
  const published = await db.transaction(async (tx) => {
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
      changeSummary: input.changeSummary ?? "协作草稿发布",
    });
    const stateBase64 = Buffer.from(state.state).toString("base64");
    await tx.insert(collabSnapshot).values({
      roomId, sequence: state.sequence, stateBase64, baseRevisionId: page.currentRevisionId,
    }).onConflictDoNothing();
    await tx.update(collabRoom).set({
      baseRevisionId: page.currentRevisionId, snapshotSequence: state.sequence, updatedAt: new Date(),
    }).where(eq(collabRoom.id, roomId));
    return { page, sequence: state.sequence, stateBase64 };
  });
  let indexing: { status: "SUCCEEDED"; jobId: string; generation: number; embedded: number } | { status: "FAILED"; message: string };
  try {
    if (!published.page.currentRevisionId) throw new DomainError("VALIDATION", "发布后缺少 revision", null);
    const result = await knowledge.reindexPublishedPage(actor, published.page.id, published.page.currentRevisionId);
    indexing = { status: "SUCCEEDED", jobId: result.jobId, generation: result.generation, embedded: result.embedded };
  } catch (error) {
    indexing = { status: "FAILED", message: error instanceof Error ? error.message : "知识索引未能启动" };
  }
  await publishRoomEvent(roomId, "collab.published", {
    roomId, pageId: published.page.id, revisionId: published.page.currentRevisionId, sequence: published.sequence, indexing,
  });
  return { page: published.page, sequence: published.sequence, publishedRevisionId: published.page.currentRevisionId, indexing };
}
