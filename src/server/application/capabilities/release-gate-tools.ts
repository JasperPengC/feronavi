import { z } from "zod";
import type { ToolDef, ToolCtx } from "./tools.ts";
import {
  createReleaseCandidateSchema,
  releaseFeedbackSchema,
} from "../../../shared/schemas/release-gate.ts";
import * as gate from "../../services/release-gate.service.ts";
import { assertDeliveryWrite } from "../../services/delivery-access.ts";
import { assertDeliveryItems } from "../../services/delivery-evidence.service.ts";
import { getTestPlan } from "../../services/test-execution-read.ts";
import { assertDeliverySourceId } from "../../services/delivery-source.service.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";
const ref = { projectId: z.uuid(), releaseId: z.uuid() },
  fields = {
    ...ref,
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
    releaseId: _r,
    userConfirmed: _c,
    idempotencyKey: _k,
    ...value
  } = a;
  return value;
}
async function write<T>(
  ctx: ToolCtx,
  a: Record<string, unknown>,
  scope: string,
  fn: () => Promise<T>,
) {
  const projectId = String(a.projectId);
  await assertDeliveryWrite(ctx.actor, projectId, "release:manage");
  await gate.assertReleaseTarget(ctx.actor, projectId, String(a.releaseId));
  if (a.workItemId)
    await assertDeliveryItems(ctx.actor, projectId, [String(a.workItemId)]);
  if (a.sourceId)
    await assertDeliverySourceId(ctx.actor, projectId, String(a.sourceId));
  for (const id of (a.testPlanIds as string[]) ?? [])
    await getTestPlan(ctx.actor, projectId, id);
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
export const RELEASE_GATE_TOOLS: ToolDef[] = [
  tool(
    "delivery.releaseGate",
    "read",
    "读取版本发布候选、逐项门禁和完成时不可变核验快照。旧已完成版本缺证据时保持历史未知。",
    z.object(ref).strict(),
    (ctx, a) =>
      gate.getReleaseGate(ctx.actor, String(a.projectId), String(a.releaseId)),
  ),
  tool(
    "delivery.createCandidate",
    "write",
    "冻结版本工作项、GitHub来源版本、提交/构建/环境、必需workflowIds与测试计划；用当前候选编号作为expectedCandidateNumber（首次0）。GitHub证据以完整提交SHA作为构建标识；缺证据保持阻塞。",
    createReleaseCandidateSchema.extend(fields),
    (ctx, a) =>
      write(ctx, a, "delivery.createCandidate", () =>
        gate.createReleaseCandidate(
          ctx.actor,
          String(a.projectId),
          String(a.releaseId),
          input(a),
        ),
      ),
  ),
  tool(
    "delivery.recordFeedback",
    "write",
    "为已完成版本记录反馈结论，保留原始HTTP(S)来源和版本范围内工作项。不会自动改变任务或宣称其它提交已部署。",
    releaseFeedbackSchema.extend(fields),
    (ctx, a) =>
      write(ctx, a, "delivery.recordFeedback", () =>
        gate.recordReleaseFeedback(
          ctx.actor,
          String(a.projectId),
          String(a.releaseId),
          input(a),
        ),
      ),
  ),
];
