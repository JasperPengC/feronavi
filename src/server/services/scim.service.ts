/**
 * SCIM 2.0（P1-3）
 *
 * 只支持企业最常用的 Users / Groups：
 *   - Users → member；DELETE/PATCH active=false = 禁用（不物理删，保留审计与历史）
 *   - Groups → team；成员通过 TEAM 范围的 MEMBER 角色指派表达
 *
 * 认证不走 Cookie，只认 `scim_token` 的 Bearer 哈希；明文只在创建时返回一次。
 * 过滤只支持 `userName eq "x"` / `displayName eq "x"`，不做完整 SCIM filter 解析。
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { revokeMemberCredentials } from "../auth/session.ts";
import { member, role, roleAssignment, scimToken, team } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { writeSecurityAudit } from "./audit.service.ts";

const DEFAULT_ROLE = "MEMBER";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function assertAdmin(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

function nowIso() { return new Date().toISOString(); }

/* ── 令牌管理 ─────────────────────────────────────────── */
export async function listTokens(actor: Actor) {
  assertAdmin(actor);
  const rows = await db.select({
    id: scimToken.id, name: scimToken.name, tokenPrefix: scimToken.tokenPrefix,
    createdBy: scimToken.createdBy, lastUsedAt: scimToken.lastUsedAt,
    revokedAt: scimToken.revokedAt, createdAt: scimToken.createdAt,
  }).from(scimToken).orderBy(asc(scimToken.createdAt));
  return rows;
}

export async function createToken(actor: Actor, name: string) {
  assertAdmin(actor);
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  const [row] = await db.insert(scimToken).values({
    name: name.trim() || "SCIM", tokenHash: hash(token), tokenPrefix: `scim_${token.slice(5, 11)}…`, createdBy: actor.memberId,
  }).returning({ id: scimToken.id, name: scimToken.name, tokenPrefix: scimToken.tokenPrefix, createdAt: scimToken.createdAt });
  await writeSecurityAudit({ actorId: actor.memberId, actorSnapshot: actor.username, action: "scim.token_created", targetType: "SCIM_TOKEN", targetId: row!.id });
  return { ...row!, token };
}

export async function revokeToken(actor: Actor, id: string) {
  assertAdmin(actor);
  const [row] = await db.update(scimToken).set({ revokedAt: new Date() }).where(eq(scimToken.id, id)).returning({ id: scimToken.id });
  if (!row) throw new DomainError("NOT_FOUND", "令牌不存在", null);
  await writeSecurityAudit({ actorId: actor.memberId, actorSnapshot: actor.username, action: "scim.token_revoked", targetType: "SCIM_TOKEN", targetId: id });
  return { ok: true };
}

/** Bearer 校验；返回 token 行，路由据此写 lastUsed */
export async function authenticate(raw: string | undefined) {
  if (!raw || !raw.startsWith("Bearer ")) throw new DomainError("FORBIDDEN", "缺少 SCIM Bearer Token", null);
  const token = raw.slice(7).trim();
  if (!token.startsWith("scim_")) throw new DomainError("FORBIDDEN", "SCIM Token 格式不正确", null);
  const row = (await db.select().from(scimToken).where(and(eq(scimToken.tokenHash, hash(token)), isNull(scimToken.revokedAt))).limit(1))[0];
  if (!row) throw new DomainError("FORBIDDEN", "SCIM Token 无效或已撤销", null);
  await db.update(scimToken).set({ lastUsedAt: new Date() }).where(eq(scimToken.id, row.id));
  return row;
}

/* ── 序列化 ───────────────────────────────────────────── */
function scimUser(m: typeof member.$inferSelect) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: m.id,
    userName: m.username,
    name: { formatted: m.name },
    displayName: m.name,
    emails: m.email ? [{ value: m.email, primary: true }] : [],
    active: m.status === "ACTIVE",
    meta: { resourceType: "User", created: m.createdAt.toISOString(), lastModified: m.updatedAt.toISOString() },
  };
}
function scimError(status: number, detail: string, scimType?: string) {
  return { status, detail, scimType };
}

