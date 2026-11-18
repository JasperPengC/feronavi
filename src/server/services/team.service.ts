/**
 * 团队（数据模型 1.2 / REST 第 3 节）
 *
 * 语义：`team` 是 A2 数据范围的 `TEAM` 承载；团队成员由 `role_assignment(scope_type='TEAM', scope_id=团队)`
 * 表示（本仓没有单独的 team_member 表），"含子团队展开"用递归 CTE 完成。
 *
 * 纪律：
 *   1 改父级**必须防环**（C-12）：本轮用 `pg_advisory_xact_lock` 把团队树变更串行化后在同一事务里校验，
 *      避免"两人同时把 A 挂 B、B 挂 A、各自校验都过"的并发成环；
 *   2 删除仅当**无子团队且无成员**；
 *   3 同级重名拒绝（`parent_id IS NULL` 时 PG 唯一索引不生效，应用层显式查重）。
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { member, role, roleAssignment, team } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

function assertManage(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "member:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

export interface TeamNode {
  id: string; name: string; parentId: string | null; sortOrder: number;
  memberCount: number; children: TeamNode[];
}

export async function listTeams(actor: Actor) {
  void actor;   // 目录信息：仅要求已登录
  const rows = await db.select().from(team).where(isNull(team.archivedAt)).orderBy(asc(team.parentId), asc(team.sortOrder), asc(team.name));
  const members = await db.select({ teamId: roleAssignment.scopeId, memberId: roleAssignment.memberId })
    .from(roleAssignment).where(eq(roleAssignment.scopeType, "TEAM"));
  const countByTeam = new Map<string, Set<string>>();
  for (const m of members) {
    if (!m.teamId) continue;
    const set = countByTeam.get(m.teamId) ?? new Set<string>();
    set.add(m.memberId);
    countByTeam.set(m.teamId, set);
  }
  const nodes = new Map<string, TeamNode>(rows.map((r) => [r.id, {
    id: r.id, name: r.name, parentId: r.parentId, sortOrder: r.sortOrder,
    memberCount: countByTeam.get(r.id)?.size ?? 0, children: [],
  }]));
  const roots: TeamNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortTree = (list: TeamNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
    for (const n of list) sortTree(n.children);
  };
  sortTree(roots);
  return roots;
}

async function assertSiblingNameFree(parentId: string | null, name: string, excludeId?: string): Promise<void> {
  const rows = await db.select({ id: team.id }).from(team).where(and(
    parentId ? eq(team.parentId, parentId) : isNull(team.parentId),
    eq(team.name, name),
  ));
  if (rows.some((r) => r.id !== excludeId)) throw new DomainError("CONFLICT", "同级团队重名", null);
}

/** 子树 id 集合（含自身），用于防环与成员展开 */
async function subtreeIds(rootId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    with recursive t(id) as (
      select id from team where id = ${rootId}
      union all
      select c.id from team c join t on c.parent_id = t.id
    )
    select id from t
  `);
  return (rows as unknown as { id: string }[]).map((r) => r.id);
}

export async function createTeam(actor: Actor, input: { name: string; parentId?: string | null; sortOrder?: number }) {
  assertManage(actor);
  const name = input.name.trim();
  if (!name) throw new DomainError("VALIDATION", "团队名称不能为空", null);
  if (input.parentId) {
    const parent = (await db.select({ id: team.id }).from(team).where(eq(team.id, input.parentId)).limit(1))[0];
    if (!parent) throw new DomainError("VALIDATION", "父团队不存在", null);
  }
  await assertSiblingNameFree(input.parentId ?? null, name);
  const [row] = await db.insert(team).values({
    name, parentId: input.parentId ?? null, sortOrder: input.sortOrder ?? 0,
  }).returning();
  return row!;
}

export async function updateTeam(actor: Actor, id: string, patch: { name?: string; parentId?: string | null; sortOrder?: number }) {
  assertManage(actor);
  const existing = (await db.select().from(team).where(eq(team.id, id)).limit(1))[0];
  if (!existing) throw forbidden();
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!nextName) throw new DomainError("VALIDATION", "团队名称不能为空", null);
  const nextParent = patch.parentId !== undefined ? patch.parentId : existing.parentId;

  if (nextParent !== undefined && nextParent !== null) {
    if (nextParent === id) throw new DomainError("VALIDATION", "不能把团队挂到自己下面", null);
    const parent = (await db.select({ id: team.id }).from(team).where(eq(team.id, nextParent)).limit(1))[0];
    if (!parent) throw new DomainError("VALIDATION", "父团队不存在", null);
  }
  await assertSiblingNameFree(nextParent ?? null, nextName, id);

  if (nextParent !== existing.parentId) {
    // 防环：新父级不能位于本团队子树内；事务 + advisory 锁把树变更串行化（C-12）
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('feronavi:team-tree'))`);
      const ids = await subtreeIds(id);
      if (nextParent && ids.includes(nextParent)) {
        throw new DomainError("VALIDATION", "父级不能位于该团队的子树内（会成环）", null);
      }
      await tx.update(team).set({
        name: nextName,
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.parentId !== undefined ? { parentId: nextParent ?? null } : {}),
      }).where(eq(team.id, id));
    });
  } else {
    await db.update(team).set({
      name: nextName,
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    }).where(eq(team.id, id));
  }
  return (await db.select().from(team).where(eq(team.id, id)).limit(1))[0]!;
}

export async function deleteTeam(actor: Actor, id: string): Promise<void> {
  assertManage(actor);
  const existing = (await db.select({ id: team.id }).from(team).where(eq(team.id, id)).limit(1))[0];
  if (!existing) throw forbidden();
  const children = await db.select({ id: team.id }).from(team).where(eq(team.parentId, id));
  if (children.length > 0) throw new DomainError("CONFLICT", "该团队下仍有子团队，不能删除", { children: children.length });
  const members = await db.select({ id: roleAssignment.id }).from(roleAssignment)
    .where(and(eq(roleAssignment.scopeType, "TEAM"), eq(roleAssignment.scopeId, id)));
  if (members.length > 0) throw new DomainError("CONFLICT", "该团队仍有成员，不能删除（请先移除团队角色指派）", { members: members.length });
  await db.delete(team).where(eq(team.id, id));
}

export async function listTeamMembers(actor: Actor, id: string) {
  void actor;
  const existing = (await db.select({ id: team.id }).from(team).where(eq(team.id, id)).limit(1))[0];
  if (!existing) throw forbidden();
  const ids = await subtreeIds(id);
  const rows = await db.select({
    id: member.id, name: member.name, username: member.username,
    roleKey: role.key, roleName: role.name,
  }).from(roleAssignment)
    .innerJoin(member, eq(member.id, roleAssignment.memberId))
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(and(eq(roleAssignment.scopeType, "TEAM"), ids.length ? sql`${roleAssignment.scopeId} in ${sql.raw(`(${ids.map((x) => `'${x}'`).join(",")})`)}` : sql`false`));
  const byMember = new Map<string, { id: string; name: string; username: string; roles: string[] }>();
  for (const r of rows) {
    const cur = byMember.get(r.id) ?? { id: r.id, name: r.name, username: r.username, roles: [] };
    cur.roles.push(r.roleName);
    byMember.set(r.id, cur);
  }
  return { teamIds: ids, members: [...byMember.values()] };
}
