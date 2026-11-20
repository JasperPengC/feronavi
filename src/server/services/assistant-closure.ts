/** 显式项目业务闭环：读取前提与执行后的事实采用相同领域契约。 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { approvalRequest, timeLog, workItemRelation } from "../../db/schema.ts";
import type { RagActionProposal, RagResourceRef } from "../../shared/rag.ts";
import { DomainError } from "../../shared/errors.ts";

type Args = Record<string, unknown>;
export interface AssistantClosureRead {
  toolName: string;
  parameters: Args;
}
type Policy = {
  title: string;
  reads: (
    args: Args,
    projectId: string,
    resources: RagResourceRef[],
  ) => AssistantClosureRead[];
};
const read = (toolName: string, parameters: Args): AssistantClosureRead => ({
  toolName,
  parameters,
});
const itemId = (args: Args, resources: RagResourceRef[]) =>
  args.workItemId ??
  args.fromWorkItemId ??
  resources.find((r) => r.kind === "workItem")?.id;
const item =
  (toolName: string) =>
  (args: Args, _projectId: string, resources: RagResourceRef[]) => [
    read(toolName, { workItemId: itemId(args, resources) }),
  ];
const entity = (toolName: string, key: string) => (args: Args) => [
  read(toolName, { [key]: args[key] }),
];
const policies: Record<string, Policy> = {
  "page.restore": {
    title: "恢复文档历史版本",
    reads: entity("page.get", "pageId"),
  },
  "idea.submit": {
    title: "提交项目想法",
    reads: (_args, projectId) => [
      read("idea.list", { projectId, pageSize: 100 }),
    ],
  },
  "idea.update": {
    title: "更新想法及评审状态",
    reads: entity("idea.get", "ideaId"),
  },
  "idea.vote": { title: "为想法投票", reads: entity("idea.get", "ideaId") },
  "idea.unvote": {
    title: "撤销本人想法投票",
    reads: entity("idea.get", "ideaId"),
  },
  "idea.promote": {
    title: "将想法转为工作项",
    reads: entity("idea.get", "ideaId"),
  },
  "workitem.link": {
    title: "建立工作项依赖或关联",
    reads: (args) => [
      read("workitem.relations", { workItemId: args.fromWorkItemId }),
      read("workitem.relations", { workItemId: args.toWorkItemId }),
    ],
  },
  "workitem.unlink": {
    title: "解除工作项依赖或关联",
    reads: item("workitem.relations"),
  },
  "workitem.transfer": {
    title: "交接工作项负责人",
    reads: (args, _projectId, resources) => [
      read("workitem.get", { workItemId: itemId(args, resources) }),
      ...item("workitem.transfers")(args, _projectId, resources),
    ],
  },
  "workitem.addCollaborator": {
    title: "添加工作项协作者",
    reads: item("workitem.collaborators"),
  },
  "workitem.removeCollaborator": {
    title: "移除工作项协作者",
    reads: item("workitem.collaborators"),
  },
  "workitem.addProgressUpdate": {
    title: "记录工作项进展",
    reads: item("workitem.progressUpdates"),
  },
  "workitem.deleteProgressUpdate": {
    title: "删除工作项进展记录",
    reads: item("workitem.progressUpdates"),
  },
  "plan.addMilestoneProgressUpdate": {
    title: "记录里程碑进展",
    reads: entity("plan.milestoneDetail", "milestoneId"),
  },
  "plan.deleteMilestoneProgressUpdate": {
    title: "删除里程碑进展记录",
    reads: entity("plan.milestoneDetail", "milestoneId"),
  },
  "timeLog.create": { title: "登记工作项工时", reads: item("timeLog.list") },
  "timeLog.update": { title: "修改工时记录", reads: item("timeLog.list") },
  "timeLog.delete": { title: "删除工时记录", reads: item("timeLog.list") },
  "sla.pause": { title: "暂停工作项 SLA 时钟", reads: item("sla.get") },
  "sla.resume": { title: "恢复工作项 SLA 时钟", reads: item("sla.get") },
  "approval.approve": {
    title: "通过审批并执行对应流转",
    reads: (args, projectId, resources) => [
      ...item("approval.list")(args, projectId, resources),
      ...item("workitem.get")(args, projectId, resources),
    ],
  },
  "approval.reject": { title: "驳回审批申请", reads: item("approval.list") },
  "customField.setValues": {
    title: "更新工作项自定义字段",
    reads: item("customField.getValues"),
  },
  "plan.setIterationCapacity": {
    title: "设置迭代成员容量",
    reads: entity("plan.iterationCapacity", "iterationId"),
  },
};
for (const kind of ["Milestone", "Iteration", "Release", "Module"] as const) {
  const key = `${kind[0]!.toLowerCase()}${kind.slice(1)}Id`;
  const label = {
    Milestone: "里程碑",
    Iteration: "迭代",
    Release: "版本",
    Module: "模块",
  }[kind];
  for (const action of ["archive", "unarchive"] as const)
    policies[`plan.${action}${kind}`] = {
      title: `${action === "archive" ? "归档" : "恢复"}${label}`,
      reads: entity(`plan.get${kind}`, key),
    };
  if (kind === "Iteration" || kind === "Release")
    policies[`plan.complete${kind}`] = {
      title:
        kind === "Iteration" ? "结束迭代并处理未完成工作项" : "完成项目版本",
      reads: (args, projectId) => [
        read(`plan.get${kind}`, { [key]: args[key] }),
        read("workitem.list", { projectId, [key]: args[key], pageSize: 100 }),
        ...(typeof args.targetIterationId === "string"
          ? [read("plan.getIteration", { iterationId: args.targetIterationId })]
          : []),
      ],
    };
}
export const ASSISTANT_CLOSURE_POLICIES: Readonly<Record<string, Policy>> =
  policies;
export const ASSISTANT_CLOSURE_READ_TOOLS = [
  "project.context",
  "meta.fields",
  "workitem.relations",
  "workitem.transfers",
  "workitem.collaborators",
  "workitem.progressUpdates",
  "plan.milestoneDetail",
  "plan.milestoneProgressUpdates",
  "plan.iterationCapacity",
  "timeLog.list",
  "idea.list",
  "idea.get",
  "sla.get",
  "approval.list",
  "customField.getValues",
  "customField.definitions",
  "insight.burnDown",
  "insight.cumulativeFlow",
  "project.report",
];

/** 以子资源定位父项；真正可见性由后续领域读取检查，而非数据库归属代替。 */
export async function assistantClosureReferences(
  name: string,
  args: Args,
): Promise<RagResourceRef[]> {
  if (!policies[name]) return [];
  if (
    typeof args.timeLogId === "string" ||
    typeof args.approvalId === "string"
  ) {
    const table =
      typeof args.timeLogId === "string" ? timeLog : approvalRequest;
    const id = String(args.timeLogId ?? args.approvalId);
    const [row] = await db
      .select({ workItemId: table.workItemId })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
    if (!row)
      throw new DomainError("NOT_FOUND", "业务记录不存在或不可访问", null);
    return [{ kind: "workItem", id: row.workItemId }];
  }
  if (name === "workitem.unlink" && typeof args.relationId === "string") {
    const [row] = await db
      .select()
      .from(workItemRelation)
      .where(eq(workItemRelation.id, args.relationId))
      .limit(1);
    if (!row || ![row.sourceId, row.targetId].includes(String(args.workItemId)))
      throw new DomainError("NOT_FOUND", "关联不存在或不可访问", null);
    return [
      { kind: "workItem", id: row.sourceId },
      { kind: "workItem", id: row.targetId },
    ];
  }
  return [];
}
export function assistantClosureReads(
  name: string,
  args: Args,
  projectId: string,
  resources: RagResourceRef[],
) {
  return policies[name]?.reads(args, projectId, resources);
}
const labels: Record<string, string> = {
  title: "标题",
  description: "说明",
  status: "评审状态",
  weight: "投票权重",
  type: "类型",
  summary: "进展说明",
  nextSteps: "下一步",
  blockers: "阻塞情况",
  reason: "交接原因",
  minutes: "工时（分钟）",
  loggedDate: "登记日期",
  note: "备注",
  comment: "审批意见",
  capacityPoints: "容量（点数）",
  capacityHours: "容量（小时）",
  values: "自定义字段值",
};
export function assistantClosurePresentation(
  name: string,
  args: Args,
  references: { key: string; label: string }[],
): RagActionProposal["presentation"] {
  const policy = policies[name];
  if (!policy) return undefined;
  const fields = references.map((row) => ({
    label:
      (
        {
          memberId: "成员",
          assigneeId: "负责人",
          targetIterationId: "结转目标",
          fromWorkItemId: "源工作项",
          toWorkItemId: "目标工作项",
          revisionId: "恢复版本",
          relationId: "关联",
          timeLogId: "工时记录",
          approvalId: "审批",
          workItemProgressUpdateId: "进展记录",
          milestoneProgressUpdateId: "进展记录",
        } as Record<string, string>
      )[row.key] ?? "操作对象",
    value: row.label,
  }));
  for (const [key, value] of Object.entries(args)) {
    if (key === "values" && references.some((row) => row.key === "values"))
      continue;
    if (
      key === "idempotencyKey" ||
      key === "expectedVersion" ||
      key === "version" ||
      key.endsWith("Id")
    )
      continue;
    fields.push({
      label: labels[key] ?? key,
      value:
        typeof value === "string"
          ? value
          : value == null
            ? "无"
            : JSON.stringify(value),
    });
  }
  if (name === "workitem.transfer" && args.assigneeId === null)
    fields.push({ label: "负责人", value: "解除负责人，保留交接记录" });
  if (name === "plan.completeIteration" && args.targetIterationId === null)
    fields.push({ label: "未完成项处理", value: "移回待规划" });
  if (name === "plan.completeIteration" && args.targetIterationId === undefined)
    fields.push({
      label: "未完成项处理",
      value: "沿用迭代结转策略；需要目标时拒绝执行",
    });
  return { title: policy.title, fields };
}

