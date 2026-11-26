import { z } from "zod";
import { sql } from "../../../db/index.ts";
import {
  testStepResultSchema,
  summarizeTestResults,
} from "../../../shared/schemas/test-execution.ts";
/** 在同一恢复事务内验证固定版本、逐步结果和线性复测链。 */
export async function restoredTestExecutionIsConsistent(): Promise<boolean> {
  const bad =
    await sql`select 1 from test_plan_case s join test_plan p on p.id=s.plan_id join test_case c on c.id=s.case_id join test_case_revision v on v.id=s.revision_id
 where c.project_id<>p.project_id or v.case_id<>c.id or jsonb_array_length(v.steps)=0
 union all select 1 from test_run r join test_plan_case s on s.id=r.plan_case_id join test_plan p on p.id=s.plan_id left join test_run prev on prev.id=r.retest_of
 where r.project_id<>p.project_id or p.status='DRAFT' or btrim(r.build)='' or btrim(r.environment)='' or length(r.build)>200 or length(r.environment)>300
 or (r.attempt=1 and (r.retest_of is not null or r.build<>p.build or r.environment<>p.environment)) or (r.attempt>1 and (prev.id is null or prev.plan_case_id<>r.plan_case_id or prev.attempt<>r.attempt-1 or prev.status in ('IN_PROGRESS','CANCELLED')))
 or (r.status='IN_PROGRESS' and p.status<>'RUNNING') or (r.status='CANCELLED' and (p.status<>'CANCELLED' or r.cancel_reason is distinct from p.cancel_reason))
 or (r.status='IN_PROGRESS' and r.finished_at is not null) or (r.status<>'IN_PROGRESS' and r.finished_at is null) or r.finished_at<r.started_at
 or (r.source<>'MANUAL' and (r.source_reference is null or btrim(r.source_reference)=''))
 union all select 1 from test_run group by plan_case_id having min(attempt)<>1 or max(attempt)<>count(*)
 union all select 1 from test_plan_case group by plan_id having min(position)<>0 or max(position)+1<>count(*) or count(*)>500
 union all select 1 from test_plan p where btrim(title)='' or btrim(build)='' or btrim(environment)='' or length(title)>300 or length(build)>200 or length(environment)>300
 or (status='DRAFT' and (started_at is not null or finished_at is not null)) or (status='RUNNING' and (started_at is null or finished_at is not null))
 or (status='COMPLETED' and (started_at is null or finished_at is null)) or (status='CANCELLED' and (finished_at is null or cancel_reason is null or btrim(cancel_reason)=''))
 or (status in ('RUNNING','COMPLETED') and not exists(select 1 from test_plan_case s where s.plan_id=p.id))
 or (status='COMPLETED' and exists(select 1 from test_plan_case s where s.plan_id=p.id and coalesce((select r.status from test_run r where r.plan_case_id=s.id order by attempt desc limit 1),'IN_PROGRESS') in ('IN_PROGRESS','CANCELLED')))
 union all select 1 from test_run_defect d join test_run r on r.id=d.run_id join work_item w on w.id=d.defect_id where w.project_id<>r.project_id or w.type<>'DEFECT' or r.status<>'FAILED'
 limit 1`;
  if (bad.length) return false;
  const resultSchema = z.array(testStepResultSchema).max(100);
  for (const r of await sql`select r.status,r.results,jsonb_array_length(v.steps)::int step_count from test_run r join test_plan_case s on s.id=r.plan_case_id join test_case_revision v on v.id=s.revision_id`) {
    const parsed = resultSchema.safeParse(r.results);
    if (!parsed.success) return false;
    const results = parsed.data;
    if (
      new Set(results.map((s) => s.stepIndex)).size !== results.length ||
      results.some((s) => s.stepIndex >= r.step_count)
    )
      return false;
    if (
      !["IN_PROGRESS", "CANCELLED"].includes(r.status) &&
      (results.length !== r.step_count ||
        summarizeTestResults(results) !== r.status)
    )
      return false;
  }
  return true;
}
