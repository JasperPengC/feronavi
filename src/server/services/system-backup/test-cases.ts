import { z } from "zod";
import { sql } from "../../../db/index.ts";
import { testStepSchema } from "../../../shared/schemas/test-management.ts";

/** 历史用例保留当时需求基线，当前指针与套件不能跨项目。 */
export async function restoredTestCasesAreConsistent(): Promise<boolean> {
  const bad = await sql`select 1 from test_case c
    left join test_case_revision r on r.id=c.current_revision_id
    left join test_suite s on s.id=c.suite_id
    where r.id is null or r.case_id<>c.id or r.title<>c.title or c.title=''
      or s.project_id<>c.project_id or (c.status<>'ARCHIVED' and s.archived_at is not null)
      or (c.status='READY' and jsonb_array_length(r.steps)=0)
      or r.revision_no<>(select max(h.revision_no) from test_case_revision h where h.case_id=c.id)
    union all select 1 from test_case_requirement l
      join test_case_revision r on r.id=l.case_revision_id join test_case c on c.id=r.case_id
      join work_item w on w.id=l.work_item_id join requirement_revision q on q.id=l.requirement_revision_id
      where w.project_id<>c.project_id or w.type<>'REQUIREMENT' or q.work_item_id<>w.id
    union all select 1 from test_case_revision group by case_id having min(revision_no)<>1 or max(revision_no)<>count(*)
    union all select 1 from test_case_requirement group by case_revision_id having count(*)>20
    limit 1`;
  if (bad.length) return false;
  const content = z.object({
    title: z.string().trim().min(1).max(300),
    preconditions: z.string().max(10000),
    steps: z.array(testStepSchema).max(100),
  });
  for (const revision of await sql`select title,preconditions,steps from test_case_revision`) {
    if (!content.safeParse(revision).success) return false;
  }
  return true;
}
