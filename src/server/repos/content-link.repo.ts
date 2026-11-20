/** Low-level cleanup shared by content owners; no domain service callbacks. */
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { workItemLink } from "../../db/schema.ts";
/** 目标删除时的应用层清理（C-15）：两侧都查，避免留下永久孤儿 */
export async function cleanupLinksFor(type: string, id: string): Promise<void> {
  await db.delete(workItemLink).where(or(
    and(eq(workItemLink.sourceType, type), eq(workItemLink.sourceId, id)),
    and(eq(workItemLink.targetType, type), eq(workItemLink.targetId, id)),
  ));
}
