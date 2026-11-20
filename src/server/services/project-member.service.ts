/**
 * 项目成员管理（REST 第 5 节：POST/DELETE /projects/:id/members；project:manage_member）
 *
 * 项目成员有两个载体（与 `membersOf` 的读取口径一致）：
 *   · `project_membership`（成员 + 项目级角色，界面"指派"用）
 *   · `role_assignment(scope_type='PROJECT')`（项目档数据范围）
 * 本服务在**同一事务**内同时维护两者，避免"名单里有人但数据范围不生效"。
 */
import { DomainError, forbidden } from "../../shared/errors.ts";
import { db } from "../../db/index.ts";
import { member, projectMembership, role, roleAssignment } from "../../db/schema.ts";
import { and, eq } from "drizzle-orm";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import * as projectRepo from "../repos/project.repo.ts";
import { writeSecurityAudit } from "./audit.service.ts";

function assertManage(actor: Actor, projectId: string): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "project:manage_member", { projectId, teamId: null }, ctx)) throw forbidden();
}

/** 项目成员管理只需要可分配角色标识，不暴露组织角色权限配置。 */
export async function listProjectMemberRoles(actor: Actor, projectId: string) {
  assertManage(actor, projectId);
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, actor.grants.some(grant => grant.scopeType === "ORG")))) throw forbidden();
  return db.select({ id: role.id, key: role.key, name: role.name }).from(role).orderBy(role.key);
}

export async function updateProjectMember(actor: Actor, projectId: string, input: { memberId: string; roleIds: string[] }) {
  assertManage(actor, projectId);
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, actor.grants.some(grant => grant.scopeType === "ORG")))) throw forbidden();
  const [existing] = await db.select({ id: projectMembership.id }).from(projectMembership)
    .where(and(eq(projectMembership.projectId, projectId), eq(projectMembership.memberId, input.memberId))).limit(1);
  if (!existing) throw new DomainError("NOT_FOUND", "项目成员不存在", null);
  return addProjectMember(actor, projectId, input);
}

export async function addProjectMember(actor: Actor, projectId: string, input: { memberId: string; roleId?: string; roleIds?: string[] }) {
  assertManage(actor, projectId);
  const hasOrg = actor.grants.some((g) => g.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg))) throw forbidden();
  const m = (await db.select({ id: member.id, status: member.status }).from(member).where(eq(member.id, input.memberId)).limit(1))[0];
  if (!m || m.status !== "ACTIVE") throw new DomainError("VALIDATION", "成员不存在或未启用", null);
  const roleIds = [...new Set(input.roleIds?.length ? input.roleIds : input.roleId ? [input.roleId] : [])];
  if (roleIds.length === 0) throw new DomainError("VALIDATION", "至少选择一个角色", null);
  const roles = await db.select({ id: role.id, key: role.key, name: role.name }).from(role);
  const byId = new Map(roles.map((r) => [r.id, r]));
  for (const rid of roleIds) if (!byId.has(rid)) throw new DomainError("VALIDATION", `角色不存在：${rid}`, null);
  const r = byId.get(roleIds[0]!)!;
  const primaryRoleId = roleIds[0]!;
  await db.transaction(async (tx) => {
    // ⚠️ 换角色时必须先清掉该项目上的旧 PROJECT 角色指派：只改 membership.role_id 会留下
    //    "旧角色权限仍然生效"的隐性提权（Round 54 e2e 复验发现）。
    await tx.delete(roleAssignment).where(and(
      eq(roleAssignment.memberId, input.memberId), eq(roleAssignment.scopeType, "PROJECT"), eq(roleAssignment.scopeId, projectId),
    ));
    // project_membership 只存一个"主角色"（兼容旧读取）；多角色权限落在 role_assignment。
    await tx.insert(projectMembership).values({ projectId, memberId: input.memberId, roleId: primaryRoleId })
      .onConflictDoUpdate({
        target: [projectMembership.projectId, projectMembership.memberId],
        set: { roleId: primaryRoleId, joinedAt: new Date() },
      });
    for (const rid of roleIds) {
      await tx.insert(roleAssignment).values({
        memberId: input.memberId, roleId: rid, scopeType: "PROJECT", scopeId: projectId,
      }).onConflictDoNothing();
    }
  });
  await writeSecurityAudit({
    actorId: actor.memberId, action: "project.member_added", targetType: "PROJECT", targetId: projectId,
  });
  return { ok: true, memberId: input.memberId, roleId: primaryRoleId, roleIds, roleName: r.name };
}

export async function removeProjectMember(actor: Actor, projectId: string, memberId: string): Promise<void> {
  assertManage(actor, projectId);
  const hasOrg = actor.grants.some((g) => g.scopeType === "ORG");
  if (!(await projectRepo.isVisibleTo(actor.memberId, projectId, hasOrg))) throw forbidden();
  await db.transaction(async (tx) => {
    await tx.delete(projectMembership).where(and(
      eq(projectMembership.projectId, projectId), eq(projectMembership.memberId, memberId),
    ));
    await tx.delete(roleAssignment).where(and(
      eq(roleAssignment.memberId, memberId), eq(roleAssignment.scopeType, "PROJECT"), eq(roleAssignment.scopeId, projectId),
    ));
  });
  await writeSecurityAudit({
    actorId: actor.memberId, action: "project.member_removed", targetType: "PROJECT", targetId: projectId,
  });
}

/** 邀请接受时套用项目成员（内部调用；不重复鉴权 —— 邀请本身已鉴权） */
export async function applyInviteProjectMembership(memberId: string, projectId: string, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) return;
  const roles = await db.select({ id: role.id }).from(role).where(eq(role.id, roleIds[0]!)).limit(1);
  if (!roles[0]) return;   // 角色已被删除：邀请仍生效，只是不授项目角色（不阻断注册）
  await db.transaction(async (tx) => {
    await tx.insert(projectMembership).values({ projectId, memberId, roleId: roles[0]!.id })
      .onConflictDoUpdate({ target: [projectMembership.projectId, projectMembership.memberId], set: { roleId: roles[0]!.id } });
    for (const roleId of roleIds) {
      await tx.insert(roleAssignment).values({ memberId, roleId, scopeType: "PROJECT", scopeId: projectId })
        .onConflictDoNothing();
    }
  });
}
