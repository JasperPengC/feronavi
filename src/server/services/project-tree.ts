import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { DomainError } from "../../shared/errors.ts";

type TreeKind = "module" | "page" | "work_item";

/** 调用者必须在事务内持锁至写入完成，避免两个合法快照并发合成父子环。 */
export async function lockProjectTree(projectId: string): Promise<void> {
  await db.execute(sql`select id from project where id = ${projectId} for update`);
}

export async function assertTreeParent(kind: TreeKind, projectId: string, parentId: string, childId?: string): Promise<void> {
  const seen = new Set<string>(childId ? [childId] : []);
  let cursor: string | null = parentId;
  while (cursor) {
    if (seen.has(cursor)) throw new DomainError("VALIDATION", "父子关系成环", null);
    seen.add(cursor);
    const active = kind === "module" ? sql`archived_at is null` : sql`deleted_at is null`;
    const rows: { parent_id: string | null; project_id: string }[] = await db.execute<{ parent_id: string | null; project_id: string }>(sql`
      select parent_id, project_id from ${sql.raw(kind)} where id = ${cursor} and ${active}
    `);
    const parent: { parent_id: string | null; project_id: string } | undefined = rows[0];
    if (!parent || parent.project_id !== projectId) {
      throw new DomainError("VALIDATION", "父级不存在、已归档或不属于同一项目", null);
    }
    cursor = parent.parent_id;
  }
}
