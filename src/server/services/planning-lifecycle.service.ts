/** REST 与 MCP 共用的迭代/版本生命周期；完成、结转和归档都在事务中执行。 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, inTransaction } from "../../db/index.ts";
import { iteration, release, workItem, workflowState, type PlanCompletionResult } from "../../db/schema.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import * as plans from "./planning-access.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { publish } from "./events.service.ts";
import { lockProjectTree } from "./project-tree.ts";
import { businessEffects } from "./business-effects.ts";
import {recordReleaseVerification} from './release-gate.service.ts';

type Kind = "iteration" | "release";
function assertManage(actor: Actor, kind: Kind, projectId: string) {
  if (!can(actor, `${kind}:manage`, { projectId, teamId: null }, { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId })) throw forbidden();
}
async function pending(kind: Kind, id: string) {
  const items = await db.select({ id: workItem.id, statusId: workItem.statusId }).from(workItem)
    .where(and(eq(kind === "iteration" ? workItem.iterationId : workItem.releaseId, id), isNull(workItem.deletedAt)))
    .orderBy(asc(workItem.id)).for("update");
  if (!items.length) return [];
  const states = await db.select({ id: workflowState.id, category: workflowState.category }).from(workflowState)
    .where(inArray(workflowState.id, [...new Set(items.map(item => item.statusId))]));
  const categories = new Map(states.map(state => [state.id, state.category]));
  return items.filter(item => categories.get(item.statusId) !== "TERMINAL");
}

/** 历史回执只补可推导字段，未知计数/ID 保留 null。 */
function previousResult(row: { id: string; projectId: string; completedAt: Date; completionResult: Partial<PlanCompletionResult> | null }): PlanCompletionResult {
  const previous = row.completionResult;
  const movedCount = previous?.movedCount ?? previous?.carriedOverCount ?? null;
  return { id: row.id, projectId: row.projectId, completedAt: row.completedAt.toISOString(),
    targetIterationId: previous?.targetIterationId ?? null,
    movedCount, carriedOverCount: previous?.carriedOverCount ?? movedCount,
    remainingCount: previous?.remainingCount ?? null, movedWorkItemIds: previous?.movedWorkItemIds ?? null };
}

export async function complete(actor: Actor, id: string, kind: Kind, options: { targetIterationId?: string | null } = {}) {
  const initial = await plans.get(actor, id, kind);
  assertManage(actor, kind, initial.projectId);
  return inTransaction(async () => {
    await lockProjectTree(initial.projectId);
    const row = await plans.get(actor, id, kind);
    if (row.completedAt) return { id, completedAt: row.completedAt, alreadyCompleted: true, movedCount: 0, completionResult: previousResult({ ...row, completedAt: row.completedAt }) };
    if (row.archivedAt) throw new DomainError("BLOCKED_BY_PREREQUISITE", "请先恢复归档后再完成计划", null);
    const outstanding = await pending(kind, id);
    let movedCount = 0;
    const movedWorkItemIds: string[] = [];
    if (kind === "release" && outstanding.length) throw new DomainError("BLOCKED_BY_PREREQUISITE", "版本仍有未完成工作项", { pending: outstanding.length });
    if(kind==='release')await recordReleaseVerification(actor,row.projectId,id);
    if (kind === "iteration") {
      const source = await plans.get(actor, id, "iteration");
      if (options.targetIterationId !== undefined && !source.carryOver) throw new DomainError("VALIDATION", "当前迭代已关闭结转，请先启用结转", null);
      if (options.targetIterationId) {
        if (options.targetIterationId === id) throw new DomainError("VALIDATION", "目标迭代不能是当前迭代", null);
        const target = await plans.get(actor, options.targetIterationId, "iteration");
        if (target.projectId !== source.projectId) throw new DomainError("VALIDATION", "目标迭代必须属于同一项目", null);
        if (target.completedAt || target.archivedAt) throw new DomainError("BLOCKED_BY_PREREQUISITE", "目标迭代已完成或归档", null);
      }
      if (outstanding.length && source.carryOver) {
        if (options.targetIterationId === undefined) throw new DomainError("BLOCKED_BY_PREREQUISITE", "未完成工作项需要指定结转目标迭代，或明确移回待规划", { pending: outstanding.length });
        const moved = await db.update(workItem).set({ iterationId: options.targetIterationId, version: sql`${workItem.version} + 1`, updatedAt: new Date() })
          .where(inArray(workItem.id, outstanding.map(item => item.id))).returning({ id: workItem.id, key: workItem.key, version: workItem.version });
        movedCount = moved.length;
        movedWorkItemIds.push(...moved.map(item => item.id));
        for (const item of moved) {
          await recordBusinessEvent({ actor, action: "work_item.updated", targetType: "WORK_ITEM", targetId: item.id, projectId: source.projectId,
            summary: `${actor.name} 将工作项结转至下一迭代`, changes: { iterationId: options.targetIterationId } });
          await publish("workitem.changed", { id: item.id, version: item.version, changedFields: ["iterationId"] }, null);
          await businessEffects().deliverWebhook("work_item.updated", { id: item.id, key: item.key, projectId: source.projectId,
            version: item.version, actorId: actor.memberId, changedFields: ["iterationId"] }, source.projectId);
        }
      }
    }
    const completedAt = new Date();
    const completionResult: PlanCompletionResult = { id, projectId: row.projectId, completedAt: completedAt.toISOString(), movedCount,
      targetIterationId: options.targetIterationId ?? null, movedWorkItemIds, carriedOverCount: movedCount, remainingCount: outstanding.length - movedCount };
    if (kind === "iteration") await db.update(iteration).set({ completedAt, completionResult }).where(eq(iteration.id, id));
    else await db.update(release).set({ completedAt, completionResult }).where(eq(release.id, id));
    await recordBusinessEvent({ actor, action: `plan.${kind}.completed`, targetType: kind.toUpperCase(), targetId: id, projectId: row.projectId,
      summary: `${actor.name} 完成了${kind === "iteration" ? "迭代" : "版本"}「${row.name}」`, changes: { completedAt: completedAt.toISOString(), movedCount, targetIterationId: options.targetIterationId ?? null } });
    return { id, completedAt, alreadyCompleted: false, movedCount, completionResult };
  });
}

export async function setArchived(actor: Actor, id: string, kind: Kind, archived: boolean) {
  const initial = await plans.get(actor, id, kind);
  assertManage(actor, kind, initial.projectId);
  return inTransaction(async () => {
    await lockProjectTree(initial.projectId);
    const row = await plans.get(actor, id, kind);
    if (!!row.archivedAt === archived) return row;
    if (archived && (!row.completedAt || (await pending(kind, id)).length)) throw new DomainError("BLOCKED_BY_PREREQUISITE", "请先完成计划并处理未完成工作项后归档", null);
    const archivedAt = archived ? new Date() : null;
    if (kind === "iteration") await db.update(iteration).set({ archivedAt }).where(eq(iteration.id, id));
    else await db.update(release).set({ archivedAt }).where(eq(release.id, id));
    await recordBusinessEvent({ actor, action: `plan.${kind}.${archived ? "archived" : "unarchived"}`, targetType: kind.toUpperCase(), targetId: id, projectId: row.projectId,
      summary: `${actor.name} ${archived ? "归档" : "恢复归档"}了${kind === "iteration" ? "迭代" : "版本"}「${row.name}」` });
    return { ...row, archivedAt };
  });
}
