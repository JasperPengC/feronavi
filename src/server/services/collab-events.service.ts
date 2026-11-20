import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { collabMember, collabRoom } from "../../db/schema.ts";
import { publish } from "./events.service.ts";
import { deferAfterCommit } from "../../db/context.ts";

export async function publishRoomEvent(roomId: string, event: string, data: Record<string, unknown>): Promise<void> {
  if (deferAfterCommit(() => publishRoomEventNow(roomId, event, data))) return;
  return publishRoomEventNow(roomId, event, data);
}
async function publishRoomEventNow(roomId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const [room] = await db.select().from(collabRoom).where(eq(collabRoom.id, roomId)).limit(1);
  if (!room) return;
  const joined = await db.select({ memberId: collabMember.memberId }).from(collabMember).where(and(
    eq(collabMember.roomId, roomId), eq(collabMember.connected, true), gt(collabMember.lastSeenAt, new Date(Date.now() - 60_000)),
  ));
  await Promise.all([...new Set(joined.map((row) => row.memberId))].map((memberId) => publish(event, data, memberId, {
    projectId: room.projectId, resourceType: room.resourceType, resourceId: room.resourceId,
  }).catch(() => 0)));
}

export async function publishResourceEvent(resourceType: string, resourceId: string, event: string, data: Record<string, unknown>): Promise<void> {
  if (deferAfterCommit(() => publishResourceEventNow(resourceType, resourceId, event, data))) return;
  return publishResourceEventNow(resourceType, resourceId, event, data);
}
async function publishResourceEventNow(resourceType: string, resourceId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const room = (await db.select({ id: collabRoom.id }).from(collabRoom).where(and(
    eq(collabRoom.resourceType, resourceType), eq(collabRoom.resourceId, resourceId),
  )).limit(1))[0];
  if (room) await publishRoomEvent(room.id, event, data);
}

export async function publishProjectEvent(projectId: string, event: string, data: Record<string, unknown>): Promise<void> {
  if (deferAfterCommit(() => publishProjectEventNow(projectId, event, data))) return;
  return publishProjectEventNow(projectId, event, data);
}
async function publishProjectEventNow(projectId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const rooms = await db.select({ id: collabRoom.id }).from(collabRoom).where(eq(collabRoom.projectId, projectId));
  if (!rooms.length) return;
  const joined = await db.select({ memberId: collabMember.memberId }).from(collabMember).where(and(
    inArray(collabMember.roomId, rooms.map((room) => room.id)),
    eq(collabMember.connected, true), gt(collabMember.lastSeenAt, new Date(Date.now() - 60_000)),
  ));
  await Promise.all([...new Set(joined.map((row) => row.memberId))].map((memberId) => publish(event, data, memberId, {
    projectId, resourceType: "PROJECT", resourceId: projectId,
  }).catch(() => 0)));
}
