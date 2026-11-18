/**
 * 成员生命周期 —— 邀请接受 / 禁用 / 删除匿名化
 *
 * **禁用 ≠ 删除**（C-26，第 5.11 节）：
 *   - 禁用只置 `status='DISABLED'`，**保留内容归属与审计关联**，不改写任何内容
 *   - 删除是**匿名化**：逐列改写为下表规定的值，**不做物理删除、不做外键级联删**
 *
 * 为什么匿名化而不是物理删：管理员的审计与活动记录要保留（合规要求），
 * 但个人身份信息必须去除（PIPL）。物理删会让审计断链，也会让内容变成孤儿。
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { department, member, position, role, roleAssignment, workItem } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { ANONYMIZED_PASSWORD_SENTINEL } from "../auth/password.ts";
import { revokeMemberCredentials } from "../auth/session.ts";

/** 匿名化后的固定展示名（数据模型 1.3 的两列表） */
const ANONYMIZED_NAME = "已注销成员";

/**
 * 匿名化一个成员（C-26 逐列语义）。
 *
 * ⚠️ 四条硬规则：
 *   1 `username` 用 `deleted-<id 前 8 位>`；冲突则退化为**完整 32 位 uuid**，再冲突追加 `-2`/`-3`
 *   2 **必须在单事务内完成**，失败整体回滚，**不得留下半匿名状态**
 *   3 对**已是 ANONYMIZED** 的成员再删要返回 `CONFLICT`（不是静默成功）
 *   4 `password_hash` 写**不可登录的哨兵值**（不是合法 Argon2id 串）
 */
export async function anonymizeMember(memberId: string): Promise<{ username: string }> {
  return db.transaction(async (tx) => {
    // 事务内先锁行，避免两人同时匿名化同一成员
    const rows = await tx
      .select({ id: member.id, status: member.status, anonymizedAt: member.anonymizedAt })
      .from(member)
      .where(eq(member.id, memberId))
      .for("update")
      .limit(1);

    const m = rows[0];
    if (!m) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    // 规则 3：已是匿名化 → CONFLICT（不静默成功，也不重复匿名化）
    if (m.anonymizedAt || m.status === "ANONYMIZED") {
      throw new DomainError("CONFLICT", "该成员已是注销状态", null);
    }

    const username = await allocateAnonymizedUsername(tx, memberId);
    await tx.update(member).set({
      username,
      email: null,                                             // 个人身份信息去除
      name: ANONYMIZED_NAME,
      passwordHash: ANONYMIZED_PASSWORD_SENTINEL,              // 不可登录
      status: "ANONYMIZED",
      anonymizedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(member.id, memberId));

    await revokeMemberCredentials(memberId);

    // 角色指派随之清理（否则匿名化账号仍持有权限）
    await tx.delete(roleAssignment).where(eq(roleAssignment.memberId, memberId));

    // ⚠️ 刻意不做的事：不删内容、不改内容归属、不删审计与活动记录
    return { username };
  });
}

/**
 * 分配匿名化用户名（C-26 规则 1）。
 * `deleted-` 前缀已由 username 正则保留，排除「被他人抢注」这一类冲突。
 */
async function allocateAnonymizedUsername(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  memberId: string,
): Promise<string> {
  const short = memberId.replace(/-/g, "").slice(0, 8);
  const candidates = [`deleted-${short}`, `deleted-${memberId.replace(/-/g, "")}`];
  for (let n = 2; n <= 5; n++) candidates.push(`deleted-${memberId.replace(/-/g, "")}-${n}`);

  for (const c of candidates) {
    const taken = await tx.select({ id: member.id }).from(member).where(eq(member.username, c)).limit(1);
    if (taken.length === 0) return c;
  }
  // 极端情况：连 5 次追加都冲突（几乎不可能），用时间戳兜底而不是抛错留半状态
  return `deleted-${memberId.replace(/-/g, "")}-${Date.now()}`;
}

/** 禁用：只改状态，**保留内容归属与审计关联** */
export async function disableMember(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx.update(member)
      .set({ status: "DISABLED", updatedAt: new Date() })
      .where(and(eq(member.id, memberId), isNull(member.anonymizedAt)))
      .returning({ id: member.id });
    if (res.length === 0) throw new DomainError("CONFLICT", "成员不存在或已注销", null);
    await revokeMemberCredentials(memberId);
  });
}