/* ── Users ───────────────────────────────────────────── */
function parseEqFilter(filter: string | undefined, attr: string): string | null {
  if (!filter) return null;
  const m = new RegExp(`^\\s*${attr}\\s+eq\\s+"((?:[^"\\\\]|\\\\.)*)"\\s*$`, "i").exec(filter);
  return m ? m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}

export async function listUsers(q: { filter?: string; startIndex?: number; count?: number }) {
  const username = parseEqFilter(q.filter, "userName");
  const rows = await db.select().from(member)
    .where(username ? eq(member.username, username) : isNull(member.anonymizedAt))
    .orderBy(asc(member.createdAt)).limit(500);
  const start = Math.max(1, q.startIndex ?? 1);
  const count = Math.min(200, Math.max(1, q.count ?? 50));
  const page = rows.slice(start - 1, start - 1 + count);
  return { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: rows.length, startIndex: start, itemsPerPage: page.length, Resources: page.map(scimUser) };
}

export async function getUser(id: string) {
  const m = (await db.select().from(member).where(eq(member.id, id)).limit(1))[0];
  if (!m) throw new DomainError("NOT_FOUND", "User not found", null);
  return scimUser(m);
}

export async function createUser(body: Record<string, unknown>) {
  const userName = String(body.userName ?? "").trim().toLowerCase();
  const emails = Array.isArray(body.emails) ? body.emails as { value?: string }[] : [];
  const email = (emails[0]?.value ?? "").toLowerCase() || null;
  const nameObj = (body.name ?? {}) as { formatted?: string; givenName?: string; familyName?: string };
  const name = String(body.displayName ?? nameObj.formatted ?? userName);
  if (!userName) throw new DomainError("VALIDATION", "userName is required", null);
  const dup = (await db.select({ id: member.id }).from(member).where(eq(member.username, userName)).limit(1))[0];
  if (dup) throw new DomainError("CONFLICT", "userName already exists", null);
  if (email) {
    const dupMail = (await db.select({ id: member.id }).from(member).where(eq(member.email, email)).limit(1))[0];
    if (dupMail) throw new DomainError("CONFLICT", "email already exists", null);
  }
  const [m] = await db.insert(member).values({
    username: userName, email, name: name.slice(0, 120), status: body.active === false ? "DISABLED" : "ACTIVE",
    passwordHash: "!scim",
  }).returning();
  await assignMemberRole(m!.id);
  await writeSecurityAudit({ actorId: null, actorSnapshot: "SCIM", action: "scim.user_created", targetType: "MEMBER", targetId: m!.id });
  return scimUser(m!);
}

