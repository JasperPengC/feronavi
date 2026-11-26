import { z } from "zod";
import { sql } from "../../../db/index.ts";
import {
  impactKindSchema,
  type RequirementImpactSnapshot,
} from "../../../shared/schemas/requirement-change.ts";
import { impactFingerprint } from "../../repos/requirement-impact.repo.ts";

const snapshotSchema = z
  .object({
    kind: impactKindSchema,
    targetId: z.uuid(),
    title: z.string(),
    key: z.string().nullable(),
    ownerId: z.uuid().nullable(),
    sourceVersion: z.string().min(1),
  })
  .strict();

/** 恢复保留历史快照；已删除的影响对象可缺失，尚存对象必须属于同一项目。 */
export async function restoredChangesAreConsistent(): Promise<boolean> {
  const bad = await sql`select 1 from requirement_change c
    join work_item w on w.id=c.work_item_id join requirement_revision b on b.id=c.base_revision_id
    left join requirement_revision a on a.id=c.applied_revision_id
    where w.type<>'REQUIREMENT' or w.project_id<>c.project_id or b.work_item_id<>w.id
      or b.work_item_version>c.requested_work_item_version or c.requested_work_item_version>w.version
      or c.proposed_title='' or c.reason=''
      or (c.status in ('APPROVED','REJECTED','APPLIED') and c.decided_at is null)
      or (c.status='PENDING' and (c.decided_at is not null or c.decided_by is not null or c.review_note is not null))
      or ((c.status='CANCELLED')<>(c.cancelled_at is not null))
      or (c.status<>'CANCELLED' and (c.cancelled_by is not null or c.cancel_note is not null))
      or (c.status<>'APPLIED' and (c.applied_at is not null or c.applied_by is not null or c.applied_revision_id is not null))
      or c.decided_at<c.created_at or c.applied_at<c.decided_at or c.cancelled_at<c.created_at
      or (c.status='APPLIED' and (a.work_item_id<>w.id or a.revision_no<>b.revision_no+1
        or a.work_item_version<=c.requested_work_item_version or a.work_item_version>w.version
        or a.title is distinct from c.proposed_title or a.description is distinct from c.proposed_description))
    union all select 1 from requirement_change_impact i join requirement_change c on c.id=i.change_id
    where (i.acknowledged_at is not null and (c.status<>'APPLIED' or i.acknowledged_at<c.applied_at))
      or (i.acknowledged_at is null and (i.acknowledged_by is not null or i.note is not null))
    limit 1`;
  if (bad.length) return false;
  const wrongProjects =
    await sql`select 1 from requirement_change_impact i join requirement_change c on c.id=i.change_id
    left join work_item w on i.kind='WORK_ITEM' and w.id=i.target_id
    left join milestone m on i.kind='MILESTONE' and m.id=i.target_id
    left join iteration t on i.kind='ITERATION' and t.id=i.target_id
    left join release r on i.kind='RELEASE' and r.id=i.target_id
    left join test_case tc on i.kind='TEST_CASE' and tc.id=i.target_id
    where coalesce(w.project_id,m.project_id,t.project_id,r.project_id,tc.project_id,c.project_id)<>c.project_id
      or (i.kind='WORK_ITEM' and i.target_id=c.work_item_id) limit 1`;
  if (wrongProjects.length) return false;
  const snapshots = new Map<string, RequirementImpactSnapshot[]>();
  for (const row of await sql`select change_id,kind,target_id,snapshot from requirement_change_impact`) {
    const parsed = snapshotSchema.safeParse(row.snapshot);
    if (
      !parsed.success ||
      parsed.data.kind !== row.kind ||
      parsed.data.targetId !== row.target_id
    )
      return false;
    const entries = snapshots.get(row.change_id) ?? [];
    entries.push(parsed.data);
    snapshots.set(row.change_id, entries);
  }
  for (const row of await sql`select id,impact_fingerprint from requirement_change`) {
    if (
      impactFingerprint(snapshots.get(row.id) ?? []) !== row.impact_fingerprint
    )
      return false;
  }
  return true;
}
