import { z } from "zod";
import { sql } from "../../../db/index.ts";
import {
  createReleaseCandidateSchema,
  releaseFeedbackSchema,
} from "../../../shared/schemas/release-gate.ts";
const scopeSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        key: z.string().min(1),
        title: z.string().min(1),
        version: z.number().int().positive(),
      })
      .strict(),
  )
  .refine((a) => new Set(a.map((i) => i.id)).size === a.length);
const snapshotSchema = z
  .object({
    candidateId: z.uuid(),
    candidateNumber: z.number().int().positive(),
    commitSha: z.string(),
    build: z.string(),
    environment: z.string(),
    sourceId: z.uuid(),
    sourceVersion: z.number().int().positive(),
    repository: z.string(),
    passed: z.literal(true),
    checkedAt: z.iso.datetime({ offset: true }),
    checks: z.array(
      z
        .object({
          key: z.string(),
          passed: z.literal(true),
          message: z.string(),
          evidenceIds: z.array(z.uuid()),
          testPlanId: z.uuid().optional(),
          testRunIds: z.array(z.uuid()).optional(),
        })
        .strict(),
    ),
  })
  .strict();
/** 校验历史关系与快照内部一致性；恢复时不能用当前来源状态改写过去发布结论。 */
export async function restoredReleaseGateIsConsistent(): Promise<boolean> {
  const bad = await sql`
 select 1 from release_candidate c join release r on r.id=c.release_id join delivery_source s on s.id=c.source_id
 where c.project_id<>r.project_id or c.project_id<>s.project_id or c.source_version>s.version or (c.source_version=s.version and c.repository<>s.repository)
 union all select 1 from release_verification v join release r on r.id=v.release_id join release_candidate c on c.id=v.candidate_id
 where v.project_id<>r.project_id or c.project_id<>v.project_id or c.release_id<>v.release_id or r.completed_at is null
 union all select 1 from release_feedback f join release r on r.id=f.release_id join work_item w on w.id=f.work_item_id
 where f.project_id<>r.project_id or f.project_id<>w.project_id or r.completed_at is null limit 1`;
  if (bad.length) return false;
  for await (const rows of sql`select * from release_candidate`.cursor(100))
    for (const c of rows) {
      if (
        !createReleaseCandidateSchema.safeParse({
          sourceId: c.source_id,
          commitSha: c.commit_sha,
          build: c.build,
          environment: c.environment,
          workflowIds: c.workflow_ids,
          testPlanIds: c.test_plan_ids,
          expectedCandidateNumber: c.number - 1,
        }).success ||
        !scopeSchema.safeParse(c.work_items).success
      )
        return false;
      const ids = c.test_plan_ids as string[];
      if (
        (
          await sql`select id from test_plan where id in ${sql(ids)} and project_id=${c.project_id}`
        ).length !== ids.length
      )
        return false;
      for (const w of c.work_items) {
        const [row] =
          await sql`select version from work_item where id=${w.id} and project_id=${c.project_id}`;
        if (!row || row.version < w.version) return false;
      }
    }
  for await (const rows of sql`select v.*,c.number,c.source_id,c.source_version,c.repository,c.commit_sha,c.build,c.environment,c.workflow_ids,c.test_plan_ids from release_verification v join release_candidate c on c.id=v.candidate_id`.cursor(
    100,
  ))
    for (const v of rows) {
      const parsed = snapshotSchema.safeParse(v.snapshot);
      if (!parsed.success) return false;
      const snapshot = parsed.data;
      if (
        snapshot.candidateId !== v.candidate_id ||
        snapshot.candidateNumber !== v.number ||
        snapshot.sourceId !== v.source_id ||
        snapshot.sourceVersion !== v.source_version ||
        snapshot.repository !== v.repository ||
        snapshot.commitSha !== v.commit_sha ||
        snapshot.build !== v.build ||
        snapshot.environment !== v.environment
      )
        return false;
      const expected = [
        "scope",
        "workItems",
        "source",
        "merge",
        "deployment",
        ...v.workflow_ids.map((id: number) => "workflow:" + id),
        ...v.test_plan_ids.map((id: string) => "test:" + id),
      ].sort();
      if (
        JSON.stringify(snapshot.checks.map((c) => c.key).sort()) !==
        JSON.stringify(expected)
      )
        return false;
      for (const check of snapshot.checks) {
        if (check.key.startsWith("test:")) {
          if (
            check.testPlanId !== check.key.slice(5) ||
            !check.testRunIds?.length ||
            new Set(check.testRunIds).size !== check.testRunIds.length ||
            check.evidenceIds.length
          )
            return false;
          const runs =
            await sql`select r.*,p.id as plan_id,p.status as plan_status from test_run r join test_plan_case c on c.id=r.plan_case_id join test_plan p on p.id=c.plan_id where r.id in ${sql(check.testRunIds)}`;
          if (
            runs.length !== check.testRunIds.length ||
            runs.some(
              (r) =>
                r.project_id !== v.project_id ||
                r.plan_id !== check.testPlanId ||
                r.plan_status !== "COMPLETED" ||
                r.status !== "PASSED" ||
                r.build !== snapshot.build ||
                r.environment !== snapshot.environment,
            )
          )
            return false;
          const [count] =
            await sql`select count(*)::int n from test_plan_case where plan_id=${check.testPlanId}`;
          if (count!.n !== new Set(runs.map((r) => r.plan_case_id)).size)
            return false;
        } else if (
          ["merge", "deployment"].includes(check.key) ||
          check.key.startsWith("workflow:")
        ) {
          if (check.evidenceIds.length !== 1) return false;
          const [e] =
            await sql`select * from delivery_evidence where id=${check.evidenceIds[0]!}`;
          if (
            !e ||
            e.project_id !== v.project_id ||
            e.source_id !== snapshot.sourceId ||
            e.source_version !== snapshot.sourceVersion ||
            e.repository !== snapshot.repository ||
            e.commit_sha !== snapshot.commitSha ||
            e.build !== snapshot.build ||
            e.status !== "SUCCEEDED" ||
            e.verification !== "PROVIDER_API"
          )
            return false;
          if (
            check.key === "merge" &&
            (e.kind !== "PULL_REQUEST" || e.details.merged !== true)
          )
            return false;
          if (
            check.key === "deployment" &&
            (e.kind !== "DEPLOYMENT" || e.environment !== snapshot.environment)
          )
            return false;
          if (
            check.key.startsWith("workflow:") &&
            (e.kind !== "CI" ||
              e.details.workflowId !== Number(check.key.slice(9)))
          )
            return false;
        } else if (
          check.evidenceIds.length ||
          check.testPlanId ||
          check.testRunIds
        )
          return false;
      }
    }
  for await (const rows of sql`select * from release_feedback`.cursor(100))
    for (const f of rows) {
      if (
        !releaseFeedbackSchema.safeParse({
          workItemId: f.work_item_id,
          sourceUrl: f.source_url,
          conclusion: f.conclusion,
          outcome: f.outcome,
        }).success
      )
        return false;
    }
  return true;
}
