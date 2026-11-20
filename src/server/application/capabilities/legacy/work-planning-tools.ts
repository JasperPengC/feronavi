/** 工作项与计划补充工具；由总注册表统一应用 guardTools。 */
import type { ToolDef } from "../tools.ts";
import * as workItems from "../../../services/work-item.service.ts";
import * as transfers from "../../../services/work-item-transfer.service.ts";
import * as relations from "../../../services/relation.service.ts";
import * as planning from "../../../services/planning.service.ts";
import * as issues from "../../../services/issues.service.ts";
import * as milestones from "../../../services/milestone-detail.service.ts";
import * as extra from "../../../services/mcp-work-planning.service.ts";
import { withIdempotency } from "../../../services/idempotency.service.ts";

const UUID = { type: "string", format: "uuid" };
const nullable = (schema: Record<string, unknown>) => ({
  ...schema,
  type: [schema.type, "null"],
});
const text = (maxLength: number) => ({ type: "string", maxLength });
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const name = { type: "string", minLength: 1, maxLength: 200 };
const idem = {
  idempotencyKey: { type: "string", minLength: 1, maxLength: 200 },
};
type Definition = ToolDef & {
  scope?: "personal";
  destructive?: boolean;
  idempotent?: boolean;
};
function tool(
  name: string,
  description: string,
  kind: "read" | "write",
  properties: Record<string, unknown>,
  required: string[],
  handler: ToolDef["handler"],
  options: Partial<
    Pick<Definition, "scope" | "destructive" | "idempotent">
  > = {},
): Definition {
  return {
    name,
    description,
    kind,
    inputSchema: {
      type: "object",
      properties: { ...properties, ...(kind === "write" ? idem : {}) },
      required,
      additionalProperties: false,
    },
    handler:
      kind === "read"
        ? handler
        : async (ctx, args) => {
            await extra.authorizeWorkPlanningWrite(ctx.actor, name, args);
            const result = await withIdempotency(
              {
                actorId: ctx.actor.memberId,
                key: (args.idempotencyKey as string | undefined) ?? null,
                scope: name,
                body: args,
              },
              () => handler(ctx, args),
            );
            return { replayed: result.replayed, result: result.value };
          },
    ...options,
  };
}
const done = async (operation: Promise<void>) => {
  await operation;
  return { ok: true };
};
const id = (args: Record<string, unknown>, key: string) => args[key] as string;
const patch = (args: Record<string, unknown>, key: string) =>
  Object.fromEntries(
    Object.entries(args).filter(
      ([field]) => field !== key && field !== "idempotencyKey",
    ),
  );
const progress = {
  summary: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
  nextSteps: nullable(text(5000)),
  blockers: nullable(text(5000)),
};
const updates: Record<planning.PlanKind, Record<string, unknown>> = {
  milestone: {
    name,
    description: nullable(text(5000)),
    startDate: nullable(date),
    dueDate: nullable(date),
    progressMode: {
      type: "string",
      enum: ["COUNT", "ESTIMATE_WEIGHTED", "MANUAL"],
    },
    progressValue: { type: ["number", "null"], minimum: 0, maximum: 100 },
  },
  iteration: {
    name,
    startDate: date,
    endDate: date,
    carryOver: { type: "boolean" },
  },
  release: {
    name,
    versionTag: nullable(text(100)),
    releaseDate: nullable(date),
    notes: nullable(text(10000)),
  },
  module: { name, parentId: nullable(UUID) },
};
const planTools: Definition[] = [];
for (const kind of ["milestone", "iteration", "release", "module"] as const) {
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  const key = `${kind}Id`;
  const entityLabel = {
    milestone: "里程碑",
    iteration: "迭代",
    release: "版本",
    module: "模块",
  }[kind];
  if (kind !== "milestone")
    planTools.push(
      tool(
        `plan.get${label}`,
        `读取${entityLabel}详情。`,
        "read",
        { [key]: UUID },
        [key],
        (ctx, args) => planning.get(ctx.actor, id(args, key), kind),
      ),
    );
  planTools.push(
    tool(
      `plan.update${label}`,
      `更新${entityLabel}允许编辑的字段。`,
      "write",
      { [key]: UUID, ...updates[kind] },
      [key],
      (ctx, args) =>
        planning.updatePlan(ctx.actor, id(args, key), kind, patch(args, key)),
    ),
  );
  {
    for (const action of ["archive", "unarchive"] as const)
      planTools.push(
        tool(
          `plan.${action}${label}`,
          `${action === "archive" ? "归档" : "恢复"}${entityLabel}；有工作项关联时归档会被拒绝。`,
          "write",
          { [key]: UUID },
          [key],
          (ctx, args) => done(planning[action](ctx.actor, id(args, key), kind)),
          { destructive: action === "archive" },
        ),
      );
  }
}
planTools.push(
  tool("plan.completeIteration", "结束迭代并处理未完成项；targetIterationId为同项目未结束迭代，null回待规划；不传沿用carryOver策略。首个结果永久回放。", "write",
    { iterationId: UUID, targetIterationId: nullable(UUID) }, ["iterationId"],
    (ctx, args) => planning.completeIteration(ctx.actor, id(args, "iterationId"), patch(args, "iterationId")),
    { destructive: true, idempotent: true }),
  tool("plan.completeRelease", "完成版本；仍有未完成工作项时拒绝，完成结果可重复复读。", "write",
    { releaseId: UUID }, ["releaseId"], (ctx, args) => planning.completeRelease(ctx.actor, id(args, "releaseId")),
    { destructive: true, idempotent: true }),
);

