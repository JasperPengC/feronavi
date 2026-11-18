/**
 * 工作项转派（Round 79 · 对标 YouQu BugTransfer/Watcher）
 *
 * 与普通 PATCH 的区别：转派是**独立语义动作**，要求 `work_item:assign`，并强制写转派历史。
 * 普通 PATCH/POST assign 改指派人时也会在 work-item.service 里落历史（reason 为空）。
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { member, workItemTransfer } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as wiService from "./work-item.service.ts";

export async function listTransfers(actor: Actor, workItemId: string) {
  const wi = await wiService.getWorkItem(actor, workItemId);
  const rows = await db.select({
    id: workItemTransfer.id, fromAssigneeId: workItemTransfer.fromAssigneeId,
    toAssigneeId: workItemTransfer.toAssigneeId, actorId: workItemTransfer.actorId,
    reason: workItemTransfer.reason, createdAt: workItemTransfer.createdAt,
  }).from(workItemTransfer).where(eq(workItemTransfer.workItemId, workItemId))
    .orderBy(desc(workItemTransfer.createdAt));
  const memberIds = [...new Set(rows.flatMap((r) => [r.fromAssigneeId, r.toAssigneeId, r.actorId]).filter(Boolean) as string[])];
  const names = memberIds.length
    ? await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, memberIds))
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n.name]));
  void wi;
  return rows.map((r) => ({
    ...r,
    fromName: r.fromAssigneeId ? nameMap.get(r.fromAssigneeId) ?? null : null,
    toName: r.toAssigneeId ? nameMap.get(r.toAssigneeId) ?? null : null,
    actorName: r.actorId ? nameMap.get(r.actorId) ?? null : null,
  }));
}

export async function transferWorkItem(actor: Actor, workItemId: string, input: { assigneeId: string | null; reason?: string | null; version: number }) {
  const wi = await wiService.getWorkItem(actor, workItemId);
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "work_item:assign", { projectId: (wi as { projectId: string }).projectId, createdBy: (wi as { reporterId?: string }).reporterId ?? null }, ctx)) {
    throw forbidden();
  }
  if (input.assigneeId === (wi as { assigneeId: string | null }).assigneeId) {
    throw new DomainError("VALIDATION", "该工作项已指派给此成员", null);
  }
  return wiService.updateWorkItem(actor, workItemId, {
    version: input.version, assigneeId: input.assigneeId, assigneeReason: input.reason ?? null,
  });
}