/** 与领域操作一致先锁会被覆盖的子记录，再锁其父资源，防止检查后丢失更新。 */
export async function lockAssistantClosureRecords(action: RagActionProposal) {
  const { sql } = await import("drizzle-orm");
  const name = action.toolName;
  const keys: { table: string; column: string; ids: string[] }[] = [];
  const resources = [
    ...(action.resources ?? []),
    ...(action.target ? [action.target] : []),
  ];
  const ids = (kind: RagResourceRef["kind"]) =>
    [
      ...new Set(resources.filter((r) => r.kind === kind).map((r) => r.id)),
    ].sort();
  if (name.startsWith("timeLog."))
    keys.push({
      table: "time_log",
      column: "work_item_id",
      ids: ids("workItem"),
    });
  if (
    name.startsWith("approval.") &&
    typeof action.parameters.approvalId === "string"
  )
    keys.push({
      table: "approval_request",
      column: "id",
      ids: [action.parameters.approvalId],
    });
  if (name === "plan.setIterationCapacity")
    keys.push({
      table: "iteration_capacity",
      column: "iteration_id",
      ids: ids("iteration"),
    });
  if (
    ["workitem.addCollaborator", "workitem.removeCollaborator"].includes(name)
  )
    keys.push({
      table: "work_item_collaborator",
      column: "work_item_id",
      ids: ids("workItem"),
    });
  if (
    ["workitem.addProgressUpdate", "workitem.deleteProgressUpdate"].includes(
      name,
    )
  )
    keys.push({
      table: "work_item_progress_update",
      column: "work_item_id",
      ids: ids("workItem"),
    });
  if (
    [
      "plan.addMilestoneProgressUpdate",
      "plan.deleteMilestoneProgressUpdate",
    ].includes(name)
  )
    keys.push({
      table: "milestone_progress_update",
      column: "milestone_id",
      ids: ids("milestone"),
    });
  if (["idea.vote", "idea.unvote"].includes(name))
    keys.push({ table: "idea_vote", column: "idea_id", ids: ids("idea") });
  if (["sla.pause", "sla.resume"].includes(name))
    keys.push({
      table: "work_item_sla",
      column: "work_item_id",
      ids: ids("workItem"),
    });
  if (
    name === "workitem.unlink" &&
    typeof action.parameters.relationId === "string"
  )
    keys.push({
      table: "work_item_relation",
      column: "id",
      ids: [action.parameters.relationId],
    });
  for (const key of keys)
    if (key.ids.length) {
      // table/column来自上方固定枚举；用户值仅作为绑定UUID参数。
      await db.execute(
        sql`select 1 from ${sql.identifier(key.table)} where ${sql.identifier(key.column)} in (${sql.join(
          key.ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) order by ${sql.identifier(key.column)} for update`,
      );
    }
}
