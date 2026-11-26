import { z } from "zod";
import type { ToolDef } from "./tools.ts";
import {
  acknowledgeImpactSchema,
  applyRequirementChangeSchema,
  changeListSchema,
  createRequirementChangeSchema,
  decideRequirementChangeSchema,
} from "../../../shared/schemas/requirement-change.ts";
import * as changes from "../../services/requirement-change.service.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";

const uuid = z.uuid(),
  ref = { workItemId: uuid, changeId: uuid },
  confirmed = { userConfirmed: z.literal(true) };
const json = (s: z.ZodType) =>
  z.toJSONSchema(s, { target: "draft-7" }) as Record<string, unknown>;
// 输出由构建脚本从领域返回类型生成，UI/API/MCP共享相同类型。
const tool = (
  name: string,
  kind: ToolDef["kind"],
  description: string,
  input: z.ZodType,
  handler: ToolDef["handler"],
): ToolDef => ({ name, kind, description, inputSchema: json(input), handler });
export const REQUIREMENT_CHANGE_TOOLS: ToolDef[] = [
  tool(
    "requirementChange.context",
    "read",
    "读取需求当前正文基线、工作项version与同项目任务/计划影响指纹。提案必须携带读取到的三项基线；用例影响在测试域开放后提供。",
    z.object({ workItemId: uuid }).strict(),
    (ctx, a) => changes.getChangeContext(ctx.actor, String(a.workItemId)),
  ),
  tool(
    "requirementChange.list",
    "read",
    "按变更序号倒序分页读取需求提案；nextCursor用于继续读取。",
    changeListSchema.extend({ workItemId: uuid }),
    (ctx, a) => {
      const { workItemId, ...query } = a;
      return changes.listRequirementChanges(
        ctx.actor,
        String(workItemId),
        query,
      );
    },
  ),
  tool(
    "requirementChange.get",
    "read",
    "读取固定原版本、拟议正文、评审/应用/撤回记录、当前权限内影响确认及可用动作。APPLIED表示正文已应用，不表示任务已完成。",
    z.object(ref).strict(),
    (ctx, a) =>
      changes.getRequirementChange(
        ctx.actor,
        String(a.workItemId),
        String(a.changeId),
      ),
  ),
  tool(
    "requirementChange.create",
    "write",
    "提交不可变需求变更提案，需原因、原revision、工作项version与影响指纹；不修改原正文。支持idempotencyKey，重放重验权限。",
    createRequirementChangeSchema.extend({
      workItemId: uuid,
      idempotencyKey: z.string().min(1).max(200).optional(),
      ...confirmed,
    }),
    async (ctx, a) => {
      const {
        workItemId,
        idempotencyKey,
        userConfirmed: _confirmed,
        ...input
      } = a;
      const id = String(workItemId);
      await changes.assertChangeCreatable(ctx.actor, id);
      const result = await withIdempotency(
        {
          actorId: ctx.actor.memberId,
          key: idempotencyKey as string | undefined,
          scope: "requirementChange.create",
          body: a,
        },
        () => changes.createRequirementChange(ctx.actor, id, input),
      );
      return changes.getRequirementChange(ctx.actor, id, result.value.id);
    },
  ),
  tool(
    "requirementChange.decide",
    "write",
    "APPROVE/REJECT由项目管理者评审；CANCEL由提出人或管理者撤回。必须expectedVersion；批准重验正文与影响，撤回保留原评审。OPC可自评审，记录真实身份。",
    decideRequirementChangeSchema.extend({ ...ref, ...confirmed }),
    (ctx, a) => {
      const { workItemId, changeId, userConfirmed: _confirmed, ...input } = a;
      return changes.decideRequirementChange(
        ctx.actor,
        String(workItemId),
        String(changeId),
        input,
      );
    },
  ),
  tool(
    "requirementChange.apply",
    "write",
    "应用APPROVED提案；必须change expectedVersion与当前expectedWorkItemVersion。重验基线、影响、操作者及评审人权限，同事务保存正文revision。过期不能强制覆盖。",
    applyRequirementChangeSchema.extend({ ...ref, ...confirmed }),
    (ctx, a) => {
      const { workItemId, changeId, userConfirmed: _confirmed, ...input } = a;
      return changes.applyRequirementChange(
        ctx.actor,
        String(workItemId),
        String(changeId),
        input,
      );
    },
  ),
  tool(
    "requirementChange.acknowledge",
    "write",
    "APPLIED后由当前负责人或管理者确认单个影响（impactId、expectedVersion和说明）。记录已评估，不替代任务状态流转。成功后回读确认记录。",
    acknowledgeImpactSchema.extend({ ...ref, ...confirmed }),
    (ctx, a) => {
      const { workItemId, changeId, userConfirmed: _confirmed, ...input } = a;
      return changes.acknowledgeRequirementImpact(
        ctx.actor,
        String(workItemId),
        String(changeId),
        input,
      );
    },
  ),
];
