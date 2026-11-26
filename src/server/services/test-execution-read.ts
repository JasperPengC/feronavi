import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  member,
  testCase,
  testCaseRevision,
  testCaseRequirement,
  requirementRevision,
  testPlan,
  testPlanCase,
  testRun,
  testRunDefect,
  workItem,
  workflowState,
} from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import {
  testPlanListSchema,
  type TestPlanDetail,
  type TestPlanPage,
  type TestPlanReport,
  type TestPlanSummary,
  type TestRunDetail,
  type TestRunDefectRef,
  type TestRunState,
} from "../../shared/schemas/test-execution.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import {
  readTestProject,
  canWriteTesting,
  parseTesting,
} from "./test-access.ts";
async function planRow(projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(testPlan)
    .where(and(eq(testPlan.projectId, projectId), eq(testPlan.id, id)));
  if (!row) throw forbidden();
  return row;
}
async function runRow(projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(testRun)
    .where(and(eq(testRun.projectId, projectId), eq(testRun.id, id)));
  if (!row) throw forbidden();
  return row;
}
async function summary(
  actor: Actor,
  row: typeof testPlan.$inferSelect,
  context?: {
    project: Awaited<ReturnType<typeof readTestProject>>;
    canManage: boolean;
    canExecute: boolean;
  },
): Promise<TestPlanSummary> {
  const project =
    context?.project ?? (await readTestProject(actor, row.projectId));
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    key: `${project.key}-TP-${row.number}`,
    title: row.title,
    build: row.build,
    environment: row.environment,
    status: row.status,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    canManage:
      context?.canManage ??
      (await canWriteTesting(actor, row.projectId, "test_plan:manage")),
    canExecute:
      context?.canExecute ??
      (await canWriteTesting(actor, row.projectId, "test_run:execute")),
  };
}
export async function listTestPlans(
  actor: Actor,
  projectId: string,
  raw: unknown = {},
): Promise<TestPlanPage> {
  const project = await readTestProject(actor, projectId);
  const context = {
    project,
    canManage: await canWriteTesting(actor, projectId, "test_plan:manage"),
    canExecute: await canWriteTesting(actor, projectId, "test_run:execute"),
  };
  const input = parseTesting(testPlanListSchema, raw);
  const rows = await db
    .select()
    .from(testPlan)
    .where(
      and(
        eq(testPlan.projectId, projectId),
        input.status ? eq(testPlan.status, input.status) : undefined,
        input.before ? lt(testPlan.number, input.before) : undefined,
      ),
    )
    .orderBy(desc(testPlan.number))
    .limit(input.limit + 1);
  return {
    items: await Promise.all(
      rows.slice(0, input.limit).map((row) => summary(actor, row, context)),
    ),
    nextCursor:
      rows.length > input.limit ? rows[input.limit - 1]!.number : null,
    canManage: context.canManage,
  };
}
export async function getTestPlan(
  actor: Actor,
  projectId: string,
  id: string,
): Promise<TestPlanDetail> {
  await readTestProject(actor, projectId);
  const row = await planRow(projectId, id),
    project = await readTestProject(actor, projectId);
  const scope = await db
    .select({
      id: testPlanCase.id,
      caseId: testPlanCase.caseId,
      revisionId: testPlanCase.revisionId,
      position: testPlanCase.position,
      number: testCase.number,
      revisionNo: testCaseRevision.revisionNo,
      title: testCaseRevision.title,
    })
    .from(testPlanCase)
    .innerJoin(testCase, eq(testCase.id, testPlanCase.caseId))
    .innerJoin(
      testCaseRevision,
      eq(testCaseRevision.id, testPlanCase.revisionId),
    )
    .where(eq(testPlanCase.planId, id))
    .orderBy(testPlanCase.position);
  const runs = scope.length
    ? await db
        .select({
          id: testRun.id,
          planCaseId: testRun.planCaseId,
          status: testRun.status,
          attempt: testRun.attempt,
        })
        .from(testRun)
        .where(
          inArray(
            testRun.planCaseId,
            scope.map((s) => s.id),
          ),
        )
        .orderBy(desc(testRun.attempt))
    : [];
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs)
    if (!latest.has(r.planCaseId)) latest.set(r.planCaseId, r);
  return {
    ...(await summary(actor, row)),
    cases: scope.map((s) => {
      const run = latest.get(s.id);
      return {
        id: s.id,
        caseId: s.caseId,
        key: `${project.key}-TC-${s.number}`,
        revisionId: s.revisionId,
        revisionNo: s.revisionNo,
        title: s.title,
        position: s.position,
        latestRun: run
          ? { id: run.id, status: run.status, attempt: run.attempt }
          : null,
      };
    }),
  };
}
async function executionContext(
  projectId: string,
  row: typeof testRun.$inferSelect,
) {
  const [entry] = await db
    .select()
    .from(testPlanCase)
    .where(eq(testPlanCase.id, row.planCaseId));
  if (!entry) throw forbidden();
  const plan = await planRow(projectId, entry.planId);
  return { entry, plan };
}
/** 一次加载计划内所有执行、固定正文与缺陷；报告复杂度不随复测链重复查询。 */
async function planRuns(
  actor: Actor,
  projectId: string,
  plan: TestPlanDetail,
): Promise<TestRunDetail[]> {
  if (!plan.cases.length) return [];
  const rows = await db
    .select({ run: testRun, executorName: member.name })
    .from(testRun)
    .leftJoin(member, eq(member.id, testRun.executorId))
    .where(
      inArray(
        testRun.planCaseId,
        plan.cases.map((c) => c.id),
      ),
    )
    .orderBy(testRun.attempt);
  const revisionIds = plan.cases.map((c) => c.revisionId);
  const revisions = await db
    .select({ revision: testCaseRevision, authorName: member.name })
    .from(testCaseRevision)
    .leftJoin(member, eq(member.id, testCaseRevision.createdBy))
    .where(inArray(testCaseRevision.id, revisionIds));
  const requirements = await db
    .select({
      caseRevisionId: testCaseRequirement.caseRevisionId,
      workItemId: workItem.id,
      revisionId: requirementRevision.id,
      key: workItem.key,
      title: requirementRevision.title,
      revisionNo: requirementRevision.revisionNo,
    })
    .from(testCaseRequirement)
    .innerJoin(workItem, eq(workItem.id, testCaseRequirement.workItemId))
    .innerJoin(
      requirementRevision,
      eq(requirementRevision.id, testCaseRequirement.requirementRevisionId),
    )
    .where(inArray(testCaseRequirement.caseRevisionId, revisionIds))
    .orderBy(workItem.key);
  const links = rows.length
    ? await db
        .select({
          runId: testRunDefect.runId,
          id: workItem.id,
          key: workItem.key,
          title: workItem.title,
          statusKey: workflowState.key,
          statusName: workflowState.name,
          statusCategory: workflowState.category,
          generated: testRunDefect.generated,
        })
        .from(testRunDefect)
        .innerJoin(workItem, eq(workItem.id, testRunDefect.defectId))
        .innerJoin(workflowState, eq(workflowState.id, workItem.statusId))
        .where(
          inArray(
            testRunDefect.runId,
            rows.map((r) => r.run.id),
          ),
        )
    : [];
  const scopeById = new Map(plan.cases.map((c) => [c.id, c]));
  const revisionsById = new Map(
    revisions.map((v) => [
      v.revision.id,
      {
        ...v.revision,
        createdAt: v.revision.createdAt.toISOString(),
        authorName: v.authorName,
        requirements: requirements
          .filter((r) => r.caseRevisionId === v.revision.id)
          .map(({ caseRevisionId: _id, ...r }) => r),
      },
    ]),
  );
  const ancestors = new Map<string, TestRunDefectRef[]>();
  const mayCreate = can(
    actor,
    "work_item:create",
    { projectId },
    {
      memberId: actor.memberId,
      memberProjectIds: new Set(),
      memberTeamIds: new Set(),
    },
  );
  return rows.map(({ run: row, executorName }) => {
    const entry = scopeById.get(row.planCaseId)!;
    const refs = new Map(
      (row.retestOf ? (ancestors.get(row.retestOf) ?? []) : []).map((r) => [
        r.id,
        { ...r, inherited: true },
      ]),
    );
    for (const { runId: _runId, ...ref } of links.filter(
      (l) => l.runId === row.id,
    ))
      refs.set(ref.id, { ...ref, inherited: false });
    const defects = [...refs.values()];
    ancestors.set(row.id, defects);
    return {
      id: row.id,
      projectId,
      planId: plan.id,
      planCaseId: entry.id,
      caseId: entry.caseId,
      caseKey: entry.key,
      planTitle: plan.title,
      build: row.build,
      environment: row.environment,
      attempt: row.attempt,
      retestOf: row.retestOf,
      status: row.status,
      version: row.version,
      source: row.source,
      sourceReference: row.sourceReference,
      sourceVerification: "SELF_REPORTED",
      executorId: row.executorId,
      executorName,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      results: row.results,
      revision: revisionsById.get(entry.revisionId)!,
      defects,
      canExecute:
        plan.canExecute &&
        plan.status === "RUNNING" &&
        row.status === "IN_PROGRESS",
      canRetest:
        plan.canExecute &&
        plan.status === "RUNNING" &&
        row.status !== "IN_PROGRESS" &&
        row.status !== "CANCELLED" &&
        entry.latestRun?.id === row.id,
      canLinkDefect: plan.canExecute && row.status === "FAILED",
      canCreateDefect: plan.canExecute && row.status === "FAILED" && mayCreate,
    };
  });
}
export async function getTestRun(
  actor: Actor,
  projectId: string,
  id: string,
): Promise<TestRunDetail> {
  await readTestProject(actor, projectId);
  const row = await runRow(projectId, id),
    { plan } = await executionContext(projectId, row);
  const detail = await getTestPlan(actor, projectId, plan.id);
  return (
    await planRuns(actor, projectId, {
      ...detail,
      cases: detail.cases.filter((c) => c.id === row.planCaseId),
    })
  ).find((r) => r.id === id)!;
}
const counts = (): Record<TestRunState, number> => ({
  IN_PROGRESS: 0,
  PASSED: 0,
  FAILED: 0,
  BLOCKED: 0,
  SKIPPED: 0,
  CANCELLED: 0,
});
export async function getTestPlanReport(
  actor: Actor,
  projectId: string,
  id: string,
): Promise<TestPlanReport> {
  const plan = await getTestPlan(actor, projectId, id),
    allAttempts = counts(),
    latestResults = { ...counts(), NOT_RUN: 0 };
  const entries: TestPlanReport["cases"] = [];
  let totalAttempts = 0;
  const allRuns = await planRuns(actor, projectId, plan);
  for (const entry of plan.cases) {
    const runs = allRuns.filter((r) => r.planCaseId === entry.id);
    for (const run of runs) {
      allAttempts[run.status]++;
      totalAttempts++;
    }
    const latestStatus = runs.at(-1)?.status ?? "NOT_RUN";
    latestResults[latestStatus]++;
    entries.push({
      planCaseId: entry.id,
      caseId: entry.caseId,
      key: entry.key,
      title: entry.title,
      revisionId: entry.revisionId,
      revisionNo: entry.revisionNo,
      latestStatus,
      runs,
    });
  }
  const { cases: _cases, ...planSummary } = plan;
  const latestRuns = entries
    .map((c) => c.runs.at(-1))
    .filter((r): r is TestRunDetail => !!r);
  const testedBuild =
    latestRuns.length === entries.length &&
    new Set(latestRuns.map((r) => r.build)).size === 1
      ? latestRuns[0]!.build
      : null;
  const testedEnvironment =
    latestRuns.length === entries.length &&
    new Set(latestRuns.map((r) => r.environment)).size === 1
      ? latestRuns[0]!.environment
      : null;
  return {
    plan: planSummary,
    totalCases: entries.length,
    totalAttempts,
    latestResults,
    allAttempts,
    testedBuild,
    testedEnvironment,
    passed:
      testedBuild !== null &&
      testedEnvironment !== null &&
      plan.status === "COMPLETED" &&
      entries.length > 0 &&
      latestResults.PASSED === entries.length,
    cases: entries,
    generatedAt: new Date().toISOString(),
  };
}