export async function patchUser(id: string, operations: { op?: string; path?: string; value?: unknown }[]) {
  const m = (await db.select().from(member).where(eq(member.id, id)).limit(1))[0];
  if (!m) throw new DomainError("NOT_FOUND", "User not found", null);
  const patch: Partial<typeof member.$inferInsert> = {};
  let disable = false;
  for (const op of operations ?? []) {
    const path = (op.path ?? "").toLowerCase();
    if (path === "active") { if (op.value === false) patch.status = "DISABLED"; if (op.value === true) patch.status = "ACTIVE"; disable = op.value === false; }
    else if (path === "username") { const v = String(op.value ?? "").trim().toLowerCase(); if (v) patch.username = v; }
    else if (path === "displayname") { const v = String(op.value ?? "").trim(); if (v) patch.name = v.slice(0, 120); }
    else if (path === "name" && op.value && typeof op.value === "object") {
      const v = op.value as { formatted?: string }; if (v.formatted) patch.name = String(v.formatted).slice(0, 120);
    } else if (path === "emails" && Array.isArray(op.value)) {
      const email = String((op.value[0] as { value?: string })?.value ?? "").toLowerCase();
      if (email) patch.email = email;
    } else if (!path && op.value && typeof op.value === "object") {
      const v = op.value as Record<string, unknown>;
      if (typeof v.active === "boolean") { patch.status = v.active ? "ACTIVE" : "DISABLED"; disable = !v.active; }
      if (v.displayName) patch.name = String(v.displayName).slice(0, 120);
    }
  }
  if (patch.username || patch.email) {
    if (patch.username) {
      const dup = (await db.select({ id: member.id }).from(member).where(eq(member.username, patch.username)).limit(1))[0];
      if (dup && dup.id !== id) throw new DomainError("CONFLICT", "userName already exists", null);
    }
    if (patch.email) {
      const dup = (await db.select({ id: member.id }).from(member).where(eq(member.email, patch.email)).limit(1))[0];
      if (dup && dup.id !== id) throw new DomainError("CONFLICT", "email already exists", null);
    }
  }
  if (Object.keys(patch).length === 0) return scimUser(m);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(member).set({ ...patch, updatedAt: new Date() }).where(eq(member.id, id)).returning();
    if (patch.status === "DISABLED") await revokeMemberCredentials(id);
    return row;
  });
  await writeSecurityAudit({ actorId: null, actorSnapshot: "SCIM", action: disable ? "scim.user_disabled" : "scim.user_updated", targetType: "MEMBER", targetId: id });
  return scimUser(updated!);
}

export async function deleteUser(id: string) {
  await db.transaction(async (tx) => {
    const [m] = await tx.update(member).set({ status: "DISABLED", updatedAt: new Date() }).where(eq(member.id, id)).returning({ id: member.id });
    if (!m) throw new DomainError("NOT_FOUND", "User not found", null);
    await revokeMemberCredentials(id);
  });
  await writeSecurityAudit({ actorId: null, actorSnapshot: "SCIM", action: "scim.user_disabled", targetType: "MEMBER", targetId: id });
  return { ok: true };
}

async function roleIdByKey(key: string): Promise<string> {
  const r = (await db.select({ id: role.id }).from(role).where(eq(role.key, key)).limit(1))[0];
  if (!r) throw new DomainError("VALIDATION", `角色 ${key} 不存在`, null);
  return r.id;
}
async function assignMemberRole(memberId: string) {
  const rid = await roleIdByKey(DEFAULT_ROLE);
  await db.insert(roleAssignment).values({ memberId, roleId: rid, scopeType: "ORG", scopeId: null }).onConflictDoNothing();
}

/* ── Groups（team）────────────────────────────────────── */
async function groupMembers(teamId: string) {
  return db.select({ id: member.id, name: member.name, username: member.username })
    .from(roleAssignment).innerJoin(member, eq(member.id, roleAssignment.memberId))
    .where(and(eq(roleAssignment.scopeType, "TEAM"), eq(roleAssignment.scopeId, teamId)));
}
async function scimGroup(t: typeof team.$inferSelect) {
  const ms = await groupMembers(t.id);
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], id: t.id, displayName: t.name,
    members: ms.map((m) => ({ value: m.id, display: m.name, $ref: `/scim/v2/Users/${m.id}` })),
    meta: { resourceType: "Group", created: nowIso(), lastModified: nowIso() },
  };
}

