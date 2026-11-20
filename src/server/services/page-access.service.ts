/** Wiki 与事件投递共享的只读页面 ACL 判定。 */
import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { page, pagePermission, role } from "../../db/schema.ts";
import type { Actor } from "../permission/actor.ts";

/** 我作为 ACL 主体的身份：本人 + 持有的角色 id + 被指派的团队 id */
export async function aclPrincipals(actor: Actor): Promise<{ roleIds: string[]; teamIds: string[] }> {
  const roleKeys = [...new Set(actor.grants.map((g) => g.roleKey).filter(Boolean))];
  const roleIds = roleKeys.length
    ? (await db.select({ id: role.id }).from(role).where(inArray(role.key, roleKeys))).map((r) => r.id)
    : [];
  const teamIds = [...new Set(actor.grants.filter((g) => g.scopeType === "TEAM" && g.scopeId).map((g) => g.scopeId!))];
  return { roleIds, teamIds };
}

/**
 * **可见性条件（唯一实现）**：读路径一律 `and(项目范围, visiblePageCondition(...))`。
 * 注意 `visibility='PROJECT'` 的页面在项目数据范围内即可见；RESTRICTED 才查 ACL。
 */
export async function visiblePageCondition(actor: Actor, opts: { forWrite?: boolean } = {}): Promise<SQL> {
  const { roleIds, teamIds } = await aclPrincipals(actor);
  const principals = [
    and(eq(pagePermission.principalType, "MEMBER"), eq(pagePermission.principalId, actor.memberId)),
    roleIds.length ? and(eq(pagePermission.principalType, "ROLE"), inArray(pagePermission.principalId, roleIds)) : undefined,
    teamIds.length ? and(eq(pagePermission.principalType, "TEAM"), inArray(pagePermission.principalId, teamIds)) : undefined,
  ].filter(Boolean);
  const grant = exists(
    db.select({ x: sql`1` }).from(pagePermission).where(and(
      eq(pagePermission.pageId, page.id),
      opts.forWrite ? eq(pagePermission.canWrite, true) : eq(pagePermission.canRead, true),
      principals.length ? or(...principals) : sql`false`,
    )),
  );
  return or(eq(page.visibility, "PROJECT"), grant)!;
}

/** 该页是否给了我可读/可写的资源级授权（MEMBER 本人 / 我持有的 ROLE / 我被指派的 TEAM） */
export async function hasAcl(actor: Actor, pageId: string, kind: "read" | "write"): Promise<boolean> {
  const { roleIds, teamIds } = await aclPrincipals(actor);
  const principals = [
    and(eq(pagePermission.principalType, "MEMBER"), eq(pagePermission.principalId, actor.memberId)),
    roleIds.length ? and(eq(pagePermission.principalType, "ROLE"), inArray(pagePermission.principalId, roleIds)) : undefined,
    teamIds.length ? and(eq(pagePermission.principalType, "TEAM"), inArray(pagePermission.principalId, teamIds)) : undefined,
  ].filter(Boolean);
  if (!principals.length) return false;
  const hit = await db.select({ x: sql`1` }).from(pagePermission).where(and(
    eq(pagePermission.pageId, pageId),
    kind === "write" ? eq(pagePermission.canWrite, true) : eq(pagePermission.canRead, true),
    or(...principals),
  )).limit(1);
  return !!hit[0];
}
