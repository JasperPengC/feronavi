import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, inTransaction } from "../../db/index.ts";
import { ragConversation, ragMessage, workItem } from "../../db/schema.ts";

export type ConversationRow = typeof ragConversation.$inferSelect;
export type MessageRow = typeof ragMessage.$inferSelect;
export async function insertConversation(data: typeof ragConversation.$inferInsert) {
  return (await db.insert(ragConversation).values(data).returning())[0]!;
}
export async function findConversation(ownerId: string, id: string) {
  return (await db.select().from(ragConversation).where(and(eq(ragConversation.id, id), eq(ragConversation.ownerId, ownerId))).limit(1))[0] ?? null;
}
export async function listConversations(ownerId: string, deleted: boolean, page: number, pageSize: number, allowedProjectIds?: string[]) {
  const condition = and(eq(ragConversation.ownerId, ownerId), deleted ? isNotNull(ragConversation.deletedAt) : isNull(ragConversation.deletedAt), allowedProjectIds !== undefined ? (allowedProjectIds.length ? inArray(ragConversation.projectId, allowedProjectIds) : sql`false`) : undefined);
  const [rows, count] = await Promise.all([
    db.select().from(ragConversation).where(condition).orderBy(desc(ragConversation.updatedAt), desc(ragConversation.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(ragConversation).where(condition),
  ]);
  return { rows, total: count[0]?.total ?? 0 };
}
/** 所有认领、取消、软删除和完成共用此行锁；绝不跨模型调用持有。 */
export async function withConversationLock<T>(ownerId: string, id: string, callback: (row: ConversationRow | null) => Promise<T>): Promise<T> {
  return inTransaction(async () => {
    const row = (await db.select().from(ragConversation).where(and(eq(ragConversation.id, id), eq(ragConversation.ownerId, ownerId))).for("update").limit(1))[0] ?? null;
    return callback(row);
  });
}
export async function updateConversation(id: string, patch: Partial<Pick<ConversationRow, "title" | "titleIsDefault" | "deletedAt">>) {
  return (await db.update(ragConversation).set({ ...patch, updatedAt: new Date() }).where(eq(ragConversation.id, id)).returning())[0]!;
}
/** 游标必须属于当前会话。时间戳相同用UUID稳定排序，避免翻页重叠。 */
export async function listMessages(conversationId: string, limit: number, before?: string): Promise<MessageRow[]> {
  let cursor;
  if (before) {
    cursor = (await db.select({ createdAt: ragMessage.createdAt, id: ragMessage.id }).from(ragMessage)
      .where(and(eq(ragMessage.conversationId, conversationId), eq(ragMessage.id, before))).limit(1))[0];
    if (!cursor) return [];
  }
  return db.select().from(ragMessage).where(and(eq(ragMessage.conversationId, conversationId), cursor
    ? sql`(${ragMessage.createdAt}, ${ragMessage.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined))
    .orderBy(desc(ragMessage.createdAt), desc(ragMessage.id)).limit(limit);
}
export async function findMessage(conversationId: string, requestId: string) {
  return (await db.select().from(ragMessage).where(and(eq(ragMessage.conversationId, conversationId), eq(ragMessage.requestId, requestId))).limit(1))[0] ?? null;
}
export async function insertMessage(data: typeof ragMessage.$inferInsert) {
  return (await db.insert(ragMessage).values(data).returning())[0]!;
}
export async function updateMessage(id: string, patch: Partial<Pick<MessageRow, "status" | "reply" | "question">>) {
  return (await db.update(ragMessage).set({ ...patch, updatedAt: new Date() }).where(eq(ragMessage.id, id)).returning())[0]!;
}
export async function expirePending(conversationId: string, cutoff: Date) {
  return (await db.update(ragMessage).set({ status: "failed", reply: null, updatedAt: new Date() }).where(and(eq(ragMessage.conversationId, conversationId), eq(ragMessage.status, "pending"), lt(ragMessage.updatedAt, cutoff))).returning({ id: ragMessage.id })).length;
}
export async function findPending(conversationId: string) {
  return (await db.select().from(ragMessage).where(and(eq(ragMessage.conversationId, conversationId), eq(ragMessage.status, "pending"))).limit(1))[0] ?? null;
}
export async function cancelPending(conversationId: string) {
  await db.update(ragMessage).set({ status: "cancelled", reply: null, updatedAt: new Date() }).where(and(eq(ragMessage.conversationId, conversationId), eq(ragMessage.status, "pending")));
}

/** Snapshot recheck and mutation share the same row lock and outer transaction. */
export async function lockWorkItem(id:string){await db.select({id:workItem.id}).from(workItem).where(eq(workItem.id,id)).for('update').limit(1);}
