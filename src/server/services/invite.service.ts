/**
 * 成员邀请（REST 第 3 节 / 总纲 5.11：管理员邀请制，邀请链接 7 天、单次使用）
 *
 * 纪律：
 *   1 **只存令牌哈希**（SHA-256），明文只在创建响应里出现一次，绝不写日志/审计详情；
 *   2 接受邀请是**公开端点**（未登录可用），但必须校验：未过期、未使用、用户名/邮箱未被占用；
 *   3 密码用 Argon2id 慢哈希（与登录同一套强度校验）；
 *   4 默认授予 MEMBER / ORG 角色；项目级角色留待管理员在角色页另行指派（v1 边界，如实登记）。
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, inTransaction } from "../../db/index.ts";
import { department, invite, member, position, role, roleAssignment, rolePermission } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { createMemberSchema, type CreateMemberInput } from "../../shared/schemas/member.ts";
import { hashPassword, validatePasswordStrength } from "../auth/password.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { writeSecurityAudit } from "./audit.service.ts";
import { enqueue } from "./job.service.ts";
import { loadMailConfig, templates } from "./mail.service.ts";

const INVITE_TTL_MS = 7 * 86_400_000;
const usernameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "用户名必须小写字母/数字开头，3–32 位，可含 . _ -");
const emailSchema = z.string().email().max(200);

function assertInvite(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "member:invite", { projectId: null, teamId: null }, ctx)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createInvite(actor: Actor, input: { email: string; origin?: string; projectId?: string | null; projectRoleIds?: string[] }) {
  assertInvite(actor);
  const parsed = emailSchema.safeParse(input.email.trim().toLowerCase());
  if (!parsed.success) throw new DomainError("VALIDATION", "邮箱格式不合法", parsed.error.issues);
  const email = parsed.data;
  const existing = (await db.select({ id: member.id }).from(member).where(eq(member.email, email)).limit(1))[0];
  if (existing) throw new DomainError("CONFLICT", "该邮箱已是组织成员", null);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  // 可选项目绑定：邀请只由有 member:invite 的管理员创建，项目角色在**接受时**套用
  let projectId: string | null = null;
  const roleIds = [...new Set(input.projectRoleIds ?? [])];
  if (input.projectId) {
    const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
    if (!can(actor, "project:manage_member", { projectId: input.projectId, teamId: null }, ctx)) {
      throw new DomainError("FORBIDDEN", "带项目角色的邀请需要 project:manage_member", null);
    }
    const visible = await (await import("../repos/project.repo.ts")).isVisibleTo(
      actor.memberId, input.projectId, actor.grants.some((g) => g.scopeType === "ORG"));
    if (!visible) throw new DomainError("VALIDATION", "项目不存在或不可见", null);
    projectId = input.projectId;
  }
  if (roleIds.length > 0) {
    const found = await db.select({ id: role.id }).from(role).where(inArray(role.id, roleIds));
    if (found.length !== roleIds.length) throw new DomainError("VALIDATION", "项目角色不存在", null);
  }
  const [row] = await db.insert(invite).values({
    email, tokenHash: hashToken(token), expiresAt, invitedByMemberId: actor.memberId,
    projectId, projectRoleIds: roleIds as unknown as object[],
  }).returning();
  await writeSecurityAudit({
    actorId: actor.memberId, action: "member.invited", targetType: "INVITE", targetId: row!.id,
  });
  // 配了 SMTP 就把邀请邮件放进任务队列（失败可重试）；没配则让界面提示复制链接
  let emailQueued = false;
  try {
    if (await loadMailConfig()) {
      const origin = (input.origin ?? "").replace(/\/$/, "");
      const inviteUrl = `${origin}/invite/${token}`;
      await enqueue({
        kind: "email.send",
        payload: {
          to: email,
          subject: "Feronavi 成员邀请",
          text: templates.invite(inviteUrl),
        },
        dedupeKey: `invite-email:${row!.id}`,
      });
      emailQueued = true;
    }
  } catch { /* 邮件入队失败不影响邀请本身（界面仍可复制链接） */ }
  return { id: row!.id, email, expiresAt, token, inviteUrl: `/invite/${token}`, emailQueued };
}

