/** 组织级角色、权限目录与成员角色指派。 */
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  department,
  member, permission, project, projectMembership, role, roleAssignment, rolePermission, team,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor, ScopeType } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { recordBusinessEvent } from "./event-log.ts";
import { publishWorkspaceInvalidation } from "./workspace-events.service.ts";

export interface RoleView {
  id: string;
  key: string;
  name: string;
  isBuiltin: boolean;
  isSystem: boolean;
  permissionKeys: string[];
}

export interface RoleAssignmentView {
  id: string;
  memberId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleIsBuiltin: boolean;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeName: string | null;
}

export type AssignmentInput = {
  memberId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
};

const emptyContext = (actor: Actor): PermissionContext => ({
  memberProjectIds: new Set(),
  memberTeamIds: new Set(),
  memberId: actor.memberId,
});
type RoleReadExecutor = Pick<typeof db, "select">;

async function publishRoleChange(resourceType: "ROLE" | "ROLE_ASSIGNMENT", resourceId: string, memberIds: string[] = []) {
  await publishWorkspaceInvalidation({ domain: "role", resourceType, resourceId });
  if (resourceType === "ROLE") {
    await publishWorkspaceInvalidation({ domain: "directory", resourceType, resourceId });
    for (const memberId of new Set(memberIds)) {
      await publishWorkspaceInvalidation({ domain: "directory", resourceType: "MEMBER", resourceId: memberId, memberId });
    }
  } else {
    for (const memberId of new Set(memberIds)) {
      await publishWorkspaceInvalidation({ domain: "directory", resourceType: "MEMBER", resourceId: memberId });
    }
  }
}

/** 角色管理属于组织级操作，必须同时拥有权限和 ORG 指派。 */
export function assertRoleManagement(actor: Actor): void {
  if (!can(actor, "role:manage", { projectId: null, teamId: null }, emptyContext(actor))) {
    throw forbidden();
  }
}

function validation(message: string, details: unknown = null): never {
  throw new DomainError("VALIDATION", message, details);
}

function conflict(message: string): never {
  throw new DomainError("CONFLICT", message, null);
}

function translateUniqueViolation(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "23505") conflict("该记录已存在");
  throw error;
}

export function validateScopeInput(scopeType: ScopeType, scopeId: string | null): void {
  if (scopeType === "ORG" ? scopeId !== null : !scopeId) {
    validation(scopeType === "ORG" ? "组织范围的 scopeId 必须为空" : "团队或项目范围需要 scopeId");
  }
}

function validateSlug(slug: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug)) {
    validation("角色标识只能使用小写字母、数字和连字符");
  }
  return `custom:${slug}`;
}

async function validatePermissionKeys(keys: string[]): Promise<string[]> {
  if (!Array.isArray(keys) || keys.length > 100 || keys.some((key) => typeof key !== "string")) {
    validation("权限列表不合法");
  }
  const unique = [...new Set(keys)];
  if (unique.length !== keys.length) validation("权限列表不能包含重复项");
  if (unique.length === 0) return unique;
  const known = await db.select({ key: permission.key }).from(permission).where(inArray(permission.key, unique));
  const found = new Set(known.map((row) => row.key));
  const unknown = unique.filter((key) => !found.has(key));
  if (unknown.length) validation("权限列表包含未知权限", { keys: unknown });
  return unique;
}

async function loadRoleViewRows(rows: { id: string; key: string; name: string; isBuiltin: boolean; isSystem: boolean }[]): Promise<RoleView[]> {
  if (rows.length === 0) return [];
  const links = await db.select({ roleId: rolePermission.roleId, permissionKey: rolePermission.permissionKey })
    .from(rolePermission).where(inArray(rolePermission.roleId, rows.map((r) => r.id)));
  const byRole = new Map<string, string[]>();
  for (const link of links) byRole.set(link.roleId, [...(byRole.get(link.roleId) ?? []), link.permissionKey]);
  return rows.map((r) => ({
    ...r,
    permissionKeys: (byRole.get(r.id) ?? []).sort((a, b) => a.localeCompare(b)),
  }));
}

