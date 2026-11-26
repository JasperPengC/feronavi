import { and, desc, eq, inArray, sql as dsql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  testPlan,
  testCase,
  testPlanCase,
  testRun,
  testRunDefect,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  completeTestRunSchema,
  createTestPlanSchema,
  createTestRunDefectSchema,
  linkTestRunDefectSchema,
  recordTestRunSchema,
  startTestRunSchema,
  summarizeTestResults,
  transitionTestPlanSchema,
  updateTestPlanSchema,
  type TestPlanDetail,
  type TestRunDetail,
  type TestRunDefectResult,
} from "../../shared/schemas/test-execution.ts";
import type { Actor } from "../permission/actor.ts";
import { withTestWrite, parseTesting, testVersion } from "./test-access.ts";
import { getTestCaseRevision } from "./test-case.service.ts";
import { createWorkItem, getWorkItem } from "./work-item.service.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { getTestPlan, getTestRun } from "./test-execution-read.ts";
export {
  listTestPlans,
  getTestPlan,
  getTestRun,
  getTestPlanReport,
} from "./test-execution-read.ts";
const blocked = (message: string) =>
  new DomainError("BLOCKED_BY_PREREQUISITE", message, null);
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
async function planScope(planId: string) {
  return db
    .select()
    .from(testPlanCase)
    .where(eq(testPlanCase.planId, planId))
    .orderBy(testPlanCase.position);
}
async function latestRun(planCaseId: string) {
  const [row] = await db
    .select()
    .from(testRun)
    .where(eq(testRun.planCaseId, planCaseId))
    .orderBy(desc(testRun.attempt))
    .limit(1);
  return row;
}
async function event(
  actor: Actor,
  projectId: string,
  id: string,
  targetType: "TEST_PLAN" | "TEST_RUN",
  action: string,
) {
  await recordBusinessEvent({
    actor,
    projectId,
    targetType,
    targetId: id,
    action: targetType.toLowerCase() + "." + action,
    summary: `${actor.name} ${action} ${targetType === "TEST_PLAN" ? "测试计划" : "测试执行"}`,
    invalidation: {
      domain: "project",
      resourceType: "PROJECT",
      resourceId: projectId,
    },
  });
}
async function validateCases(
  _actor: Actor,
  projectId: string,
  cases: { caseId: string; revisionId: string }[],
) {
  if (!cases.length) return;
  const found = await db
    .select({
      id: testCase.id,
      status: testCase.status,
      currentRevisionId: testCase.currentRevisionId,
    })
    .from(testCase)
    .where(
      and(
        eq(testCase.projectId, projectId),
        inArray(
          testCase.id,
          cases.map((c) => c.caseId),
        ),
      ),
    );
  if (found.length !== cases.length) throw forbidden();
  const byId = new Map(found.map((c) => [c.id, c]));
  for (const pin of cases) {
    const item = byId.get(pin.caseId)!;
    if (item.status !== "READY" || item.currentRevisionId !== pin.revisionId)
      throw blocked("请选择当前就绪用例及其最新版本");
  }
}
export async function createTestPlan(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<TestPlanDetail> {
  const input = parseTesting(createTestPlanSchema, raw);
  return withTestWrite(actor, projectId, "test_plan:manage", async () => {
    await validateCases(actor, projectId, input.cases);
    const [last] = await db
      .select({ number: testPlan.number })
      .from(testPlan)
      .where(eq(testPlan.projectId, projectId))
      .orderBy(desc(testPlan.number))
      .limit(1);
    const [plan] = await db
      .insert(testPlan)
      .values({
        projectId,
        number: (last?.number ?? 0) + 1,
        title: input.title,
        build: input.build,
        environment: input.environment,
        createdBy: actor.memberId,
      })
      .returning();
    if (input.cases.length)
      await db.insert(testPlanCase).values(
        input.cases.map((c, position) => ({
          planId: plan!.id,
          caseId: c.caseId,
          revisionId: c.revisionId,
          position,
        })),
      );
    await event(actor, projectId, plan!.id, "TEST_PLAN", "created");
    return getTestPlan(actor, projectId, plan!.id);
  });
}
export async function updateTestPlan(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestPlanDetail> {
  const input = parseTesting(updateTestPlanSchema, raw);
  return withTestWrite(actor, projectId, "test_plan:manage", async () => {
    const row = await planRow(projectId, id);
    testVersion(row.version, input.expectedVersion);
    if (row.status !== "DRAFT")
      throw blocked("测试计划已开始，构建、环境和用例范围已固定");
    if (input.cases) {
      await validateCases(actor, projectId, input.cases);
      await db.delete(testPlanCase).where(eq(testPlanCase.planId, id));
      if (input.cases.length)
        await db.insert(testPlanCase).values(
          input.cases.map((c, position) => ({
            planId: id,
            caseId: c.caseId,
            revisionId: c.revisionId,
            position,
          })),
        );
    }
    await db
      .update(testPlan)
      .set({
        title: input.title ?? row.title,
        build: input.build ?? row.build,
        environment: input.environment ?? row.environment,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(testPlan.id, id));
    await event(actor, projectId, id, "TEST_PLAN", "updated");
    return getTestPlan(actor, projectId, id);
  });
}
export async function transitionTestPlan(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestPlanDetail> {
  const input = parseTesting(transitionTestPlanSchema, raw);
  return withTestWrite(actor, projectId, "test_plan:manage", async () => {
    const row = await planRow(projectId, id);
    testVersion(row.version, input.expectedVersion);
    const scope = await planScope(id);
    const now = new Date();
    let status: typeof row.status,
      startedAt = row.startedAt,
      finishedAt = row.finishedAt,
      cancelReason = row.cancelReason;
    if (input.action === "START") {
      if (row.status !== "DRAFT" || !scope.length)
        throw blocked("只有包含用例的草稿计划可开始");
      status = "RUNNING";
      startedAt = now;
    } else if (input.action === "COMPLETE") {
      if (row.status !== "RUNNING") throw blocked("只有执行中的计划可完成");
      const current = await getTestPlan(actor, projectId, id);
      if (
        current.cases.some(
          (c) =>
            !c.latestRun ||
            ["IN_PROGRESS", "CANCELLED"].includes(c.latestRun.status),
        )
      )
        throw blocked("每条用例必须有最终执行结果才能完成计划");
      status = "COMPLETED";
      finishedAt = now;
    } else {
      if (!["DRAFT", "RUNNING"].includes(row.status) || !input.reason)
        throw blocked("只有草稿/执行中计划可取消，且须填写原因");
      status = "CANCELLED";
      finishedAt = now;
      cancelReason = input.reason;
      if (scope.length)
        await db
          .update(testRun)
          .set({
            status: "CANCELLED",
            cancelReason: input.reason,
            finishedAt: now,
            version: dsql`${testRun.version}+1`,
          })
          .where(
            and(
              inArray(
                testRun.planCaseId,
                scope.map((c) => c.id),
              ),
              eq(testRun.status, "IN_PROGRESS"),
            ),
          );
    }
    await db
      .update(testPlan)
      .set({
        status,
        startedAt,
        finishedAt,
        cancelReason,
        version: row.version + 1,
        updatedAt: now,
      })
      .where(eq(testPlan.id, id));
    await event(actor, projectId, id, "TEST_PLAN", status.toLowerCase());
    return getTestPlan(actor, projectId, id);
  });
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
export async function startTestRun(
  actor: Actor,
  projectId: string,
  planId: string,
  raw: unknown,
): Promise<TestRunDetail> {
  const input = parseTesting(startTestRunSchema, raw);
  return withTestWrite(actor, projectId, "test_run:execute", async () => {
    const plan = await planRow(projectId, planId);
    if (plan.status !== "RUNNING") throw blocked("测试计划尚未开始或已结束");
    const [entry] = await db
      .select()
      .from(testPlanCase)
      .where(
        and(
          eq(testPlanCase.planId, planId),
          eq(testPlanCase.id, input.planCaseId),
        ),
      );
    if (!entry) throw forbidden();
    const last = await latestRun(entry.id);
    if (last?.status === "IN_PROGRESS")
      throw blocked("该用例已有进行中的执行，请继续当前记录");
    if (last && input.retestOf !== last.id)
      throw blocked("复测必须引用该用例的最新执行记录");
    if (input.retestOf && (!last || last.id !== input.retestOf))
      throw forbidden();
    if (input.retestOf && (!input.build || !input.environment))
      throw new DomainError("VALIDATION", "复测须明确构建标识与环境", null);
    if (
      !input.retestOf &&
      ((input.build && input.build !== plan.build) ||
        (input.environment && input.environment !== plan.environment))
    )
      throw blocked("首次执行须使用计划构建与环境");
    if (input.source !== "MANUAL" && !input.sourceReference)
      throw new DomainError(
        "VALIDATION",
        "Agent或自动化执行必须提供来源标识",
        null,
      );
    const [run] = await db
      .insert(testRun)
      .values({
        projectId,
        planCaseId: entry.id,
        attempt: (last?.attempt ?? 0) + 1,
        retestOf: input.retestOf ?? null,
        build: input.build ?? plan.build,
        environment: input.environment ?? plan.environment,
        source: input.source,
        sourceReference: input.sourceReference ?? null,
        executorId: actor.memberId,
      })
      .returning();
    await event(actor, projectId, run!.id, "TEST_RUN", "started");
    return getTestRun(actor, projectId, run!.id);
  });
}
export async function recordTestRun(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestRunDetail> {
  const input = parseTesting(recordTestRunSchema, raw);
  return withTestWrite(actor, projectId, "test_run:execute", async () => {
    const row = await runRow(projectId, id);
    testVersion(row.version, input.expectedVersion);
    const { entry, plan } = await executionContext(projectId, row);
    if (row.status !== "IN_PROGRESS" || plan.status !== "RUNNING")
      throw blocked("执行记录已结束，不能修改；请新建复测");
    const revision = await getTestCaseRevision(
      actor,
      projectId,
      entry.caseId,
      entry.revisionId,
    );
    if (input.results.some((r) => r.stepIndex >= revision.steps.length))
      throw new DomainError("VALIDATION", "步骤超出固定用例范围", null);
    const results = new Map(row.results.map((r) => [r.stepIndex, r]));
    for (const result of input.results) results.set(result.stepIndex, result);
    await db
      .update(testRun)
      .set({
        results: [...results.values()].sort(
          (a, b) => a.stepIndex - b.stepIndex,
        ),
        version: row.version + 1,
      })
      .where(eq(testRun.id, id));
    await event(actor, projectId, id, "TEST_RUN", "recorded");
    return getTestRun(actor, projectId, id);
  });
}
export async function completeTestRun(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestRunDetail> {
  const input = parseTesting(completeTestRunSchema, raw);
  return withTestWrite(actor, projectId, "test_run:execute", async () => {
    const row = await runRow(projectId, id);
    testVersion(row.version, input.expectedVersion);
    const { entry, plan } = await executionContext(projectId, row);
    if (row.status !== "IN_PROGRESS" || plan.status !== "RUNNING")
      throw blocked("执行记录或测试计划已结束");
    const revision = await getTestCaseRevision(
      actor,
      projectId,
      entry.caseId,
      entry.revisionId,
    );
    if (!revision.steps.length || row.results.length !== revision.steps.length)
      throw blocked("请先记录每一步的结果");
    const status = summarizeTestResults(row.results);
    await db
      .update(testRun)
      .set({ status, finishedAt: new Date(), version: row.version + 1 })
      .where(eq(testRun.id, id));
    await event(actor, projectId, id, "TEST_RUN", "completed");
    return getTestRun(actor, projectId, id);
  });
}
function defectResult(
  runId: string,
  defect: {
    id: string;
    key: string;
    title: string;
    type: string;
    projectId: string;
  },
): TestRunDefectResult {
  return {
    runId,
    defect: {
      id: defect.id,
      key: defect.key,
      title: defect.title,
      type: defect.type,
      projectId: defect.projectId,
    },
  };
}
export async function createTestRunDefect(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestRunDefectResult> {
  const input = parseTesting(createTestRunDefectSchema, raw);
  return withTestWrite(actor, projectId, "test_run:execute", async () => {
    const run = await getTestRun(actor, projectId, id);
    if (!run.canCreateDefect) throw forbidden();
    const [existing] = await db
      .select({ id: testRunDefect.defectId })
      .from(testRunDefect)
      .where(
        and(eq(testRunDefect.runId, id), eq(testRunDefect.generated, true)),
      );
    if (existing)
      return defectResult(id, await getWorkItem(actor, existing.id));
    const lines = run.results
      .filter((r) => r.status === "FAILED")
      .map(
        (r) =>
          `### 步骤 ${r.stepIndex + 1}\n\n操作：${run.revision.steps[r.stepIndex]!.action}\n\n预期：${run.revision.steps[r.stepIndex]!.expected}\n\n实际：${r.actual}\n\n${r.evidence.map((url) => `证据：${url}`).join("\n")}`,
      )
      .join("\n\n");
    const defect = await createWorkItem(actor, projectId, {
      type: "DEFECT",
      title: input.title,
      priority: input.priority,
      severity: input.severity,
      description: `测试计划：${run.planTitle}\n\n构建：${run.build}\n\n环境：${run.environment}\n\n用例：${run.caseKey} V${run.revision.revisionNo}\n\n执行ID：${id}（第${run.attempt}次）\n\n${lines}`,
    });
    if (!defect) throw new DomainError("INTERNAL", "缺陷创建失败", null);
    await db.insert(testRunDefect).values({
      runId: id,
      defectId: defect.id,
      createdBy: actor.memberId,
      generated: true,
    });
    await event(actor, projectId, id, "TEST_RUN", "defect_created");
    return defectResult(id, defect);
  });
}
export async function linkTestRunDefect(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestRunDefectResult> {
  const input = parseTesting(linkTestRunDefectSchema, raw);
  return withTestWrite(actor, projectId, "test_run:execute", async () => {
    const run = await runRow(projectId, id);
    if (run.status !== "FAILED") throw blocked("只有失败执行可关联缺陷");
    const defect = await getWorkItem(actor, input.defectId);
    if (defect.projectId !== projectId || defect.type !== "DEFECT")
      throw forbidden();
    await db
      .insert(testRunDefect)
      .values({ runId: id, defectId: defect.id, createdBy: actor.memberId })
      .onConflictDoNothing();
    await event(actor, projectId, id, "TEST_RUN", "defect_linked");
    return defectResult(id, defect);
  });
}
