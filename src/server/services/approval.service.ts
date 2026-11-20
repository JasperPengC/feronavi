/** 工作项审批：流转配置 requiresApproval 时先落待审批记录，审批通过后才真正流转。 */
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.ts";
import { approvalRequest, workflowState, workItem } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, roleKeysForScope, type PermissionContext } from "../permission/engine.ts";
import * as wiRepo from "../repos/work-item.repo.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { writeSecurityAudit } from "./audit.service.ts";
import { lockProjectTree } from "./project-tree.ts";
import { recordBusinessEvent } from "./event-log.ts";

async function visible(actor: Actor, projectId: string) {
  const org = actor.grants.some((g) => g.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, org))) throw forbidden();
}
function ctx(actor: Actor): PermissionContext {
  return { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
}

export async function listForItem(actor: Actor, workItemId: string) {
  const wi = await wiRepo.findById(workItemId);
  if (!wi) throw new DomainError("NOT_FOUND", "工作项不存在", null);
  await visible(actor, wi.projectId);
  const fromState = alias(workflowState, "approval_from_state");
  const toState = alias(workflowState, "approval_to_state");
  return db.select({ ...getTableColumns(approvalRequest), fromStateName: fromState.name, toStateName: toState.name }).from(approvalRequest)
    .leftJoin(fromState, eq(fromState.id, approvalRequest.fromStateId))
    .leftJoin(toState, eq(toState.id, approvalRequest.toStateId))
    .where(eq(approvalRequest.workItemId, workItemId))
    .orderBy(desc(approvalRequest.createdAt));
}

/** 流程拦截：创建待审批记录；重复提交返回同一条 pending。 */
export async function requestApproval(actor: Actor, item: NonNullable<Awaited<ReturnType<typeof wiRepo.findById>>>, input: {
  fromStateId: string; toStateId: string; approverRoleKeys: string[]; fields?: Record<string, unknown>;
}) {
  return db.transaction(async () => {
    await lockProjectTree(item.projectId);
    const current = await wiRepo.findById(item.id);
    if (!current || current.workflowId !== item.workflowId || current.statusId !== input.fromStateId) {
      throw new DomainError("CONFLICT", "工作项状态已变化，请重新发起审批", null);
    }
    if (current.version !== item.version) throw new DomainError("VERSION_CONFLICT", "该工作项已被他人修改，请刷新后重试", null);
    return requestApprovalLocked(actor, current, input);
  });
}

async function requestApprovalLocked(actor: Actor, item: NonNullable<Awaited<ReturnType<typeof wiRepo.findById>>>, input: {
  fromStateId: string; toStateId: string; approverRoleKeys: string[]; fields?: Record<string, unknown>;
}) {
  const pending = (await db.select().from(approvalRequest)
    .where(and(eq(approvalRequest.workItemId, item.id), eq(approvalRequest.status, "PENDING"))).limit(1))[0];
  if (pending) return pending;
  const [row] = await db.insert(approvalRequest).values({
    workItemId: item.id, workflowId: item.workflowId,
    fromStateId: input.fromStateId, toStateId: input.toStateId,
    requestedBy: actor.memberId, approverRoleKeys: input.approverRoleKeys as object,
    transitionFields: input.fields ?? {},
  }).returning();
  await writeSecurityAudit({
    actorId: actor.memberId, action: "approval.requested", targetType: "WORK_ITEM", targetId: item.id, ip: null,
  });
  return row!;
}

/** MCP 工具做项目白名单守卫用：审批记录 → 工作项项目。 */
export async function projectIdForApproval(id: string): Promise<string | null> {
  const row = (await db.select({ projectId: workItem.projectId }).from(approvalRequest)
    .innerJoin(workItem, eq(workItem.id, approvalRequest.workItemId))
    .where(eq(approvalRequest.id, id)).limit(1))[0];
  return row?.projectId ?? null;
}

/** 幂等结果重放也要按当前项目角色重新授权。 */
export async function assertCanDecide(actor: Actor, id: string) {
  const row = (await db.select().from(approvalRequest).where(eq(approvalRequest.id, id)).limit(1))[0];
  if (!row) throw new DomainError("NOT_FOUND", "审批不存在", null);
  const wi = await wiRepo.findById(row.workItemId);
  if (!wi) throw new DomainError("NOT_FOUND", "工作项不存在", null);
  await visible(actor, wi.projectId);
  const roles = Array.isArray(row.approverRoleKeys) ? row.approverRoleKeys as string[] : [];
  const effectiveRoles = roleKeysForScope(actor, { projectId: wi.projectId });
  if (!roles.some(role => effectiveRoles.has(role)) && !can(actor, "project:update", { projectId: wi.projectId, teamId: null }, ctx(actor))) throw forbidden();
  return { approval: row, workItem: wi };
}

export async function decide(actor: Actor, id: string, decision: "approve" | "reject", comment?: string) {
  const projectId = await projectIdForApproval(id);
  if (!projectId) throw new DomainError("NOT_FOUND", "审批不存在", null);
  await visible(actor, projectId);
  return db.transaction(async () => {
    // 与工作项流转保持同一项目锁顺序，再锁审批行；决定与状态流转原子提交。
    await lockProjectTree(projectId);
    await db.select({ id: approvalRequest.id }).from(approvalRequest).where(eq(approvalRequest.id, id)).for("update");
    return decideLocked(actor, id, decision, comment);
  });
}

async function decideLocked(actor: Actor, id: string, decision: "approve" | "reject", comment?: string) {
  const { approval: row, workItem: wi } = await assertCanDecide(actor, id);
  if (row.status !== "PENDING") throw new DomainError("VALIDATION", "该审批已处理", null);

  if (decision === "reject") {
    const [updated] = await db.update(approvalRequest).set({
      status: "REJECTED", comment: comment?.slice(0, 1000) ?? null, decidedBy: actor.memberId, decidedAt: new Date(),
    }).where(and(eq(approvalRequest.id, id), eq(approvalRequest.status, "PENDING"))).returning();
    if (!updated) throw new DomainError("VALIDATION", "该审批已处理", null);
    await recordBusinessEvent({ actor, action: "approval.rejected", targetType: "WORK_ITEM", targetId: wi.id, projectId: wi.projectId, severity: "SECURITY",
      invalidation: { domain: "workitem", resourceType: "WORK_ITEM", resourceId: wi.id } });
    return { ...updated, workItemId: wi.id };
  }

  const target = (await db.select().from(workflowState).where(eq(workflowState.id, row.toStateId)).limit(1))[0];
  if (!target) throw new DomainError("VALIDATION", "目标状态不存在", null);
  if (wi.workflowId !== row.workflowId || wi.statusId !== row.fromStateId) throw new DomainError("CONFLICT", "工作项状态已变化，请重新发起审批", null);
  const { transitionWorkItem } = await import("./work-item.service.ts");
  const after = await transitionWorkItem(actor, wi.id, { toStateKey: target.key, version: wi.version, fields: row.transitionFields }, { skipApproval: true });
  const [updated] = await db.update(approvalRequest).set({
    status: "APPROVED", comment: comment?.slice(0, 1000) ?? null, decidedBy: actor.memberId, decidedAt: new Date(),
  }).where(and(eq(approvalRequest.id, id), eq(approvalRequest.status, "PENDING"))).returning();
  if (!updated) throw new DomainError("CONFLICT", "审批状态已变化", null);
  await recordBusinessEvent({ actor, action: "approval.approved", targetType: "WORK_ITEM", targetId: wi.id, projectId: wi.projectId, severity: "SECURITY",
    invalidation: { domain: "workitem", resourceType: "WORK_ITEM", resourceId: wi.id } });
  return { ...updated, workItem: after };
}
