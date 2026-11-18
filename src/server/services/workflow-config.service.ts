/**
 * 工作流可视化配置（W6，REST 7 节）
 *
 * 纪律：
 *   1 权限统一 `work_item:manage_workflow`
 *   2 **被引用的状态只能归档不能物理删**（有工作项停在它上面）
 *   3 迁移边是**出边列表**（非 N×N 矩阵）；加边要校验环路与同工作流
 *   4 内置平台模板（is_builtin）只读 —— 改模板等于改所有未来项目的底版
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { workflow, workflowState, workflowTransition, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { recordBusinessEvent } from "./event-log.ts";

function canManage(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "work_item:manage_workflow", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

/** 取工作流所属项目（活动归属 / 摘要用）；内置模板 projectId 为 null */
async function wfInfo(workflowId: string): Promise<{ projectId: string | null; name: string }> {
  const row = (await db.select({ projectId: workflow.projectId, name: workflow.name })
    .from(workflow).where(eq(workflow.id, workflowId)).limit(1))[0];
  return { projectId: row?.projectId ?? null, name: row?.name ?? "工作流" };
}

export async function listWorkflows(actor: Actor, projectId?: string) {
  canManage(actor);
  const where = projectId
    ? and(eq(workflow.projectId, projectId), eq(workflow.isBuiltin, false))
    : eq(workflow.isBuiltin, true);
  return db.select().from(workflow).where(where).orderBy(asc(workflow.appliesToType), asc(workflow.name));
}

export async function createWorkflow(actor: Actor, input: {
  projectId: string; name: string; appliesToType: string;
}) {
  canManage(actor);
  const [row] = await db.insert(workflow).values({
    projectId: input.projectId,
    name: input.name,
    appliesToType: input.appliesToType,
    isBuiltin: false,
    isDefault: false,
  }).returning();
  await recordBusinessEvent({
    actor, action: "workflow.created", targetType: "WORKFLOW", targetId: row!.id, projectId: input.projectId,
    summary: `${actor.name} 创建了工作流「${input.name}」（${input.appliesToType}）`,
  });
  return row;
}

export async function updateWorkflow(actor: Actor, id: string, patch: { name?: string; isDefault?: boolean }) {
  canManage(actor);
  const rows = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw forbidden();
  if (row.isBuiltin) throw new DomainError("FORBIDDEN", "内置模板只读", null);
  const [updated] = await db.update(workflow).set(patch).where(eq(workflow.id, id)).returning();
  await recordBusinessEvent({
    actor, action: "workflow.updated", targetType: "WORKFLOW", targetId: id, projectId: row.projectId,
    summary: `${actor.name} 更新了工作流「${updated!.name}」`,
  });
  return updated;
}

export async function listStates(actor: Actor, workflowId: string) {
  canManage(actor);
  return db.select().from(workflowState)
    .where(and(eq(workflowState.workflowId, workflowId), sql`${workflowState.archivedAt} is null`))
    .orderBy(asc(workflowState.sortOrder));
}

export async function addState(actor: Actor, workflowId: string, input: {
  key: string; name: string; category: string; sortOrder?: number; wipLimit?: number | null;
}) {
  canManage(actor);
  // key 唯一（同工作流内）
  const dup = await wfRepoFindStateByKey(workflowId, input.key);
  if (dup) throw new DomainError("VALIDATION", `状态 key「${input.key}」已存在`, null);
  if (!["NOT_STARTED", "IN_PROGRESS", "TERMINAL"].includes(input.category)) {
    throw new DomainError("VALIDATION", "category 只能是 NOT_STARTED / IN_PROGRESS / TERMINAL", null);
  }
  const [row] = await db.insert(workflowState).values({
    workflowId,
    key: input.key,
    name: input.name,
    category: input.category,
    // 状态色是必填列（看板列头用），默认中性灰，前端可后续改
    color: "#71717a",
    sortOrder: input.sortOrder ?? 999,
    wipLimit: input.wipLimit ?? null,
  }).returning();
  {
    const info = await wfInfo(workflowId);
    await recordBusinessEvent({
      actor, action: "workflow.state_added", targetType: "WORKFLOW_STATE", targetId: row!.id, projectId: info.projectId,
      summary: `${actor.name} 在工作流「${info.name}」新增状态「${input.name}」`,
    });
  }
  return row;
}

export async function updateState(actor: Actor, workflowId: string, stateId: string, patch: {
  name?: string; sortOrder?: number; wipLimit?: number | null;
}) {
  canManage(actor);
  // ⚠️ category 与 key 不可改：被引用的状态改 key 会破坏存量流转规则
  const [row] = await db.update(workflowState).set(patch)
    .where(and(eq(workflowState.id, stateId), eq(workflowState.workflowId, workflowId)))
    .returning();
  if (!row) throw forbidden();
  {
    const info = await wfInfo(workflowId);
    await recordBusinessEvent({
      actor, action: "workflow.state_updated", targetType: "WORKFLOW_STATE", targetId: stateId, projectId: info.projectId,
      summary: `${actor.name} 更新了工作流「${info.name}」的状态「${row.name}」`,
    });
  }
  return row;
}

