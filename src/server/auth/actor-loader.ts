/**
 * Actor 装载 —— 把「成员 + 角色指派」展开成一次请求的身份上下文
 *
 * UI 接收权限并集；授权判定使用每个角色自己的权限及其绑定范围。
 * 部门、团队闭包始终携带来源角色，禁止把不同授权的范围合并后回填。
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { member as memberT, memberPreference as memberPreferenceT, role as roleT, roleAssignment as raT, rolePermission as rpT } from "../../db/schema.ts";
import type { Actor, ScopeGrant, ScopeType } from "../permission/actor.ts";

export async function loadActor(memberId: string): Promise<Actor | null> {
  const rows = await db.select({
    id: memberT.id, username: memberT.username, name: memberT.name,
    status: memberT.status, locale: memberT.locale, timezone: memberT.timezone,
    isInitialAdmin: memberT.isInitialAdmin, anonymizedAt: memberT.anonymizedAt,
  }).from(memberT).where(eq(memberT.id, memberId)).limit(1);

  const m = rows[0];
  // 匿名化/禁用/锁定的成员一律不产生 Actor（等同未登录）
  if (!m || m.status !== "ACTIVE" || m.anonymizedAt) return null;

  /**
   * ⚠️ **locale 有两个存储**：`member.locale` 与 `member_preference.locale`（设置页写的是后者）。
   * 此前这里只读 `member.locale`，导致**用户在设置页切了语言、界面却永远不变**（实测：
   * `/me/preferences` 已是 en-US，而 `/auth/me` 仍报 zh-CN）。偏好优先，member 列作兜底。
   */
  const prefRow = (await db.select({ locale: memberPreferenceT.locale, theme: memberPreferenceT.theme })
    .from(memberPreferenceT).where(eq(memberPreferenceT.memberId, memberId)).limit(1))[0];
  if (prefRow?.locale) m.locale = prefRow.locale;

  // 该成员的全部角色指派
  const assignments = await db.select({
    roleKey: roleT.key, scopeType: raT.scopeType, scopeId: raT.scopeId,
  }).from(raT)
    .innerJoin(roleT, eq(roleT.id, raT.roleId))
    .where(eq(raT.memberId, memberId));

  const grants: ScopeGrant[] = assignments.map((a) => ({
    roleKey: a.roleKey,
    scopeType: a.scopeType as ScopeType,
    scopeId: a.scopeId,
  }));

  // 每个角色的权限集（scoped RBAC 的判定依据）+ UI 用的并集
  const rolePermissions = new Map<string, Set<string>>();
  if (grants.length > 0) {
    const roleRows = await db.select({ id: roleT.id, key: roleT.key }).from(roleT)
      .where(inArray(roleT.key, [...new Set(grants.map((g) => g.roleKey))]));
    if (roleRows.length > 0) {
      const perms = await db.select({ roleId: rpT.roleId, key: rpT.permissionKey }).from(rpT)
        .where(inArray(rpT.roleId, roleRows.map((r) => r.id)));
      for (const r of roleRows) rolePermissions.set(r.key, new Set());
      const keyById = new Map(roleRows.map((r) => [r.id, r.key]));
      for (const p of perms) {
        const key = keyById.get(p.roleId);
        if (!key) continue;
        rolePermissions.set(key, (rolePermissions.get(key) ?? new Set()).add(p.key));
      }
    }
  }
  const permissions = new Set<string>();
  for (const perms of rolePermissions.values()) for (const p of perms) permissions.add(p);

  /**
   * 部门范围（Round 75）：按角色把 DEPARTMENT 指派展开成 PROJECT 授权（仅该角色）。
   * 这是安全的，因为 can() 现在按「授权对应角色」判权限 —— 部门 ADMIN 不会把权限放大到 ORG 级角色。
   * 部门闭包 = 被指派部门 + 全部子部门；项目归属经 project.department_id 关联。
   */
  const deptAssignments = assignments.filter((a) => a.scopeType === "DEPARTMENT" && a.scopeId);
  if (deptAssignments.length > 0) {
    const deptProjects = await db.execute(sql`
      WITH RECURSIVE closure AS (
        SELECT ra.scope_id AS root_id, ra.scope_id AS dept_id, r.key AS role_key
        FROM role_assignment ra JOIN role r ON r.id = ra.role_id
        WHERE ra.member_id = ${memberId} AND ra.scope_type = 'DEPARTMENT' AND ra.scope_id IS NOT NULL
        UNION
        SELECT c.root_id, d.id, c.role_key
        FROM department d JOIN closure c ON d.parent_id = c.dept_id
        WHERE d.archived_at IS NULL
      )
      SELECT DISTINCT p.id::text AS id, c.role_key
      FROM project p JOIN closure c ON p.department_id = c.dept_id
      WHERE p.archived_at IS NULL
    `) as unknown as { id: string; role_key: string }[];
    const seen = new Set(grants.map((g) => `${g.roleKey}|${g.scopeType}|${g.scopeId ?? ""}`));
    for (const p of deptProjects) {
      const key = `${p.role_key}|PROJECT|${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      grants.push({ roleKey: p.role_key, scopeType: "PROJECT", scopeId: p.id, synthetic: true });
    }
  }

  if (assignments.some((a) => a.scopeType === "TEAM" && a.scopeId)) {
    const teams = await db.execute(sql`
      WITH RECURSIVE closure AS (
        SELECT ra.scope_id AS team_id, r.key AS role_key
        FROM role_assignment ra JOIN role r ON r.id = ra.role_id
        WHERE ra.member_id = ${memberId} AND ra.scope_type = 'TEAM' AND ra.scope_id IS NOT NULL
        UNION
        SELECT t.id, c.role_key FROM team t JOIN closure c ON t.parent_id = c.team_id
        WHERE t.archived_at IS NULL
      ) SELECT DISTINCT team_id::text AS id, role_key FROM closure
    `) as unknown as { id: string; role_key: string }[];
    const seen = new Set(grants.map((g) => `${g.roleKey}|${g.scopeType}|${g.scopeId ?? ""}`));
    for (const t of teams) {
      const key = `${t.role_key}|TEAM|${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      grants.push({ roleKey: t.role_key, scopeType: "TEAM", scopeId: t.id, synthetic: true });
    }
  }

  return {
    memberId: m.id,
    username: m.username,
    name: m.name,
    permissions,
    rolePermissions,
    grants,
    // 初始管理员和管理员直建账号首次登录改密；历史列名不代表管理员权限。
    mustChangePassword: m.isInitialAdmin,
    locale: m.locale,
    timezone: m.timezone,
    /** 主题同样"偏好优先"：设置页写的是 member_preference.theme，此前**从未被读取** ——
     *  症状与当年 locale 那次一模一样：切了浅色，界面永远不变。 */
    theme: prefRow?.theme ?? null,
  };
}