export async function listRoles(actor: Actor): Promise<RoleView[]> {
  assertRoleManagement(actor);
  const rows = await db.select({
    id: role.id, key: role.key, name: role.name, isBuiltin: role.isBuiltin, isSystem: role.isSystem,
  }).from(role).orderBy(asc(role.isBuiltin), asc(role.key));
  return loadRoleViewRows(rows);
}

export async function listPermissionCatalog(actor: Actor) {
  assertRoleManagement(actor);
  const rows = await db.select({ key: permission.key, group: permission.group, description: permission.description })
    .from(permission).orderBy(asc(permission.group), asc(permission.key));
  const groups = new Map<string, typeof rows>();
  for (const item of rows) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups].map(([group, permissions]) => ({ group, permissions }));
}

export async function createRole(actor: Actor, input: { slug: string; name: string; permissionKeys: string[] }): Promise<RoleView> {
  assertRoleManagement(actor);
  const key = validateSlug(input.slug);
  const name = input.name.trim();
  if (!name || name.length > 80) validation("角色名称需要为 1–80 个字符");
  const permissionKeys = await validatePermissionKeys(input.permissionKeys);
  const duplicate = await db.select({ id: role.id }).from(role).where(eq(role.key, key)).limit(1);
  if (duplicate.length) conflict("角色标识已存在");
  try {
    const created = await db.transaction(async (tx) => {
      const [createdRole] = await tx.insert(role).values({ key, name, isBuiltin: false, isSystem: false }).returning({
        id: role.id, key: role.key, name: role.name, isBuiltin: role.isBuiltin, isSystem: role.isSystem,
      });
      if (permissionKeys.length) {
        await tx.insert(rolePermission).values(permissionKeys.map((permissionKey) => ({ roleId: createdRole!.id, permissionKey })));
      }
      return createdRole!;
    });
    await recordBusinessEvent({
      actor, action: "role.created", targetType: "ROLE", targetId: created.id,
      changes: { roleId: created.id }, severity: "SECURITY",
    });
    await publishRoleChange("ROLE", created.id);
    return { ...created, permissionKeys };
  } catch (error) {
    translateUniqueViolation(error);
  }
}

export async function updateRole(actor: Actor, id: string, patch: { name?: string; permissionKeys?: string[] }): Promise<RoleView> {
  assertRoleManagement(actor);
  if (patch.name === undefined && patch.permissionKeys === undefined) validation("请至少修改一项");
  const name = patch.name?.trim();
  if (name !== undefined && (!name || name.length > 80)) validation("角色名称需要为 1–80 个字符");
  const permissionKeys = patch.permissionKeys === undefined ? undefined : await validatePermissionKeys(patch.permissionKeys);

  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: role.id, key: role.key, name: role.name, isBuiltin: role.isBuiltin, isSystem: role.isSystem,
    }).from(role).where(eq(role.id, id)).for("update").limit(1);
    if (!current) throw forbidden();
    if (current.isBuiltin || current.isSystem) throw forbidden();
    const [updated] = await tx.update(role).set({ ...(name !== undefined ? { name } : {}), updatedAt: new Date() })
      .where(eq(role.id, id)).returning({
        id: role.id, key: role.key, name: role.name, isBuiltin: role.isBuiltin, isSystem: role.isSystem,
      });
    if (permissionKeys !== undefined) {
      await tx.delete(rolePermission).where(eq(rolePermission.roleId, id));
      if (permissionKeys.length) {
        await tx.insert(rolePermission).values(permissionKeys.map((permissionKey) => ({ roleId: id, permissionKey })));
      }
    }
    const assignments = await tx.select({ memberId: roleAssignment.memberId })
      .from(roleAssignment).where(eq(roleAssignment.roleId, id));
    return { role: updated!, memberIds: assignments.map((row) => row.memberId), permissionKeys };
  });
  if (permissionKeys !== undefined) await clearPermissionContextCache(result.memberIds);
  if (result.permissionKeys === undefined) {
    const links = await db.select({ permissionKey: rolePermission.permissionKey }).from(rolePermission)
      .where(eq(rolePermission.roleId, id));
    result.permissionKeys = links.map((row) => row.permissionKey).sort((a, b) => a.localeCompare(b));
  }
  await recordBusinessEvent({
    actor, action: "role.updated", targetType: "ROLE", targetId: id,
    changes: { roleId: id }, severity: "SECURITY",
  });
  await publishRoleChange("ROLE", id, result.memberIds);
  return { ...result.role, permissionKeys: result.permissionKeys };
}

