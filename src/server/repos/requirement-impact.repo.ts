import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, sql } from "../../db/index.ts";
import { iteration, milestone, release } from "../../db/schema.ts";
import type { RequirementImpactSnapshot } from "../../shared/schemas/requirement-change.ts";

type Root = {
  id: string;
  projectId: string;
  milestoneId: string | null;
  iterationId: string | null;
  releaseId: string | null;
};
export const impactFingerprint = (items: RequirementImpactSnapshot[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        items
          .map((i) => ({
            kind: i.kind,
            targetId: i.targetId,
            title: i.title,
            key: i.key,
            ownerId: i.ownerId,
            sourceVersion: i.sourceVersion,
          }))
          .sort((a, b) =>
            (a.kind + ":" + a.targetId).localeCompare(
              b.kind + ":" + b.targetId,
            ),
          ),
      ),
    )
    .digest("hex");

/** 同项目结构；写入方共享项目树锁，locked时再稳定影响对象的元数据。 */
export async function collectRequirementImpacts(
  root: Root,
  locked = false,
): Promise<RequirementImpactSnapshot[]> {
  const items = await sql<
    {
      id: string;
      title: string;
      key: string;
      assignee_id: string | null;
      version: number;
      milestone_id: string | null;
      iteration_id: string | null;
      release_id: string | null;
    }[]
  >`
    with recursive descendants as (
      select id from work_item where id=${root.id} and project_id=${root.projectId} and deleted_at is null
      union select w.id from work_item w join descendants d on w.parent_id=d.id where w.project_id=${root.projectId} and w.deleted_at is null
    ), affected as (
      select id from descendants
      union select case when source_id=${root.id} then target_id else source_id end from work_item_relation where source_id=${root.id} or target_id=${root.id}
      union select case when source_id=${root.id} then target_id else source_id end from work_item_link
        where source_type='WORK_ITEM' and target_type='WORK_ITEM' and (source_id=${root.id} or target_id=${root.id})
    )
    select w.id,w.title,w.key,w.assignee_id,w.version,w.milestone_id,w.iteration_id,w.release_id
    from work_item w join affected a on a.id=w.id
    where w.project_id=${root.projectId} and w.id<>${root.id} and w.deleted_at is null
    order by w.id ${locked ? sql`for share of w` : sql``}
  `;
  const snapshots: RequirementImpactSnapshot[] = items.map((row) => ({
    kind: "WORK_ITEM",
    targetId: row.id,
    title: row.title,
    key: row.key,
    ownerId: row.assignee_id,
    sourceVersion: String(row.version),
  }));
  const links = await sql<{ kind: string; id: string }[]>`
    select target_type kind,target_id id from work_item_link where source_type='WORK_ITEM' and source_id=${root.id} and target_type in ('MILESTONE','ITERATION')
    union select source_type kind,source_id id from work_item_link where target_type='WORK_ITEM' and target_id=${root.id} and source_type in ('MILESTONE','ITERATION')
  `;
  const groups = [
    {
      kind: "MILESTONE" as const,
      table: milestone,
      ids: [root.milestoneId, ...items.map((i) => i.milestone_id)],
    },
    {
      kind: "ITERATION" as const,
      table: iteration,
      ids: [root.iterationId, ...items.map((i) => i.iteration_id)],
    },
    {
      kind: "RELEASE" as const,
      table: release,
      ids: [root.releaseId, ...items.map((i) => i.release_id)],
    },
  ];
  for (const group of groups) {
    const ids = [
      ...new Set(
        [
          ...group.ids,
          ...links.filter((l) => l.kind === group.kind).map((l) => l.id),
        ].filter((id): id is string => !!id),
      ),
    ];
    if (!ids.length) continue;
    // 三个计划表有相同归属/命名字段，实际SELECT列由运行时表对象提供。
    const table = group.table as typeof milestone;
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.projectId, root.projectId), inArray(table.id, ids)));
    for (const row of rows) {
      const normalized = Object.fromEntries(
        Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
      );
      snapshots.push({
        kind: group.kind,
        targetId: row.id,
        title: row.name,
        key: null,
        ownerId: null,
        sourceVersion: createHash("sha256")
          .update(JSON.stringify(normalized))
          .digest("hex"),
      });
    }
  }
  const cases=await sql<{id:string;title:string;owner_id:string|null;version:number;key:string}[]>`
    select c.id,c.title,c.owner_id,c.version,p.key||'-TC-'||c.number as key
    from test_case c join test_case_requirement r on r.case_revision_id=c.current_revision_id
    join project p on p.id=c.project_id
    where r.work_item_id=${root.id} and c.project_id=${root.projectId} and c.status<>'ARCHIVED'
    order by c.id ${locked?sql`for share of c`:sql``}`;
  snapshots.push(...cases.map(c=>({kind:"TEST_CASE" as const,targetId:c.id,title:c.title,key:c.key,ownerId:c.owner_id,sourceVersion:String(c.version)})));
  return snapshots.sort((a, b) =>
    (a.kind + ":" + a.targetId).localeCompare(b.kind + ":" + b.targetId),
  );
}