/**
 * 装载数据范围所需的辅助集合。
 * `memberTeamIds` 必须包含**全部子团队** —— 递归展开由这里一次查询完成（第 1.2 节）。
 */
/**
 * 热缓存（总纲 4.4：Valkey 可丢、回源 PG）：
 * 权限上下文每个请求都要查（成员/角色/项目成员/团队闭包多次往返），
 * 60s 热缓存 + 角色变更时清键。丢 = 鉴权回源变慢，不影响正确性。
 */
const PERM_CACHE_TTL = 60;

export async function loadPermissionContextCached(memberId: string): Promise<{
  memberProjectIds: ReadonlySet<string>; memberTeamIds: ReadonlySet<string>;
}> {
  try {
    const { getRedisClient } = await import("./cache.ts");
    const redis = getRedisClient();
    const key = `perm-ctx:${memberId}`;
    const hit = await redis.get(key);
    if (hit) {
      const parsed = JSON.parse(hit) as { p: string[]; t: string[] };
      return { memberProjectIds: new Set(parsed.p), memberTeamIds: new Set(parsed.t) };
    }
    const fresh = await loadPermissionContext(memberId);
    await redis.set(key, JSON.stringify({
      p: [...fresh.memberProjectIds], t: [...fresh.memberTeamIds],
    }), "EX", PERM_CACHE_TTL);
    return fresh;
  } catch {
    // ⚠️ Valkey 不可用 → 直接回源 PG，绝不报错（可丢语义）
    return loadPermissionContext(memberId);
  }
}

export async function loadPermissionContext(memberId: string): Promise<{
  memberProjectIds: ReadonlySet<string>;
  memberTeamIds: ReadonlySet<string>;
  memberId: string;
}> {
  // 加载显式项目成员关系，供成员范围与项目授权判断使用
  const memberProjectIds = new Set<string>(await loadMemberProjectIds(memberId));
  const memberTeamIds = new Set<string>(await loadTeamClosure(memberId));
  return { memberProjectIds, memberTeamIds, memberId };
}

/**
 * 「我参与的项目」—— PROJECT 档数据范围的**回落路径**（第 5.2 节）。
 *
 * 为什么必须有它：一个成员可能只被加进某项目的成员名单、而没有该项目的
 * role_assignment。若不看这张表，他就看不到自己参与的项目。
 */
async function loadMemberProjectIds(memberId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    select project_id::text as project_id from project_membership
    where member_id = ${memberId}
  `) as unknown as { project_id: string }[];
  return rows.map((r) => r.project_id);
}

/**
 * 团队闭包 = 我被指派到的团队 + 它们的**全部子团队**。
 *
 * 「团队(含子团队)」这个数据范围档就靠它实现（第 5.2 节）。
 * 成员与团队的关系不是独立的关系表 —— 它由 `role_assignment(scopeType='TEAM', scope_id=teamId)`
 * 表达（数据模型 1.5），所以这里从指派反查。
 *
 * 用**递归 CTE 一次查完**，不做 N 次往返（第 1.2 节要求）。
 * 防环由写入侧保证（C-12 同一事务内复查），这里加 `UNION`（不是 UNION ALL）做兜底，
 * 万一数据里真有环也不会无限递归。
 */
export async function loadTeamClosure(memberId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    WITH RECURSIVE seed AS (
      SELECT scope_id AS team_id
      FROM role_assignment
      WHERE member_id = ${memberId}
        AND scope_type = 'TEAM'
        AND scope_id IS NOT NULL
    ),
    closure AS (
      SELECT team_id FROM seed
      UNION
      SELECT t.id
      FROM team t
      JOIN closure c ON t.parent_id = c.team_id
      WHERE t.archived_at IS NULL
    )
    SELECT DISTINCT team_id::text AS team_id FROM closure
  `);
  return (rows as unknown as { team_id: string }[]).map((r) => r.team_id);
}