export async function deleteRole(actor: Actor, id: string): Promise<void> {
  assertRoleManagement(actor);
  const memberIds = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: role.id, isBuiltin: role.isBuiltin, isSystem: role.isSystem })
      .from(role).where(eq(role.id, id)).for("update").limit(1);
    if (!current) throw forbidden();
    if (current.isBuiltin || current.isSystem) throw forbidden();
    const projectUses = await tx.select({ id: projectMembership.id }).from(projectMembership)
      .where(eq(projectMembership.roleId, id)).limit(1);
    if (projectUses.length) conflict("该角色仍被项目成员使用");
    const assignments = await tx.delete(roleAssignment).where(eq(roleAssignment.roleId, id))
      .returning({ memberId: roleAssignment.memberId });
    await tx.delete(role).where(eq(role.id, id));
    return assignments.map((row) => row.memberId);
  });
  await clearPermissionContextCache(memberIds);
  await recordBusinessEvent({
    actor, action: "role.deleted", targetType: "ROLE", targetId: id, severity: "SECURITY",
  });
  await publishRoleChange("ROLE", id, memberIds);
}

export async function listScopeOptions(actor: Actor, scopeType: "TEAM" | "PROJECT" | "DEPARTMENT") {
  assertRoleManagement(actor);
  if (scopeType === "DEPARTMENT") {
    const rows = await db.select({ id: department.id, name: department.name }).from(department)
      .where(isNull(department.archivedAt)).orderBy(asc(department.name));
    return { scopeType, scopes: rows };
  }
  if (scopeType === "TEAM") {
    const rows = await db.select({ id: team.id, name: team.name }).from(team)
      .where(isNull(team.archivedAt)).orderBy(asc(team.name));
    return { scopeType, scopes: rows };
  }
  const rows = await db.select({ id: project.id, name: project.name, key: project.key }).from(project)
    .where(isNull(project.archivedAt)).orderBy(asc(project.name));
  return { scopeType, scopes: rows.map((row) => ({ id: row.id, name: `${row.key} · ${row.name}` })) };
}

async function validateAssignmentTarget(input: AssignmentInput, transaction: RoleReadExecutor = db): Promise<void> {
  validateScopeInput(input.scopeType, input.scopeId);
  const [targetMember] = await transaction.select({ id: member.id, status: member.status })
    .from(member).where(and(eq(member.id, input.memberId), isNull(member.anonymizedAt))).limit(1);
  if (!targetMember || targetMember.status !== "ACTIVE") throw forbidden();
  const [targetRole] = await transaction.select({ id: role.id }).from(role).where(eq(role.id, input.roleId)).limit(1);
  if (!targetRole) throw forbidden();
  if (input.scopeType === "TEAM") {
    const [targetTeam] = await transaction.select({ id: team.id }).from(team)
      .where(and(eq(team.id, input.scopeId!), isNull(team.archivedAt))).limit(1);
    if (!targetTeam) throw forbidden();
  }
  if (input.scopeType === "PROJECT") {
    const [targetProject] = await transaction.select({ id: project.id }).from(project)
      .where(and(eq(project.id, input.scopeId!), isNull(project.archivedAt))).limit(1);
    if (!targetProject) throw forbidden();
  }
  if (input.scopeType === "DEPARTMENT") {
    const [targetDept] = await transaction.select({ id: department.id }).from(department)
      .where(and(eq(department.id, input.scopeId!), isNull(department.archivedAt))).limit(1);
    if (!targetDept) throw forbidden();
  }
}

