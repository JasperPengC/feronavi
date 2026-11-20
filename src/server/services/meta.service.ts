/**
 * 元信息（第六期，规范 4.9 节 `meta.workflow` / `meta.fields`）
 *
 * 存在的理由（规范原文）：**agent 必须据此判断合法状态与必填字段，不能硬猜**。
 * 因此这里输出的状态/迁移与字段定义必须与实现同源，不许手抄一份容易腐烂的副本。
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createWorkItemSchema, updateWorkItemSchema } from "../../shared/schemas/work-item.ts";
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
const createContract = z.toJSONSchema(createWorkItemSchema, { target: "draft-7" });
const updateContract = z.toJSONSchema(updateWorkItemSchema, { target: "draft-7" });
export const WORK_ITEM_FIELDS = Object.entries(createWorkItemSchema.shape).map(([name, field]) => {
  const schema = z.toJSONSchema(field, { target: "draft-7" });
  const value = (schema.anyOf as Record<string, unknown>[] | undefined)?.find((entry) => entry.type !== "null") ?? schema;
  return {
    name,
    type: value.enum ? "enum" : value.format === "uuid" ? "uuid" : name.endsWith("Date") ? "date" : value.type,
    ...(value.enum ? { values: value.enum } : {}),
    ...(value.maxLength ? { maxLength: value.maxLength } : {}),
    required: !field.isOptional(),
    nullable: field.isNullable(),
    schema,
    ...(name === "parentId" ? { note: "SUBTASK 必须带 parentId，父项必须在同项目" } : {}),
    ...(name === "assigneeId" ? { note: "先经 project.members 读取成员ID" } : {}),
  };
});

export function describeFields() {
  return {
    fields: WORK_ITEM_FIELDS,
    schemas: { create: createContract, update: updateContract },
    note: "MCP 创建另需 projectId；MCP 更新用 expectedVersion 对应 version。状态请用 workitem.transition，并先读取实际允许迁移。",
  };
}

void sql;
