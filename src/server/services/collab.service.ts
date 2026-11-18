/**
 * 协作者 + 关注者（B2，REST 6 节 + 数据模型 3.4b + C-23/C-24）
 *
 * C-23 三者不可混：assignee 唯一主责 / collaborator 有编辑权 / follower 只收通知。
 * C-24：协作者的编辑权**不得高于其项目角色** —— 具体 = 协作身份只隐含
 *       `work_item:update`（经 update_own 判定路径），绝不隐含 delete / manage_workflow。
 */
import { and, eq, sql } from "drizzle-orm";
import { db, sql as pgsql } from "../../db/index.ts";
import { subscription, workItem, workItemCollaborator } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

async function targetOf(actor: Actor, workItemId: string) {
  const rows = await db.select().from(workItem).where(eq(workItem.id, workItemId)).limit(1);
  const wi = rows[0];
  if (!wi || wi.deletedAt) throw forbidden();
  if (!(await projectRepo.isVisibleTo(actor.memberId, wi.projectId, hasOrgGrant(actor)))) {
    // C-23：协作者对所协作项可见（关注/协作入口都在这里）
    const { isCollaborator } = await import("./collab.service.ts").then((m) => m);
    if (!(await isCollaborator(actor.memberId, workItemId))) throw forbidden();
  }
  return wi;
}

// ── 协作者 ──────────────────────────────────────────────────

export async function listCollaborators(actor: Actor, workItemId: string) {
  await targetOf(actor, workItemId);
  return db.select({ memberId: workItemCollaborator.memberId, createdAt: workItemCollaborator.createdAt })
    .from(workItemCollaborator).where(eq(workItemCollaborator.workItemId, workItemId));
}

export async function addCollaborator(actor: Actor, workItemId: string, memberId: string) {
  const wi = await targetOf(actor, workItemId);
  // 管理权：reporter / assignee / update_any 都可以加协作
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  const allowed = can(actor, "work_item:update_any", { projectId: wi.projectId, createdBy: wi.reporterId }, ctx)
    || actor.memberId === wi.reporterId || actor.memberId === wi.assigneeId;
  if (!allowed) throw forbidden();

  // 数据模型 3.4b 应用层规则：不等于 assignee / reporter（那两身份已隐含编辑权）
  if (memberId === wi.assigneeId || memberId === wi.reporterId) {
    throw new DomainError("VALIDATION", "该成员已是负责人或创建者，无需加为协作者", null);
  }
  const [row] = await db.insert(workItemCollaborator)
    .values({ workItemId, memberId }).onConflictDoNothing().returning();
  return row ?? (await db.select().from(workItemCollaborator)
    .where(and(eq(workItemCollaborator.workItemId, workItemId), eq(workItemCollaborator.memberId, memberId))))[0];
}

export async function removeCollaborator(actor: Actor, workItemId: string, memberId: string): Promise<void> {
  const wi = await targetOf(actor, workItemId);
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  const allowed = can(actor, "work_item:update_any", { projectId: wi.projectId, createdBy: wi.reporterId }, ctx)
    || actor.memberId === wi.reporterId || actor.memberId === memberId;   // 自己可以退出协作
  if (!allowed) throw forbidden();
  const del = await db.delete(workItemCollaborator)
    .where(and(eq(workItemCollaborator.workItemId, workItemId), eq(workItemCollaborator.memberId, memberId)))
    .returning({ memberId: workItemCollaborator.memberId });
  if (del.length === 0) throw forbidden();
}

/** C-24 判定入口：该成员对该工作项是否**有协作编辑权** */
export async function isCollaborator(memberId: string, workItemId: string): Promise<boolean> {
  const rows = await db.select({ m: workItemCollaborator.memberId }).from(workItemCollaborator)
    .where(and(eq(workItemCollaborator.workItemId, workItemId), eq(workItemCollaborator.memberId, memberId))).limit(1);
  return rows.length > 0;
}

// ── 关注（subscription 表，幂等）────────────────────────────

export async function follow(actor: Actor, workItemId: string, channels: string[]): Promise<void> {
  await targetOf(actor, workItemId);
  const chans = channels.length ? channels : ["IN_APP"];
  for (const c of chans) {
    if (!["IN_APP", "EMAIL"].includes(c)) {
      throw new DomainError("VALIDATION", "notify_channel 只支持 IN_APP / EMAIL", null);
    }
    await db.insert(subscription)
      .values({ memberId: actor.memberId, targetType: "WORK_ITEM", targetId: workItemId, notifyChannel: c })
      .onConflictDoNothing();
  }
}

export async function unfollow(actor: Actor, workItemId: string): Promise<void> {
  await targetOf(actor, workItemId);
  await db.delete(subscription)
    .where(and(eq(subscription.memberId, actor.memberId), eq(subscription.targetType, "WORK_ITEM"), eq(subscription.targetId, workItemId)));
}

/** 关注者列表（含成员名/渠道；当前用户是否已关注由前端对照 memberId 判断） */
export async function listWatchers(actor: Actor, workItemId: string) {
  await targetOf(actor, workItemId);
  const rows = await pgsql<{ member_id: string; name: string; username: string; notify_channel: string }[]>`
    select s.member_id, m.name, m.username, s.notify_channel
    from subscription s join member m on m.id = s.member_id
    where s.target_type = 'WORK_ITEM' and s.target_id = ${workItemId}
    order by m.name
  `;
  const byMember = new Map<string, { memberId: string; name: string; username: string; channels: string[] }>();
  for (const r of rows) {
    const entry = byMember.get(r.member_id) ?? { memberId: r.member_id, name: r.name, username: r.username, channels: [] };
    entry.channels.push(r.notify_channel);
    byMember.set(r.member_id, entry);
  }
  return [...byMember.values()];
}

/** 通知扇出用：该工作项的全部关注者（去重；规范：只收通知无编辑权） */
export async function followersOf(workItemId: string): Promise<string[]> {
  const rows = await pgsql<{ member_id: string }[]>`
    select distinct member_id from subscription where target_type = 'WORK_ITEM' and target_id = ${workItemId}
  `;
  return rows.map((r) => r.member_id);
}

void sql;
