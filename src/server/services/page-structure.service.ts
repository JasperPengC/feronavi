import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { page } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { organizePageSchema, type OrganizePageInput } from "../../shared/schemas/page-structure.ts";
import type { Actor } from "../permission/actor.ts";
import { assertTreeParent, lockProjectTree } from "./project-tree.ts";
import { allocateSlug, assertCanWrite, getPage, syncSearchVector } from "./wiki.service.ts";
import { recordBusinessEvent } from "./event-log.ts";

/** 结构与正文分别做版本检查；所有树操作持有同一项目锁。目录不继承或扩大 ACL。 */
export async function organizePage(actor: Actor, id: string, input: OrganizePageInput) {
  const parsed = organizePageSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "目录操作参数不合法", parsed.error.issues);
  const initial = await getPage(actor, id);
  return db.transaction(async () => {
    await lockProjectTree(initial.projectId);
    const current = await getPage(actor, id);
    await assertCanWrite(actor, id, current.projectId);
    if (current.structureVersion !== input.expectedStructureVersion) {
      throw new DomainError("VERSION_CONFLICT", "目录已被其他人整理，请刷新后重试", { expected: input.expectedStructureVersion, actual: current.structureVersion });
    }
    if (input.archived === undefined && current.isArchived) {
      throw new DomainError("VALIDATION", "已归档内容不能整理，请先恢复", null);
    }
    if (input.parentId) {
      await assertTreeParent("page", current.projectId, input.parentId, id);
      const parent = await getPage(actor, input.parentId);
      if (parent.isArchived) throw new DomainError("VALIDATION", "不能移动到已归档目录", null);
    }
    if (input.archived !== undefined) {
      if (!input.archived && current.parentId) {
        // 只检查状态，不把不可见的祖先标题带回错误信息。
        const [ancestor] = await db.execute<{ id: string }>(sql`select id from archived_page where id = ${current.parentId}`);
        if (ancestor) throw new DomainError("VALIDATION", "请先恢复上级目录", null);
      }
      const subtree = await db.execute<{ id: string }>(sql`
        with recursive nodes as (
          select id from page where id = ${id}
          union
          select p.id from page p join nodes n on p.parent_id = n.id
          where p.project_id = ${current.projectId} and p.deleted_at is null
        ) select id from nodes`);
      for (const node of subtree) {
        await getPage(actor, node.id);
        await assertCanWrite(actor, node.id, current.projectId);
      }
    }
    const title = input.title ?? current.title;
    const [updated] = await db.update(page).set({
      title,
      slug: title === current.title ? current.slug : await allocateSlug(current.projectId, title, id),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      structureVersion: current.structureVersion + 1, updatedAt: new Date(),
    }).where(and(eq(page.id, id), eq(page.structureVersion, input.expectedStructureVersion), isNull(page.deletedAt))).returning();
    if (!updated) throw new DomainError("VERSION_CONFLICT", "目录已变更，请刷新后重试", null);
    if (current.kind === "DOCUMENT" && title !== current.title) await syncSearchVector(db, id, title, current.content);
    await recordBusinessEvent({ actor, action: "wiki.organized", targetType: "PAGE", targetId: id, projectId: current.projectId,
      summary: `${actor.name} ${input.archived === true ? "归档" : input.archived === false ? "恢复" : "整理"}了${current.kind === "FOLDER" ? "文件夹" : "文档"}「${title}」` });
    return getPage(actor, id);
  });
}
