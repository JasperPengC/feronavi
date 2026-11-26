import { and, desc, eq, lt, sql as dsql } from "drizzle-orm";
import { db, sql } from "../../db/index.ts";
import { member, requirementRevision as revision } from "../../db/schema.ts";

/** 调用方持有工作项行锁（创建或CAS更新），并在同一事务内调用。 */
export async function appendRevision(item: { id: string; version: number; title: string; description: string | null }, authorId: string, source: "INITIAL" | "EDIT") {
  const [latest] = await db.select({ revisionNo: revision.revisionNo }).from(revision)
    .where(eq(revision.workItemId, item.id)).orderBy(desc(revision.revisionNo)).limit(1);
  await db.insert(revision).values({ workItemId: item.id, revisionNo: (latest?.revisionNo ?? 0) + 1,
    workItemVersion: item.version, title: item.title, description: item.description, authorId, source });
}

const metadata = {
  id: revision.id, workItemId: revision.workItemId, revisionNo: revision.revisionNo,
  workItemVersion: revision.workItemVersion, title: revision.title, authorId: revision.authorId,
  authorName: member.name, source: revision.source, createdAt: revision.createdAt,
};
export function listRevisions(workItemId: string, limit: number, before?: number) {
  return db.select(metadata).from(revision).leftJoin(member, eq(member.id, revision.authorId))
    .where(and(eq(revision.workItemId, workItemId), before === undefined ? undefined : lt(revision.revisionNo, before)))
    .orderBy(desc(revision.revisionNo)).limit(limit + 1);
}
export async function findRevision(workItemId: string, id: string) {
  const [row] = await db.select({ ...metadata, description: revision.description }).from(revision)
    .leftJoin(member, eq(member.id, revision.authorId)).where(and(eq(revision.workItemId, workItemId), eq(revision.id, id)));
  return row;
}

/** 仅旧备份导入事务调用；尚无正文历史时捕获恢复后的当前内容。 */
export async function captureRestoredBaselines() {
  await db.execute(dsql`insert into requirement_revision(work_item_id, revision_no, work_item_version, title, description, author_id, source)
    select w.id, 1, w.version, w.title, w.description, null, 'BASELINE' from work_item w
    where w.type='REQUIREMENT' and not exists (select 1 from requirement_revision r where r.work_item_id=w.id)`);
}

/** 恢复包携带历史时，验证其末版与当前需求正文相符。 */
export async function restoredHistoryIsConsistent() {
  const invalid = await sql`select 1 from work_item w left join lateral
    (select title, description, work_item_version from requirement_revision r where r.work_item_id=w.id order by revision_no desc limit 1) latest on true
    where w.type='REQUIREMENT' and (latest.work_item_version is null or latest.work_item_version>w.version
      or latest.title is distinct from w.title or latest.description is distinct from w.description)
    union all select 1 from requirement_revision r join work_item w on w.id=r.work_item_id where w.type<>'REQUIREMENT' limit 1`;
  return invalid.length === 0;
}
