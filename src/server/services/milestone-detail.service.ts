/**
 * 里程碑详情（Round 62 对标 YouQu P1）
 *
 * 聚合：里程碑本体 + 项目 + 关联工作项 + 结构化进展记录（summary/nextSteps/blockers）。
 * 进展记录的权限：`milestone:manage`（与里程碑编辑同一权限；参与者只读）。
 * 评论暂不挂里程碑：评论服务当前只对 WORK_ITEM 做可见性判定（不能为了详情页绕过它），如实登记为后续项。
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { member, milestoneProgressUpdate, project, workItem, workflowState } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as planningService from "./planning.service.ts";
import { writeActivity } from "./audit.service.ts";

function assertManage(actor: Actor, projectId: string): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "milestone:manage", { projectId, teamId: null }, ctx)) throw forbidden();
}

export async function milestoneDetail(actor: Actor, milestoneId: string) {
  const ms = await planningService.get(actor, milestoneId, "milestone");
  const projectRow = (await db.select({ id: project.id, key: project.key, name: project.name })
    .from(project).where(eq(project.id, ms.projectId)).limit(1))[0];
  const related = await db.select({
    id: workItem.id, key: workItem.key, title: workItem.title, type: workItem.type,
    statusName: workflowState.name, statusCategory: workflowState.category, priority: workItem.priority, dueDate: workItem.dueDate,
  }).from(workItem).leftJoin(workflowState, eq(workflowState.id, workItem.statusId))
    .where(and(eq(workItem.milestoneId, milestoneId), isNull(workItem.deletedAt)))
    .orderBy(desc(workItem.updatedAt)).limit(50);
  const updates = await db.select({
    id: milestoneProgressUpdate.id, summary: milestoneProgressUpdate.summary,
    nextSteps: milestoneProgressUpdate.nextSteps, blockers: milestoneProgressUpdate.blockers,
    createdAt: milestoneProgressUpdate.createdAt, authorName: member.name,
  }).from(milestoneProgressUpdate).leftJoin(member, eq(member.id, milestoneProgressUpdate.authorId))
    .where(eq(milestoneProgressUpdate.milestoneId, milestoneId))
    .orderBy(desc(milestoneProgressUpdate.createdAt));
  return { milestone: ms, project: projectRow ?? null, relatedWorkItems: related, progressUpdates: updates };
}

export async function addProgressUpdate(actor: Actor, milestoneId: string, input: {
  summary: string; nextSteps?: string | null; blockers?: string | null;
}) {
  const ms = await planningService.get(actor, milestoneId, "milestone");
  assertManage(actor, ms.projectId);
  const [row] = await db.insert(milestoneProgressUpdate).values({
    projectId: ms.projectId, milestoneId, authorId: actor.memberId,
    summary: input.summary.trim(),
    nextSteps: input.nextSteps?.trim() || null,
    blockers: input.blockers?.trim() || null,
  }).returning();
  await writeActivity({
    projectId: ms.projectId, actorId: actor.memberId, targetType: "MILESTONE", targetId: milestoneId,
    action: "milestone.progress_added",
    summary: `${actor.name} 更新了里程碑「${ms.name}」进展：${input.summary.slice(0, 60)}`,
  });
  return row;
}

export async function deleteProgressUpdate(actor: Actor, updateId: string): Promise<void> {
  const row = (await db.select().from(milestoneProgressUpdate).where(eq(milestoneProgressUpdate.id, updateId)).limit(1))[0];
  if (!row) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const isAuthor = row.authorId === actor.memberId;
  if (!isAuthor) assertManage(actor, row.projectId);
  await db.delete(milestoneProgressUpdate).where(eq(milestoneProgressUpdate.id, updateId));
}
