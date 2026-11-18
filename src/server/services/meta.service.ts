/**
 * 元信息（第六期，规范 4.9 节 `meta.workflow` / `meta.fields`）
 *
 * 存在的理由（规范原文）：**agent 必须据此判断合法状态与必填字段，不能硬猜**。
 * 因此这里输出的状态/迁移与字段定义必须与实现同源，不许手抄一份容易腐烂的副本。
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { workflow, workflowState, workflowTransition } from "../../db/schema.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as projectRepo from "../repos/project.repo.ts";

function hasOrg(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

/** 项目的工作流全貌：流转规则 + 状态 + 迁移边（含每边允许的角色与必填字段） */
export async function describeWorkflows(actor: Actor, projectId: string) {
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg(actor)))) throw forbidden();

  const flows = await db.select().from(workflow)
    .where(and(eq(workflow.projectId, projectId), eq(workflow.isBuiltin, false)))
    .orderBy(asc(workflow.appliesToType));

  const out = [];
  for (const wf of flows) {
    const states = await db.select().from(workflowState)
      .where(and(eq(workflowState.workflowId, wf.id), isNull(workflowState.archivedAt)))
      .orderBy(asc(workflowState.sortOrder));
    const edges = await db.select().from(workflowTransition)
      .where(eq(workflowTransition.workflowId, wf.id));
    const byId = new Map(states.map((s) => [s.id, s]));
    out.push({
      id: wf.id,
      name: wf.name,
      appliesToType: wf.appliesToType,
      isDefault: wf.isDefault,
      states: states.map((s) => ({
        key: s.key, name: s.name, category: s.category, color: s.color, sortOrder: s.sortOrder,
      })),
      transitions: edges
        .map((e) => ({
          from: byId.get(e.fromStateId)?.key ?? null,
          to: byId.get(e.toStateId)?.key ?? null,
          allowedRoleIds: e.allowedRoleIds,
          requiredFields: e.requiredFields,
        }))
        .filter((e) => e.from && e.to),
    });
  }
  return { projectId, workflows: out };
}

/**
 * 工作项字段定义（内置字段）。
 * ⚠️ 与 `shared/schemas/work-item.ts` 同源：新增字段时必须同时更新这里，
 *    否则 agent 会按旧定义提交而被 VALIDATION 拒绝。
 */
export const WORK_ITEM_FIELDS = [
  { name: "type", type: "enum", required: true, values: ["REQUIREMENT", "TASK", "DEFECT", "SUBTASK"], note: "SUBTASK 必须带 parentId，且继承父项工作流" },
  { name: "title", type: "string", required: true, maxLength: 500 },
  { name: "description", type: "string", required: false, note: "Markdown" },
  { name: "priority", type: "enum", required: false, values: ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"] },
  { name: "severity", type: "enum", required: false, values: ["S1", "S2", "S3", "S4"], note: "仅 DEFECT 可填（DB CHECK 兜底）" },
  { name: "assigneeId", type: "uuid", required: false, note: "人名请先经 project.members 取 ID" },
  { name: "parentId", type: "uuid", required: false, note: "子任务父子层级" },
  { name: "startDate", type: "date", required: false, format: "YYYY-MM-DD" },
  { name: "dueDate", type: "date", required: false, format: "YYYY-MM-DD" },
  { name: "estimatePoints", type: "number", required: false, note: "故事点" },
  { name: "milestoneId", type: "uuid", required: false, note: "必须与工作项同项目" },
  { name: "iterationId", type: "uuid", required: false, note: "必须与工作项同项目" },
  { name: "releaseId", type: "uuid", required: false, note: "必须与工作项同项目" },
  { name: "moduleId", type: "uuid", required: false, note: "必须与工作项同项目" },
] as const;

export function describeFields() {
  return {
    fields: WORK_ITEM_FIELDS,
    note: "状态字段不可直接写：请用 workitem.transition 并先读 meta.workflow 的合法迁移边",
  };
}

void sql;