export async function listInvites(actor: Actor) {
  assertInvite(actor);
  const rows = await db.select().from(invite);
  const now = Date.now();
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id, email: r.email, expiresAt: r.expiresAt, usedAt: r.usedAt, createdAt: r.createdAt,
      status: r.usedAt ? "USED" : r.expiresAt.getTime() <= now ? "EXPIRED" : "PENDING",
    }));
}

export async function revokeInvite(actor: Actor, id: string): Promise<void> {
  assertInvite(actor);
  const row = (await db.select().from(invite).where(eq(invite.id, id)).limit(1))[0];
  if (!row) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  if (row.usedAt) throw new DomainError("CONFLICT", "邀请已被使用，无法撤销", null);
  await db.delete(invite).where(eq(invite.id, id));
  await writeSecurityAudit({
    actorId: actor.memberId, action: "member.invite_revoked", targetType: "INVITE", targetId: id,
  });
}

/** 公开：注册页校验令牌（**不泄露被邀请人邮箱**） */
export async function checkInvite(token: string): Promise<{ valid: boolean; expiresAt?: string; email?: string }> {
  const row = (await db.select().from(invite).where(eq(invite.tokenHash, hashToken(token))).limit(1))[0];
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return { valid: false };
  return { valid: true, expiresAt: row.expiresAt.toISOString() };
}

/** 公开：接受邀请（设置用户名/姓名/密码后成为 ACTIVE 成员，单次有效） */
export async function acceptInvite(token: string, input: { username: string; name: string; password: string }) {
  const username = input.username.trim().toLowerCase();
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) throw new DomainError("VALIDATION", "用户名不合法", parsed.error.issues);
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) throw new DomainError("VALIDATION", strength.reason, null);
  const { created, row } = await db.transaction(async (tx) => {
    // 先锁邀请再读取状态与创建账号；同一邀请的并发接受只能有一个胜者。
    const row = (await tx.select().from(invite).where(eq(invite.tokenHash, hashToken(token))).for("update").limit(1))[0];
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new DomainError("VALIDATION", "邀请链接无效或已过期", null);
    }
    const duplicate = (await tx.select({ id: member.id }).from(member).where(eq(member.username, username)).limit(1))[0];
    if (duplicate) throw new DomainError("CONFLICT", "用户名已被占用", null);
    const emailTaken = (await tx.select({ id: member.id }).from(member).where(eq(member.email, row.email)).limit(1))[0];
    if (emailTaken) throw new DomainError("CONFLICT", "该邮箱已是组织成员", null);
    const passwordHash = await hashPassword(input.password);
    const memberRole = (await tx.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER")).limit(1))[0];
    if (!memberRole) throw new DomainError("INTERNAL", "缺少内置 MEMBER 角色（初始化异常）", null);
    const [m] = await tx.insert(member).values({
      username, email: row.email, name: input.name.trim() || username, status: "ACTIVE",
      timezone: "Asia/Shanghai", passwordHash,
    }).returning({ id: member.id, username: member.username, name: member.name });
    await tx.insert(roleAssignment).values({ memberId: m!.id, roleId: memberRole.id, scopeType: "ORG", scopeId: null });
    const consumed = await tx.update(invite).set({ usedAt: new Date() })
      .where(and(eq(invite.id, row.id), isNull(invite.usedAt))).returning({ id: invite.id });
    if (consumed.length === 0) throw new DomainError("CONFLICT", "邀请已被使用", null);
    return { created: m!, row };
  });
  // 项目角色/成员（事务外调用；失败不回滚注册 —— 邀请本身已完成，管理员可再指派）
  const projectId = row.projectId;
  const roleIds = Array.isArray(row.projectRoleIds) ? (row.projectRoleIds as string[]) : [];
  if (projectId && roleIds.length > 0) {
    try {
      const { applyInviteProjectMembership } = await import("./project-member.service.ts");
      await applyInviteProjectMembership(created.id, projectId, roleIds);
    } catch { /* 项目可能已被删除/角色被删：不阻断注册 */ }
  }
  await writeSecurityAudit({
    actorId: created.id, action: "member.joined", targetType: "MEMBER", targetId: created.id,
  });
  return { id: created.id, username: created.username, name: created.name };
}