export const WORK_PLANNING_TOOLS: ToolDef[] = [
  tool(
    "workitem.children",
    "读取工作项的直接子项。",
    "read",
    { workItemId: UUID },
    ["workItemId"],
    (ctx, args) => workItems.listChildren(ctx.actor, id(args, "workItemId")),
  ),
  tool(
    "workitem.delete",
    "软删除工作项。",
    "write",
    { workItemId: UUID },
    ["workItemId"],
    (ctx, args) =>
      done(workItems.deleteWorkItem(ctx.actor, id(args, "workItemId"))),
    { destructive: true },
  ),
  tool(
    "workitem.transfers",
    "读取工作项转派历史。",
    "read",
    { workItemId: UUID },
    ["workItemId"],
    (ctx, args) => transfers.listTransfers(ctx.actor, id(args, "workItemId")),
  ),
  tool(
    "workitem.transfer",
    "转派工作项并记录原因；version 为当前版本。",
    "write",
    {
      workItemId: UUID,
      assigneeId: nullable(UUID),
      reason: nullable(text(2000)),
      version: { type: "integer", minimum: 1, maximum: 2147483647 },
    },
    ["workItemId", "assigneeId", "version"],
    (ctx, args) =>
      transfers.transferWorkItem(
        ctx.actor,
        id(args, "workItemId"),
        patch(args, "workItemId") as {
          assigneeId: string | null;
          version: number;
          reason?: string | null;
        },
      ),
  ),
  tool(
    "workitem.relations",
    "读取阻塞、被阻塞及其他工作项关系。",
    "read",
    { workItemId: UUID },
    ["workItemId"],
    (ctx, args) => relations.listRelations(ctx.actor, id(args, "workItemId"), ctx.token.projectWhitelist.length ? ctx.token.projectWhitelist : undefined),
  ),
  tool(
    "workitem.unlink",
    "移除属于此工作项的关系。",
    "write",
    { workItemId: UUID, relationId: UUID },
    ["workItemId", "relationId"],
    (ctx, args) =>
      done(
        extra.unlinkRelation(
          ctx.actor,
          id(args, "workItemId"),
          id(args, "relationId"),
        ),
      ),
    { destructive: true },
  ),
  ...planTools,
  tool(
    "plan.listModules",
    "读取项目模块，可包含归档模块。",
    "read",
    { projectId: UUID, includeArchived: { type: "boolean" } },
    ["projectId"],
    (ctx, args) =>
      planning.list(ctx.actor, id(args, "projectId"), "module", {
        includeArchived: args.includeArchived as boolean | undefined,
      }),
  ),
  tool(
    "plan.iterationCapacity",
    "读取迭代的项目成员容量。",
    "read",
    { iterationId: UUID },
    ["iterationId"],
    (ctx, args) =>
      extra.iterationCapacityList(ctx.actor, id(args, "iterationId")),
  ),
  {
    ...tool(
      "plan.setIterationCapacity",
      "设置项目成员迭代容量，点数与小时二选一。",
      "write",
      {
        iterationId: UUID,
        memberId: UUID,
        capacityPoints: { type: "number", minimum: 0, maximum: 99999 },
        capacityHours: { type: "number", minimum: 0, maximum: 999999 },
      },
      ["iterationId", "memberId"],
      (ctx, args) =>
        extra.setIterationCapacity(
          ctx.actor,
          id(args, "iterationId"),
          id(args, "memberId"),
          args as { capacityPoints?: number; capacityHours?: number },
        ),
      { idempotent: true },
    ),
    inputSchema: {
      type: "object",
      properties: {
        iterationId: UUID,
        memberId: UUID,
        capacityPoints: { type: "number", minimum: 0, maximum: 99999 },
        capacityHours: { type: "number", minimum: 0, maximum: 999999 },
        ...idem,
      },
      required: ["iterationId", "memberId"],
      additionalProperties: false,
      oneOf: [
        { required: ["capacityPoints"] },
        { required: ["capacityHours"] },
      ],
    },
  },
  tool(
    "savedView.get",
    "读取本人或可见项目共享保存视图。",
    "read",
    { savedViewId: UUID },
    ["savedViewId"],
    (ctx, args) => planning.getSavedView(ctx.actor, id(args, "savedViewId")),
  ),
  tool(
    "savedView.delete",
    "删除本人保存视图。",
    "write",
    { savedViewId: UUID },
    ["savedViewId"],
    (ctx, args) =>
      done(planning.deleteSavedView(ctx.actor, id(args, "savedViewId"))),
    { destructive: true },
  ),
  tool(
    "savedView.reorder",
    "重新排列本人保存视图，最多 200 项。",
    "write",
    {
      savedViewIds: {
        type: "array",
        items: UUID,
        maxItems: 200,
        uniqueItems: true,
      },
    },
    ["savedViewIds"],
    (ctx, args) =>
      done(
        planning.reorderSavedViews(ctx.actor, args.savedViewIds as string[]),
      ),
    { idempotent: true },
  ),
  tool(
    "workitem.progressUpdates",
    "读取结构化工作项进展。",
    "read",
    { workItemId: UUID },
    ["workItemId"],
    async (ctx, args) => ({
      updates: await issues.listProgressUpdates(
        ctx.actor,
        id(args, "workItemId"),
      ),
    }),
  ),
  tool(
    "workitem.addProgressUpdate",
    "添加工作项进展、下一步和阻塞说明。",
    "write",
    { workItemId: UUID, ...progress },
    ["workItemId", "summary"],
    (ctx, args) =>
      issues.addProgressUpdate(
        ctx.actor,
        id(args, "workItemId"),
        patch(args, "workItemId") as { summary: string },
      ),
  ),
  tool(
    "workitem.deleteProgressUpdate",
    "删除属于此工作项且本人有权管理的进展。",
    "write",
    { workItemId: UUID, workItemProgressUpdateId: UUID },
    ["workItemId", "workItemProgressUpdateId"],
    (ctx, args) =>
      done(
        extra.deleteWorkItemProgress(
          ctx.actor,
          id(args, "workItemId"),
          id(args, "workItemProgressUpdateId"),
        ),
      ),
    { destructive: true },
  ),
  tool(
    "plan.milestoneDetail",
    "读取里程碑、关联工作项和进展。",
    "read",
    { milestoneId: UUID },
    ["milestoneId"],
    (ctx, args) =>
      milestones.milestoneDetail(ctx.actor, id(args, "milestoneId")),
  ),
  tool(
    "plan.milestoneProgressUpdates",
    "读取里程碑进展。",
    "read",
    { milestoneId: UUID },
    ["milestoneId"],
    async (ctx, args) => ({
      updates: (
        await milestones.milestoneDetail(ctx.actor, id(args, "milestoneId"))
      ).progressUpdates,
    }),
  ),
  tool(
    "plan.addMilestoneProgressUpdate",
    "添加里程碑进展。",
    "write",
    { milestoneId: UUID, ...progress },
    ["milestoneId", "summary"],
    (ctx, args) =>
      milestones.addProgressUpdate(
        ctx.actor,
        id(args, "milestoneId"),
        patch(args, "milestoneId") as { summary: string },
      ),
  ),
  tool(
    "plan.deleteMilestoneProgressUpdate",
    "删除属于此里程碑且本人有权管理的进展。",
    "write",
    { milestoneId: UUID, milestoneProgressUpdateId: UUID },
    ["milestoneId", "milestoneProgressUpdateId"],
    (ctx, args) =>
      done(
        extra.deleteMilestoneProgress(
          ctx.actor,
          id(args, "milestoneId"),
          id(args, "milestoneProgressUpdateId"),
        ),
      ),
    { destructive: true },
  ),
];
