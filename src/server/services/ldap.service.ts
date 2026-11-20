/**
 * LDAP / AD 登录（P0-1）
 *
 * 只做三件事：用管理员配置的服务账号 bind → 按过滤器搜索唯一用户 → 用用户 DN 再 bind。
 * 密码只在内存与 LDAP bind 中使用，不写日志/审计/数据库。
 * 配置中出现的 LDAP URL 由管理员填写，属于可信出站目标；仍限制协议为 ldap/ldaps。
 */
import { Client } from "ldapts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { idpConfig, member, role, roleAssignment } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { decryptSecret } from "./crypto.service.ts";
import { writeSecurityAudit } from "./audit.service.ts";
import { clearLoginFailures, consumeLoginAttempt, isLockedOut, recordLoginFailure } from "../auth/login-guard.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

interface LdapRuntimeConfig {
  url: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
  usernameAttribute: string;
  emailAttribute: string;
  nameAttribute: string;
  startTls: boolean;
  tlsRejectUnauthorized: boolean;
  timeoutMs: number;
  defaultRoleKey: string;
}

type IdpRow = typeof idpConfig.$inferSelect;

function rawConfig(row: IdpRow): Record<string, unknown> {
  return (row.config ?? {}) as Record<string, unknown>;
}
function s(v: unknown, fallback = ""): string { return typeof v === "string" ? v : fallback; }
function b(v: unknown, fallback: boolean): boolean { return typeof v === "boolean" ? v : fallback; }
function n(v: unknown, fallback: number): number { return typeof v === "number" && Number.isFinite(v) ? v : fallback; }

/** RFC 4515：把用户输入放进 filter 前必须转义，否则可注入任意 LDAP filter */
export function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