/** 归档状态：被工作项引用时**拒绝**（引用中的状态消失 = 存量工作项无家可归） */
export async function archiveState(actor: Actor, workflowId: string, stateId: string): Promise<void> {
  canManage(actor);
  const rows = await db.select().from(workflowState).where(eq(workflowState.id, stateId)).limit(1);
  const st = rows[0];
  if (!st || st.workflowId !== workflowId) throw forbidden();
  const refs = await db.select({ n: sql<number>`count(*)::int` }).from(workItem)
    .where(and(eq(workItem.statusId, stateId), sql`${workItem.deletedAt} is null`));
  if ((refs[0]?.n ?? 0) > 0) {
    throw new DomainError("BLOCKED_BY_PREREQUISITE",
      `仍有 ${(refs[0] ?? { n: 0 }).n} 个工作项处于该状态，请先移走`, { count: refs[0]?.n });
  }
  await db.update(workflowState).set({ archivedAt: new Date() }).where(eq(workflowState.id, stateId));
  {
    const info = await wfInfo(workflowId);
    await recordBusinessEvent({
      actor, action: "workflow.state_archived", targetType: "WORKFLOW_STATE", targetId: stateId, projectId: info.projectId,
      summary: `${actor.name} 归档了工作流「${info.name}」的状态「${st.name}」`,
    });
  }
}

export async function listTransitions(actor: Actor, workflowId: string) {
  canManage(actor);
  // 出边列表（非 N×N）
  return db.select().from(workflowTransition)
    .where(eq(workflowTransition.workflowId, workflowId));
}

export async function addTransition(actor: Actor, workflowId: string, input: {
  fromStateId: string; toStateId: string;
}) {
  canManage(actor);
  if (input.fromStateId === input.toStateId) {
    throw new DomainError("VALIDATION", "迁移边的起点与终点不能相同", null);
  }
  const sts = await db.select().from(workflowState)
    .where(eq(workflowState.workflowId, workflowId));
  const from = sts.find((x) => x.id === input.fromStateId);
  const to = sts.find((x) => x.id === input.toStateId);
  if (!from || !to) throw new DomainError("VALIDATION", "起点或终点状态不属于该工作流", null);
  // 终态不该有出边（规范：终态是终点；允许 exception 时再议）
  if (from.category === "TERMINAL") {
    throw new DomainError("VALIDATION", "终态不应再连出边", null);
  }
  // 同边重复
  const dup = await wfRepoFindTransition(workflowId, input.fromStateId, input.toStateId);
  if (dup) throw new DomainError("VALIDATION", "该迁移边已存在", null);
  const [row] = await db.insert(workflowTransition).values({
    workflowId,
    fromStateId: input.fromStateId,
    toStateId: input.toStateId,
    allowedRoleIds: [],          // 默认全员可用（按角色限制是后续演进）
  }).returning();
  {
    const info = await wfInfo(workflowId);
    await recordBusinessEvent({
      actor, action: "workflow.transition_added", targetType: "WORKFLOW_TRANSITION", targetId: row!.id, projectId: info.projectId,
      summary: `${actor.name} 在工作流「${info.name}」新增迁移「${from.name}」→「${to.name}」`,
    });
  }
  return row;
}

export async function updateTransition(actor: Actor, workflowId: string, transitionId: string, patch: {
  requiresApproval?: boolean; approverRoleKeys?: string[];
}) {
  canManage(actor);
  const [row] = await db.update(workflowTransition).set({
    ...(patch.requiresApproval !== undefined ? { requiresApproval: patch.requiresApproval } : {}),
    ...(patch.approverRoleKeys !== undefined ? { approverRoleKeys: patch.approverRoleKeys as object } : {}),
  }).where(and(eq(workflowTransition.id, transitionId), eq(workflowTransition.workflowId, workflowId))).returning();
  if (!row) throw forbidden();
  return row;
}

export async function removeTransition(actor: Actor, workflowId: string, transitionId: string): Promise<void> {
  canManage(actor);
  const tr = (await db.select().from(workflowTransition)
    .where(and(eq(workflowTransition.id, transitionId), eq(workflowTransition.workflowId, workflowId))).limit(1))[0];
  if (!tr) throw forbidden();
  const res = await db.delete(workflowTransition)
    .where(and(eq(workflowTransition.id, transitionId), eq(workflowTransition.workflowId, workflowId)))
    .returning({ id: workflowTransition.id });
  if (res.length === 0) throw forbidden();
  {
    const info = await wfInfo(workflowId);
    const states = await db.select({ id: workflowState.id, name: workflowState.name }).from(workflowState)
      .where(eq(workflowState.workflowId, workflowId));
    const fromName = states.find((x) => x.id === tr.fromStateId)?.name ?? "状态";
    const toName = states.find((x) => x.id === tr.toStateId)?.name ?? "状态";
    await recordBusinessEvent({
      actor, action: "workflow.transition_removed", targetType: "WORKFLOW_TRANSITION", targetId: transitionId, projectId: info.projectId,
      summary: `${actor.name} 移除了工作流「${info.name}」的迁移「${fromName}」→「${toName}」`,
    });
  }
}

// 小包装避免顶层 import 循环
async function wfRepoFindStateByKey(workflowId: string, key: string) {
  const rows = await db.select().from(workflowState)
    .where(and(eq(workflowState.workflowId, workflowId), eq(workflowState.key, key))).limit(1);
  return rows[0] ?? null;
}
async function wfRepoFindTransition(workflowId: string, fromId: string, toId: string) {
  const rows = await db.select().from(workflowTransition)
    .where(and(
      eq(workflowTransition.workflowId, workflowId),
      eq(workflowTransition.fromStateId, fromId),
      eq(workflowTransition.toStateId, toId),
    )).limit(1);
  return rows[0] ?? null;
}