async function assignmentScopeName(scopeType: ScopeType, scopeId: string | null): Promise<string | null> {
  if (scopeType === "ORG" || !scopeId) return null;
  if (scopeType === "DEPARTMENT") {
    return (await db.select({ name: department.name }).from(department).where(eq(department.id, scopeId)).limit(1))[0]?.name ?? null;
  }
  if (scopeType === "TEAM") {
    return (await db.select({ name: team.name }).from(team).where(eq(team.id, scopeId)).limit(1))[0]?.name ?? null;
  }
  const row = (await db.select({ key: project.key, name: project.name }).from(project).where(eq(project.id, scopeId)).limit(1))[0];
  return row ? `${row.key} · ${row.name}` : null;
}

async function assignmentView(row: {
  id: string; memberId: string; roleId: string; roleKey: string; roleName: string;
  roleIsBuiltin: boolean; scopeType: string; scopeId: string | null;
}): Promise<RoleAssignmentView> {
  return {
    ...row,
    scopeType: row.scopeType as ScopeType,
    scopeName: await assignmentScopeName(row.scopeType as ScopeType, row.scopeId),
  };
}

export async function listRoleAssignments(actor: Actor, memberId: string): Promise<RoleAssignmentView[]> {
  assertRoleManagement(actor);
  const [targetMember] = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.id, memberId), isNull(member.anonymizedAt))).limit(1);
  if (!targetMember) throw forbidden();
  const rows = await db.select({
    id: roleAssignment.id, memberId: roleAssignment.memberId, roleId: role.id,
    roleKey: role.key, roleName: role.name, roleIsBuiltin: role.isBuiltin,
    scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId,
  }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(eq(roleAssignment.memberId, memberId)).orderBy(asc(role.key), asc(roleAssignment.scopeType), asc(roleAssignment.scopeId));
  return Promise.all(rows.map(assignmentView));
}

/** 通过真实指派 ID 读取其成员与范围，沿用组织级角色管理权限。 */
export async function getRoleAssignment(actor: Actor, id: string): Promise<RoleAssignmentView> {
  assertRoleManagement(actor);
  const [row] = await db.select({
    id: roleAssignment.id, memberId: roleAssignment.memberId, roleId: role.id,
    roleKey: role.key, roleName: role.name, roleIsBuiltin: role.isBuiltin,
    scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId,
  }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId))
    .innerJoin(member, eq(member.id, roleAssignment.memberId))
    .where(and(eq(roleAssignment.id, id), isNull(member.anonymizedAt))).limit(1);
  if (!row) throw forbidden();
  return assignmentView(row);
}

async function ensureNoDuplicateAssignment(input: AssignmentInput, excludeId?: string, transaction: RoleReadExecutor = db) {
  const where = and(
    eq(roleAssignment.memberId, input.memberId), eq(roleAssignment.roleId, input.roleId),
    eq(roleAssignment.scopeType, input.scopeType),
    input.scopeId === null ? isNull(roleAssignment.scopeId) : eq(roleAssignment.scopeId, input.scopeId),
    excludeId ? ne(roleAssignment.id, excludeId) : undefined,
  );
  const matches = await transaction.select({ id: roleAssignment.id }).from(roleAssignment).where(where).limit(1);
  if (matches.length) conflict("该成员已有相同范围的角色指派");
}

