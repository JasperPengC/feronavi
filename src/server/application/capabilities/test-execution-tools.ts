import { z } from "zod";
import type { ToolDef, ToolCtx } from "./tools.ts";
import * as schemas from "../../../shared/schemas/test-execution.ts";
import * as execution from "../../services/test-run.service.ts";
import {
  assertWriteTesting,
  type TestPermission,
} from "../../services/test-access.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";
import { forbidden } from "../../../shared/errors.ts";
const project = { projectId: z.uuid() },
  planRef = { ...project, planId: z.uuid() },
  runRef = { ...project, runId: z.uuid() };
const writeFields = {
  userConfirmed: z.literal(true),
  idempotencyKey: z.string().min(1).max(200).optional(),
};
const tool = (
  name: string,
  kind: ToolDef["kind"],
  description: string,
  input: z.ZodType,
  handler: ToolDef["handler"],
): ToolDef => ({
  name,
  kind,
  description,
  inputSchema: z.toJSONSchema(input, {
    target: "draft-7",
    io: "input",
  }) as Record<string, unknown>,
  handler,
});
function input(a: Record<string, unknown>) {
  const {
    projectId: _p,
    planId: _l,
    runId: _r,
    userConfirmed: _c,
    idempotencyKey: _k,
    ...data
  } = a;
  return data;
}
async function writeOnce<T>(
  ctx: ToolCtx,
  a: Record<string, unknown>,
  scope: string,
  permission: TestPermission,
  fn: () => Promise<T>,
) {
  const projectId = String(a.projectId);
  await assertWriteTesting(ctx.actor, projectId, permission);
  if (a.planId)
    await execution.getTestPlan(ctx.actor, projectId, String(a.planId));
  if (a.runId) {
    const run = await execution.getTestRun(
      ctx.actor,
      projectId,
      String(a.runId),
    );
    if (scope === "testRun.createDefect" && !run.canCreateDefect)
      throw forbidden();
  }
  return (
    await withIdempotency(
      {
        actorId: ctx.actor.memberId,
        key: a.idempotencyKey as string | undefined,
        scope,
        body: a,
      },
      fn,
    )
  ).value;
}
export const TEST_EXECUTION_TOOLS: ToolDef[] = [
  tool(
    "testPlan.list",
    "read",
    "按状态分页读取测试计划，nextCursor用于before。",
    schemas.testPlanListSchema.extend(project),
    (ctx, a) => {
      const { projectId, ...query } = a;
      return execution.listTestPlans(ctx.actor, String(projectId), query);
    },
  ),
  tool(
    "testPlan.get",
    "read",
    "读取构建、环境、固定用例版本及最新执行；开始后的范围不可修改。",
    z.object(planRef).strict(),
    (ctx, a) =>
      execution.getTestPlan(ctx.actor, String(a.projectId), String(a.planId)),
  ),
  tool(
    "testPlan.report",
    "read",
    "读取全部尝试与每用例最新结果。passed仅在计划完成且最新结果全部通过时为true；来源仍为SELF_REPORTED，不能冒充可信CI证据。",
    z.object(planRef).strict(),
    (ctx, a) =>
      execution.getTestPlanReport(
        ctx.actor,
        String(a.projectId),
        String(a.planId),
      ),
  ),
  tool(
    "testRun.get",
    "read",
    "读取执行、固定步骤、逐步实际结果、原始/复测链及关联缺陷。",
    z.object(runRef).strict(),
    (ctx, a) =>
      execution.getTestRun(ctx.actor, String(a.projectId), String(a.runId)),
  ),
  tool(
    "testPlan.create",
    "write",
    "创建测试计划，cases为当前READY用例的caseId/revisionId；构建与环境必填。幂等重放重验权限。",
    schemas.createTestPlanSchema.safeExtend({ ...project, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testPlan.create", "test_plan:manage", () =>
        execution.createTestPlan(ctx.actor, String(a.projectId), input(a)),
      ),
  ),
  tool(
    "testPlan.update",
    "write",
    "只修改草稿计划，需expectedVersion；开始后构建、环境和用例范围固定。",
    schemas.updateTestPlanSchema.safeExtend({ ...planRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testPlan.update", "test_plan:manage", () =>
        execution.updateTestPlan(
          ctx.actor,
          String(a.projectId),
          String(a.planId),
          input(a),
        ),
      ),
  ),
  tool(
    "testPlan.transition",
    "write",
    "START开始，COMPLETE要求每条用例有终态结果，CANCEL须reason且取消活动执行。需expectedVersion。",
    schemas.transitionTestPlanSchema.safeExtend({ ...planRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testPlan.transition", "test_plan:manage", () =>
        execution.transitionTestPlan(
          ctx.actor,
          String(a.projectId),
          String(a.planId),
          input(a),
        ),
      ),
  ),
  tool(
    "testRun.start",
    "write",
    "开始固定版本的一次执行；复测必须retestOf指向最新已结束执行。AGENT/AUTOMATION须sourceReference。支持幂等键，返回稳定runId。",
    schemas.startTestRunSchema.safeExtend({ ...planRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testRun.start", "test_run:execute", () =>
        execution.startTestRun(
          ctx.actor,
          String(a.projectId),
          String(a.planId),
          input(a),
        ),
      ),
  ),
  tool(
    "testRun.record",
    "write",
    "回写逐步结果（零起stepIndex），需expectedVersion与实际结果；evidence仅http(s)URL，禁止本地路径。幂等重放不会重复计数。",
    schemas.recordTestRunSchema.safeExtend({ ...runRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testRun.record", "test_run:execute", () =>
        execution.recordTestRun(
          ctx.actor,
          String(a.projectId),
          String(a.runId),
          input(a),
        ),
      ),
  ),
  tool(
    "testRun.complete",
    "write",
    "每步有结果后完成执行，服务计算汇总状态；终态不可修改，修复后需新建复测。",
    schemas.completeTestRunSchema.safeExtend({ ...runRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testRun.complete", "test_run:execute", () =>
        execution.completeTestRun(
          ctx.actor,
          String(a.projectId),
          String(a.runId),
          input(a),
        ),
      ),
  ),
  tool(
    "testRun.createDefect",
    "write",
    "失败执行原子创建并关联同项目缺陷，每条执行只自动建一单；复测成功不会自动关闭缺陷。",
    schemas.createTestRunDefectSchema.safeExtend({ ...runRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testRun.createDefect", "test_run:execute", () =>
        execution.createTestRunDefect(
          ctx.actor,
          String(a.projectId),
          String(a.runId),
          input(a),
        ),
      ),
  ),
  tool(
    "testRun.linkDefect",
    "write",
    "给失败执行关联已有同项目DEFECT，重复关联不新增；先查询真实defectId。",
    schemas.linkTestRunDefectSchema.safeExtend({ ...runRef, ...writeFields }),
    async (ctx, a) =>
      writeOnce(ctx, a, "testRun.linkDefect", "test_run:execute", () =>
        execution.linkTestRunDefect(
          ctx.actor,
          String(a.projectId),
          String(a.runId),
          input(a),
        ),
      ),
  ),
];
