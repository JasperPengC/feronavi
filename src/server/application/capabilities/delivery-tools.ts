import { z } from "zod";
import type { ToolDef, ToolCtx } from "./tools.ts";
import * as schemas from "../../../shared/schemas/delivery.ts";
import * as evidence from "../../services/delivery-evidence.service.ts";
import * as sources from "../../services/delivery-source.service.ts";
import {
  assertDeliveryWrite,
  type DeliveryPermission,
} from "../../services/delivery-access.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";
const project = { projectId: z.uuid() },
  ref = { ...project, evidenceId: z.uuid() },
  writeFields = {
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
    evidenceId: _e,
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
  permission: DeliveryPermission,
  fn: () => Promise<T>,
) {
  const projectId = String(a.projectId);
  await assertDeliveryWrite(ctx.actor, projectId, permission);
  if (a.evidenceId)
    await evidence.getDeliveryEvidence(
      ctx.actor,
      projectId,
      String(a.evidenceId),
    );
  if (a.integrationId)
    await sources.assertDeliverySourceTarget(
      ctx.actor,
      projectId,
      String(a.integrationId),
      a.sourceId as string | undefined,
    );
  if (a.workItemIds)
    await evidence.assertDeliveryItems(
      ctx.actor,
      projectId,
      a.workItemIds as string[],
    );
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
export const DELIVERY_TOOLS: ToolDef[] = [
  tool(
    "delivery.sources",
    "read",
    "读取项目交付来源与配置是否有效，不返回密钥。",
    z.object(project).strict(),
    (ctx, a) => sources.listDeliverySources(ctx.actor, String(a.projectId)),
  ),
  tool(
    "delivery.configureSource",
    "write",
    "配置本项目GitHub交付来源及独立Webhook密钥；expectedVersion=0创建，否则传当前版本。配置变化使旧证据失去当前核验资格。",
    schemas.configureDeliverySourceSchema.extend({
      ...project,
      ...writeFields,
    }),
    (ctx, a) =>
      write(ctx, a, "delivery.configureSource", "integration:manage", () =>
        sources.configureDeliverySource(
          ctx.actor,
          String(a.projectId),
          input(a),
        ),
      ),
  ),
  tool(
    "delivery.listEvidence",
    "read",
    "按工作项或类型分页读取不可变交付证据；nextCursor用于before。状态与核验来源分开，SELF_REPORTED不能满足可信CI门禁。",
    schemas.deliveryListSchema.extend(project),
    (ctx, a) =>
      evidence.listDeliveryEvidence(ctx.actor, String(a.projectId), input(a)),
  ),
  tool(
    "delivery.getEvidence",
    "read",
    "读取交付证据、构建/提交、来源有效性及关联工作项。",
    z.object(ref).strict(),
    (ctx, a) =>
      evidence.getDeliveryEvidence(
        ctx.actor,
        String(a.projectId),
        String(a.evidenceId),
      ),
  ),
  tool(
    "delivery.createEvidence",
    "write",
    "登记用户或Agent交付产物并关联同项目工作项。仅HTTP(S)链接；禁止本地路径。来源固定SELF_REPORTED，不会自动完成任务或发布。",
    schemas.createDeliveryEvidenceSchema.extend({ ...project, ...writeFields }),
    (ctx, a) =>
      write(ctx, a, "delivery.createEvidence", "work_item:update_any", () =>
        evidence.createDeliveryEvidence(
          ctx.actor,
          String(a.projectId),
          input(a),
        ),
      ),
  ),
  tool(
    "delivery.linkEvidence",
    "write",
    "将已有证据关联至同项目工作项；重复关联去重，证据正文保持不可变。",
    z
      .object({ ...ref, workItemIds: schemas.deliveryItemIds, ...writeFields })
      .strict(),
    (ctx, a) =>
      write(ctx, a, "delivery.linkEvidence", "work_item:update_any", () =>
        evidence.linkDeliveryEvidence(
          ctx.actor,
          String(a.projectId),
          String(a.evidenceId),
          a.workItemIds,
        ),
      ),
  ),
];