export async function enableMember(memberId: string): Promise<void> {
  const res = await db.update(member)
    .set({ status: "ACTIVE", updatedAt: new Date() })
    .where(and(eq(member.id, memberId), isNull(member.anonymizedAt)))
    .returning({ id: member.id });
  if (res.length === 0) throw new DomainError("CONFLICT", "成员不存在或已注销", null);
}

void sql;

/**
 * 成员列表（第 47 轮）—— 组织级成员 + **真实负荷**。
 *
 * 负荷口径：该成员被分配的**未删除工作项数**（`work_item.assignee_id` 聚合）。
 * ⚠️ **不画假刻度**：负荷就是计数，没有"容量上限"这种没定义的东西，
 *    所以返回的是**绝对数量**，由前端按最大值归一化展示，而不是编一个百分比。
 * 权限：任何已认证成员可读（成员目录属于组织级公开信息）；
 *    敏感字段（passwordHash 等）**一律不返回**。
 */
export async function listMembers(opts: { departmentId?: string } = {}) {
  // 部门筛选含子部门（组织架构语义）；部门表很小，一次取回在内存建闭包，避免递归 SQL 重复实现
  let deptIds: string[] | null = null;
  if (opts.departmentId) {
    const rows = await db.select({ id: department.id, parentId: department.parentId }).from(department);
    const children = new Map<string, string[]>();
    for (const d of rows) {
      if (d.parentId) children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
    }
    deptIds = [opts.departmentId];
    for (let i = 0; i < deptIds.length; i++) {
      for (const child of children.get(deptIds[i]!) ?? []) deptIds.push(child);
    }
  }
  const rows = await db.select({
    id: member.id, username: member.username, name: member.name,
    email: member.email, status: member.status, timezone: member.timezone,
    locale: member.locale, createdAt: member.createdAt,
    departmentId: member.departmentId, departmentName: department.name,
    positionId: member.positionId, positionName: position.name,
  }).from(member)
    .leftJoin(department, eq(department.id, member.departmentId))
    .leftJoin(position, eq(position.id, member.positionId))
    .where(and(isNull(member.anonymizedAt), deptIds ? inArray(member.departmentId, deptIds) : undefined))
    .orderBy(asc(member.name));

  const load = await db.select({
    memberId: workItem.assigneeId,
    n: sql<number>`count(*)::int`,
  }).from(workItem)
    .where(and(isNull(workItem.deletedAt), isNotNull(workItem.assigneeId)))
    .groupBy(workItem.assigneeId);

  const loadMap = new Map(load.map((r) => [String(r.memberId), Number(r.n)]));

  // 角色归属（按成员聚合角色名 + 作用域；供成员目录表格展示，避免前端 N+1）
  const ids = rows.map((m) => m.id);
  const roleRows = ids.length
    ? await db.select({
        memberId: roleAssignment.memberId, key: role.key, name: role.name, scopeType: roleAssignment.scopeType,
      }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId))
        .where(inArray(roleAssignment.memberId, ids))
    : [];
  const roleMap = new Map<string, { key: string; name: string; scopeType: string }[]>();
  for (const r of roleRows) {
    const list = roleMap.get(String(r.memberId)) ?? [];
    if (!list.some((x) => x.key === r.key && x.scopeType === r.scopeType)) list.push({ key: r.key, name: r.name, scopeType: r.scopeType });
    roleMap.set(String(r.memberId), list);
  }

  return {
    members: rows.map((m) => ({ ...m, load: loadMap.get(String(m.id)) ?? 0, roles: roleMap.get(String(m.id)) ?? [] })),
    metric: "负荷 = 该成员被分配的未删除工作项数",
    departmentId: opts.departmentId ?? null,
  };
}