/** 成员详情（GET /members/:id；已登录可读，仅非敏感字段） */
export async function getMemberDetail(id: string) {
  const row = (await db.select({
    m: member, departmentName: department.name, positionName: position.name,
  }).from(member)
    .leftJoin(department, eq(department.id, member.departmentId))
    .leftJoin(position, eq(position.id, member.positionId))
    .where(eq(member.id, id)).limit(1))[0];
  if (!row) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const m = row.m;
  return {
    id: m.id, username: m.username, name: m.name, email: m.email, status: m.status,
    timezone: m.timezone, locale: m.locale, lastLoginAt: m.lastLoginAt, createdAt: m.createdAt,
    anonymizedAt: m.anonymizedAt,
    departmentId: m.departmentId, departmentName: row.departmentName,
    positionId: m.positionId, positionName: row.positionName,
  };
}

/**
 * 成员权限集（GET /members/:id/permissions）：本人或 member:manage。
 * 展开 = 角色指派（含作用域）+ 角色关联的权限 key 并集；**数据范围原样返回**，由前端/调用方判断。
 */
export async function memberPermissions(actor: Actor, id: string) {
  const isSelf = actor.memberId === id;
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!isSelf && !can(actor, "member:manage", { projectId: null, teamId: null }, ctx)) {
    throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  }
  const target = (await db.select({ id: member.id, username: member.username, name: member.name })
    .from(member).where(eq(member.id, id)).limit(1))[0];
  if (!target) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
  const assignments = await db.select({
    id: roleAssignment.id, scopeType: roleAssignment.scopeType, scopeId: roleAssignment.scopeId,
    roleId: role.id, roleKey: role.key, roleName: role.name,
  }).from(roleAssignment).innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(eq(roleAssignment.memberId, id));
  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  const perms = roleIds.length
    ? await db.select({ key: rolePermission.permissionKey }).from(rolePermission)
      .where(inArray(rolePermission.roleId, roleIds))
    : [];
  return {
    member: target,
    assignments: assignments.map((a) => ({
      id: a.id, scopeType: a.scopeType, scopeId: a.scopeId,
      role: { id: a.roleId, key: a.roleKey, name: a.roleName },
    })),
    permissions: [...new Set(perms.map((p) => p.key))].sort(),
  };
}

/** 管理员直接创建成员（POST /members；与邀请并存：邀请走邮箱，直建用于无 SMTP 场景） */
export async function createMember(actor: Actor, input: CreateMemberInput) {
  assertInvite(actor);
  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "成员信息不合法", parsed.error.issues);
  const { username, email, name, password } = parsed.data;
  const strength = validatePasswordStrength(password);
  if (!strength.ok) throw new DomainError("VALIDATION", strength.reason, null);
  const dup = (await db.select({ id: member.id }).from(member)
    .where(eq(member.username, username)).limit(1))[0];
  if (dup) throw new DomainError("CONFLICT", "用户名已被占用", null);
  const emailDup = (await db.select({ id: member.id }).from(member)
    .where(eq(member.email, email)).limit(1))[0];
  if (emailDup) throw new DomainError("CONFLICT", "该邮箱已是组织成员", null);
  const memberRole = (await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER")).limit(1))[0];
  if (!memberRole) throw new DomainError("INTERNAL", "缺少内置 MEMBER 角色（初始化异常）", null);
  const passwordHash = await hashPassword(password);
  try {
    return await inTransaction(async () => {
      const [m] = await db.insert(member).values({
        username, email, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash,
        // 历史字段名；只用于首次登录改密，不授予管理员权限。
        isInitialAdmin: true,
      }).returning({ id: member.id, username: member.username });
      await db.insert(roleAssignment).values({ memberId: m!.id, roleId: memberRole.id, scopeType: "ORG", scopeId: null });
      await writeSecurityAudit({ actorId: actor.memberId, action: "member.created", targetType: "MEMBER", targetId: m!.id });
      return m!;
    });
  } catch (error) {
    // 并发创建可能在预检查之后冲突；Drizzle 会将 PG 错误包装为 cause。
    let cause = error as { code?: string; constraint_name?: string; cause?: unknown } | undefined;
    while (cause) {
      if (cause.code === "23505" && ["member_username_key", "member_email_key"].includes(cause.constraint_name ?? "")) {
        throw new DomainError("CONFLICT", cause.constraint_name === "member_username_key" ? "用户名已被占用" : "该邮箱已是组织成员", null);
      }
      cause = cause.cause as typeof cause;
    }
    throw error;
  }
}