export async function listGroups(q: { filter?: string; startIndex?: number; count?: number }) {
  const name = parseEqFilter(q.filter, "displayName");
  const rows = await db.select().from(team).where(name ? eq(team.name, name) : isNull(team.archivedAt)).orderBy(asc(team.name)).limit(500);
  const start = Math.max(1, q.startIndex ?? 1);
  const count = Math.min(200, Math.max(1, q.count ?? 50));
  const page = rows.slice(start - 1, start - 1 + count);
  const groups = await Promise.all(page.map(scimGroup));
  return { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: rows.length, startIndex: start, itemsPerPage: groups.length, Resources: groups };
}
export async function getGroup(id: string) {
  const t = (await db.select().from(team).where(eq(team.id, id)).limit(1))[0];
  if (!t) throw new DomainError("NOT_FOUND", "Group not found", null);
  return scimGroup(t);
}
export async function createGroup(body: Record<string, unknown>) {
  const name = String(body.displayName ?? "").trim();
  if (!name) throw new DomainError("VALIDATION", "displayName is required", null);
  const dup = (await db.select({ id: team.id }).from(team).where(and(isNull(team.parentId), eq(team.name, name))).limit(1))[0];
  if (dup) throw new DomainError("CONFLICT", "displayName already exists", null);
  const [t] = await db.insert(team).values({ name }).returning();
  await replaceGroupMembers(t!.id, Array.isArray(body.members) ? body.members as { value?: string }[] : []);
  await writeSecurityAudit({ actorId: null, actorSnapshot: "SCIM", action: "scim.group_created", targetType: "TEAM", targetId: t!.id });
  return scimGroup(t!);
}
export async function patchGroup(id: string, operations: { op?: string; path?: string; value?: unknown }[]) {
  const t = (await db.select().from(team).where(eq(team.id, id)).limit(1))[0];
  if (!t) throw new DomainError("NOT_FOUND", "Group not found", null);
  for (const op of operations ?? []) {
    if ((op.path ?? "").toLowerCase() === "displayname") {
      const v = String(op.value ?? "").trim();
      if (v) await db.update(team).set({ name: v }).where(eq(team.id, id));
    }
    if ((op.path ?? "").toLowerCase() === "members") {
      const val = op.value;
      if (op.op?.toLowerCase() === "replace" && Array.isArray(val)) await replaceGroupMembers(id, val as { value?: string }[]);
      if (op.op?.toLowerCase() === "add" && val) await addGroupMembers(id, [val as { value?: string }]);
      if (op.op?.toLowerCase() === "remove") {
        const valObj = val as { value?: string } | undefined;
        if (valObj?.value) await db.delete(roleAssignment).where(and(eq(roleAssignment.scopeType, "TEAM"), eq(roleAssignment.scopeId, id), eq(roleAssignment.memberId, valObj.value)));
      }
    }
  }
  await writeSecurityAudit({ actorId: null, actorSnapshot: "SCIM", action: "scim.group_updated", targetType: "TEAM", targetId: id });
  return getGroup(id);
}
export async function deleteGroup(id: string) {
  const children = await db.select({ id: team.id }).from(team).where(eq(team.parentId, id));
  if (children.length > 0) throw new DomainError("CONFLICT", "Group has children", null);
  await db.delete(roleAssignment).where(and(eq(roleAssignment.scopeType, "TEAM"), eq(roleAssignment.scopeId, id)));
  const [t] = await db.delete(team).where(eq(team.id, id)).returning({ id: team.id });
  if (!t) throw new DomainError("NOT_FOUND", "Group not found", null);
  await writeSecurityAudit({ actorId: null, actorSnapshot: "SCIM", action: "scim.group_deleted", targetType: "TEAM", targetId: id });
  return { ok: true };
}
async function replaceGroupMembers(groupId: string, members: { value?: string }[]) {
  await db.delete(roleAssignment).where(and(eq(roleAssignment.scopeType, "TEAM"), eq(roleAssignment.scopeId, groupId)));
  await addGroupMembers(groupId, members);
}
async function addGroupMembers(groupId: string, members: { value?: string }[]) {
  const ids = members.map((m) => m.value).filter((x): x is string => !!x);
  if (ids.length === 0) return;
  const rid = await roleIdByKey(DEFAULT_ROLE);
  const existing = await db.select({ id: member.id }).from(member).where(inArray(member.id, ids));
  if (existing.length !== ids.length) throw new DomainError("VALIDATION", "members 包含不存在的用户", null);
  for (const memberId of ids) {
    await db.insert(roleAssignment).values({ memberId, roleId: rid, scopeType: "TEAM", scopeId: groupId }).onConflictDoNothing();
  }
}

export { scimError };