export async function createRoleAssignment(actor: Actor, input: AssignmentInput): Promise<RoleAssignmentView> {
  assertRoleManagement(actor);
  try {
    const row = await db.transaction(async (tx) => {
      await validateAssignmentTarget(input, tx);
      await ensureNoDuplicateAssignment(input, undefined, tx);
      const [created] = await tx.insert(roleAssignment).values(input).returning({
        id: roleAssignment.id, memberId: roleAssignment.memberId, roleId: roleAssignment.roleId,
        scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId,
      });
      return created!;
    });
    await clearPermissionContextCache([input.memberId]);
    const [view] = await db.select({
      id: roleAssignment.id, memberId: roleAssignment.memberId, roleId: role.id,
      roleKey: role.key, roleName: role.name, roleIsBuiltin: role.isBuiltin,
      scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId,
    }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId)).where(eq(roleAssignment.id, row.id)).limit(1);
    const viewOut = await assignmentView(view!);
    await recordBusinessEvent({
      actor, action: "role.granted", targetType: "ROLE_ASSIGNMENT", targetId: viewOut.id,
      changes: { roleId: viewOut.roleId }, severity: "SECURITY",
    });
    await publishRoleChange("ROLE_ASSIGNMENT", viewOut.id, [viewOut.memberId]);
    return viewOut;
  } catch (error) {
    translateUniqueViolation(error);
  }
}

export async function updateRoleAssignment(actor: Actor, id: string, patch: {
  roleId: string; scopeType: ScopeType; scopeId: string | null;
}): Promise<RoleAssignmentView> {
  assertRoleManagement(actor);
  try {
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ memberId: roleAssignment.memberId }).from(roleAssignment)
        .where(eq(roleAssignment.id, id)).for("update").limit(1);
      if (!existing) throw forbidden();
      const input = { ...patch, memberId: existing.memberId };
      await validateAssignmentTarget(input, tx);
      await ensureNoDuplicateAssignment(input, id, tx);
      const [updated] = await tx.update(roleAssignment).set({
        roleId: patch.roleId, scopeType: patch.scopeType, scopeId: patch.scopeId,
      }).where(eq(roleAssignment.id, id)).returning({ id: roleAssignment.id });
      return { id: updated!.id, memberId: existing.memberId };
    });
    await clearPermissionContextCache([row.memberId]);
    const [view] = await db.select({
      id: roleAssignment.id, memberId: roleAssignment.memberId, roleId: role.id,
      roleKey: role.key, roleName: role.name, roleIsBuiltin: role.isBuiltin,
      scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId,
    }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId)).where(eq(roleAssignment.id, id)).limit(1);
    const viewOut = await assignmentView(view!);
    await recordBusinessEvent({
      actor, action: "role.assignment_updated", targetType: "ROLE_ASSIGNMENT", targetId: id,
      changes: { roleId: viewOut.roleId }, severity: "SECURITY",
    });
    await publishRoleChange("ROLE_ASSIGNMENT", id, [viewOut.memberId]);
    return viewOut;
  } catch (error) {
    translateUniqueViolation(error);
  }
}

export async function deleteRoleAssignment(actor: Actor, id: string): Promise<void> {
  assertRoleManagement(actor);
  const [removed] = await db.delete(roleAssignment).where(eq(roleAssignment.id, id))
    .returning({ memberId: roleAssignment.memberId });
  if (!removed) throw forbidden();
  await clearPermissionContextCache([removed.memberId]);
  await recordBusinessEvent({
    actor, action: "role.revoked", targetType: "ROLE_ASSIGNMENT", targetId: id, severity: "SECURITY",
  });
  await publishRoleChange("ROLE_ASSIGNMENT", id, [removed.memberId]);
}

/** 清理服务端 actor-loader 使用的成员数据范围热缓存；缓存异常不阻塞权限变更。 */
async function clearPermissionContextCache(memberIds: string[]): Promise<void> {
  if (!process.env.REDIS_URL) return;
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return;
  try {
    const { getRedisClient } = await import("../auth/cache.ts");
    await getRedisClient().del(...ids.map((memberId) => `perm-ctx:${memberId}`));
  } catch {
    // Valkey 是可丢缓存，读路径会从数据库回源。
  }
}