export function runtimeConfig(row: IdpRow): LdapRuntimeConfig {
  if (row.kind !== "LDAP") throw new DomainError("VALIDATION", "该身份源不是 LDAP", null);
  const c = rawConfig(row);
  const url = s(c.url, row.issuer);
  if (!/^ldaps?:\/\//i.test(url)) throw new DomainError("VALIDATION", "LDAP URL 必须是 ldap:// 或 ldaps://", null);
  const baseDn = s(c.baseDn);
  const userFilter = s(c.userFilter, "(uid={{username}})");
  if (!baseDn) throw new DomainError("VALIDATION", "LDAP Base DN 未配置", null);
  if (!userFilter.includes("{{username}}")) throw new DomainError("VALIDATION", "LDAP 用户过滤器必须包含 {{username}}", null);
  return {
    url, bindDn: s(c.bindDn, row.clientId),
    bindPassword: row.clientSecretEncrypted ? (decryptSecret(row.clientSecretEncrypted) ?? "") : "",
    baseDn, userFilter,
    usernameAttribute: s(c.usernameAttribute, "uid"),
    emailAttribute: s(c.emailAttribute, "mail"),
    nameAttribute: s(c.nameAttribute, "displayName"),
    startTls: b(c.startTls, false),
    tlsRejectUnauthorized: b(c.tlsRejectUnauthorized, true),
    timeoutMs: Math.min(30_000, Math.max(1000, n(c.timeoutMs, 5000))),
    defaultRoleKey: s(c.defaultRoleKey, "MEMBER") || "MEMBER",
  };
}

function client(cfg: LdapRuntimeConfig): Client {
  const secure = /^ldaps:/i.test(cfg.url) || cfg.startTls;
  return new Client({
    url: cfg.url,
    timeout: cfg.timeoutMs,
    connectTimeout: cfg.timeoutMs,
    ...(secure ? { tlsOptions: { rejectUnauthorized: cfg.tlsRejectUnauthorized } } : {}),
  });
}

function attr(entry: Record<string, unknown>, key: string): string {
  const v = entry[key];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  if (Buffer.isBuffer(v)) return v.toString("utf8").trim();
  return v == null ? "" : String(v).trim();
}

function assertAdmin(actor: Actor): void {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

async function rowById(id: string): Promise<IdpRow> {
  const row = (await db.select().from(idpConfig).where(eq(idpConfig.id, id)).limit(1))[0];
  if (!row) throw new DomainError("NOT_FOUND", "身份源不存在", null);
  return row;
}

/** 管理端「测试连接」：服务账号 bind + base DN 下搜索前 5 个用户 */
export async function testLdap(actor: Actor, id: string): Promise<{ ok: true; dnCount: number; sample: string[] }> {
  assertAdmin(actor);
  const row = await rowById(id);
  const cfg = runtimeConfig(row);
  const c = client(cfg);
  try {
    if (cfg.startTls) await c.startTLS({ rejectUnauthorized: cfg.tlsRejectUnauthorized });
    if (cfg.bindDn) await c.bind(cfg.bindDn, cfg.bindPassword);
    const res = await c.search(cfg.baseDn, { scope: "sub", filter: "(objectClass=*)", sizeLimit: 5, attributes: [cfg.usernameAttribute, cfg.emailAttribute] });
    return { ok: true, dnCount: res.searchEntries.length, sample: res.searchEntries.map((e) => e.dn).slice(0, 5) };
  } catch (e) {
    throw new DomainError("VALIDATION", `LDAP 连接失败：${(e as Error).message}`, null);
  } finally {
    await c.unbind().catch(() => { /* ignore */ });
  }
}

async function uniqueUsername(base: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}${i}`;
    const dup = (await db.select({ id: member.id }).from(member).where(eq(member.username, candidate)).limit(1))[0];
    if (!dup) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}

async function assignDefaultRole(memberId: string, roleKey: string): Promise<void> {
  const r = (await db.select({ id: role.id }).from(role).where(eq(role.key, roleKey)).limit(1))[0];
  if (!r) return; // 角色被删时不阻断登录；管理员可从成员页补角色
  await db.insert(roleAssignment).values({ memberId, roleId: r.id, scopeType: "ORG", scopeId: null }).onConflictDoNothing();
}

export interface LdapLoginInput {
  idpId: string;
  username: string;
  password: string;
  totpCode?: string;
  recoveryCode?: string;
}
export interface LdapLoginResult { memberId: string; created: boolean; linked: boolean }

async function findLdapUser(
  cfg: LdapRuntimeConfig, username: string, ctx: { ip: string; userAgent: string | null },
): Promise<Record<string, unknown>> {
  const bindClient = client(cfg);
  try {
    if (cfg.startTls) await bindClient.startTLS({ rejectUnauthorized: cfg.tlsRejectUnauthorized });
    if (cfg.bindDn) await bindClient.bind(cfg.bindDn, cfg.bindPassword);
    const filter = cfg.userFilter.replace(/\{\{username\}\}/g, escapeLdapFilterValue(username));
    const res = await bindClient.search(cfg.baseDn, {
      scope: "sub", filter, sizeLimit: 2,
      attributes: [cfg.usernameAttribute, cfg.emailAttribute, cfg.nameAttribute, "dn"],
    });
    if (res.searchEntries.length !== 1) {
      await recordLoginFailure(username, ctx.ip);
      throw new DomainError("FORBIDDEN", "用户名或密码错误", null);
    }
    return res.searchEntries[0] as unknown as Record<string, unknown>;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    await recordLoginFailure(username, ctx.ip);
    throw new DomainError("FORBIDDEN", "LDAP 目录不可用，请联系管理员", null);
  } finally {
    await bindClient.unbind().catch(() => { /* ignore */ });
  }
}

/**
 * 登录流程。失败统一抛 FORBIDDEN（不区分用户不存在/密码错）；目录不可达抛 VALIDATION 便于管理员排查。
 * 登录失败限流与密码登录共用 login-guard（用户名 + IP）。
 */
export async function loginLdap(
  input: LdapLoginInput,
  ctx: { ip: string; userAgent: string | null },
): Promise<LdapLoginResult> {
  const username = input.username.trim().slice(0, 200);
  if (!username || !input.password) throw new DomainError("FORBIDDEN", "用户名或密码错误", null);
  const attemptAllowed = await consumeLoginAttempt(username, ctx.ip);
  if (!attemptAllowed || await isLockedOut(username, ctx.ip)) throw new DomainError("RATE_LIMITED", "登录尝试过于频繁，请稍后重试", null);

  const row = (await db.select().from(idpConfig).where(and(eq(idpConfig.id, input.idpId), eq(idpConfig.kind, "LDAP"))).limit(1))[0];
  if (!row || !row.enabled) throw new DomainError("FORBIDDEN", "LDAP 登录未启用", null);
  const cfg = runtimeConfig(row);
  const entry = await findLdapUser(cfg, username, ctx);

  const userDn = String((entry as { dn?: string }).dn ?? "");
  if (!userDn) throw new DomainError("FORBIDDEN", "LDAP 用户缺少 DN", null);

  const userClient = client(cfg);
  try {
    if (cfg.startTls) await userClient.startTLS({ rejectUnauthorized: cfg.tlsRejectUnauthorized });
    await userClient.bind(userDn, input.password);
  } catch {
    await recordLoginFailure(username, ctx.ip);
    throw new DomainError("FORBIDDEN", "用户名或密码错误", null);
  } finally {
    await userClient.unbind().catch(() => { /* ignore */ });
  }

  const email = attr(entry, cfg.emailAttribute).toLowerCase();
  const displayName = attr(entry, cfg.nameAttribute) || username;
  const ldapUsername = attr(entry, cfg.usernameAttribute) || username;

  let target = (await db.select().from(member)
    .where(and(eq(member.externalIdp, row.id), eq(member.externalSubject, userDn))).limit(1))[0];
  let created = false;
  let linked = false;
  if (!target && email) {
    const byEmail = (await db.select().from(member).where(eq(member.email, email)).limit(1))[0];
    if (byEmail) {
      await db.update(member).set({ externalIdp: row.id, externalSubject: userDn }).where(eq(member.id, byEmail.id));
      target = byEmail;
      linked = true;
    }
  }
  if (!target) {
    if (!row.autoProvision) throw new DomainError("FORBIDDEN", "该账号未在平台注册，且未开启自动建号", null);
    const domains = (row.allowedEmailDomains ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (domains.length > 0 && !domains.includes(email.split("@")[1] ?? "")) {
      throw new DomainError("FORBIDDEN", "邮箱域不在允许范围内", null);
    }
    if (!email) throw new DomainError("FORBIDDEN", "自动建号需要 LDAP 提供邮箱", null);
    const uname = await uniqueUsername(ldapUsername.slice(0, 60));
    const [ins] = await db.insert(member).values({
      username: uname, email, name: displayName.slice(0, 120), status: "ACTIVE",
      passwordHash: "!ldap", // LDAP 账号本地密码永不可用
      externalIdp: row.id, externalSubject: userDn,
    }).returning();
    target = ins!;
    created = true;
    await assignDefaultRole(target.id, cfg.defaultRoleKey);
  }
  if (target.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "账号已禁用", null);

  // 二因子：LDAP 账号也走同一闸门；未启用者不受影响
  {
    const { verifyForLogin } = await import("./two-factor.service.ts");
    const tf = await verifyForLogin(target.id, { totpCode: input.totpCode, recoveryCode: input.recoveryCode });
    if (tf.required && !tf.ok) {
      if (input.totpCode || input.recoveryCode) await recordLoginFailure(username, ctx.ip);
      throw new DomainError("FORBIDDEN", "需要双因素验证码（动态码或恢复码）", { twoFactorRequired: true });
    }
  }

  await clearLoginFailures(username, ctx.ip);
  await db.update(member).set({ lastLoginAt: new Date() }).where(eq(member.id, target.id));
  await writeSecurityAudit({
    actorId: target.id, actorSnapshot: username, action: "auth.ldap_login", targetType: "MEMBER", targetId: target.id,
    ip: ctx.ip, userAgent: ctx.userAgent, changes: { created, linked, idpId: row.id },
  });
  return { memberId: target.id, created, linked };
}
