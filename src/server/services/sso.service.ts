/**
 * SSO（第十四期，P5 的 SSO：OIDC / LDAP）
 *
 * 本轮完成**配置 + 发现 + 授权请求（含 PKCE）**；回调与 ID Token 校验在下一轮
 * （不做"看起来能登录"的半成品：回调才是安全边界所在）。
 *
 * 纪律：
 *   - `issuer` 过**统一 SSRF 校验**（用户可控出站 URL 的统一收口）
 *   - `client_secret` 信封加密、**永不回显**（列表只报 hasSecret）
 *   - `state`/`nonce`/`code_verifier` **随机、一次性、短时效**（防 CSRF 与授权码注入）
 *   - 发现文档里的端点**也要过 SSRF 校验**：IdP 可以返回一个指向内网的 token_endpoint
 */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { idpConfig, member, ssoLoginState } from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { assertSafeOutboundUrl } from "../lib/url-safety.ts";
import { decryptSecret, encryptSecret } from "./crypto.service.ts";

const STATE_TTL_MS = 10 * 60 * 1000;   // 握手 10 分钟足够，越短越好

function assertAdmin(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function upsertIdp(actor: Actor, input: {
  id?: string; kind: "OIDC" | "LDAP"; issuer: string; clientId: string;
  clientSecret?: string | null; autoProvision?: boolean; enabled?: boolean; allowedEmailDomains?: string | null;
  config?: Record<string, unknown>;
}) {
  assertAdmin(actor);
  if (input.kind === "OIDC") {
    await assertSafeOutboundUrl(input.issuer);        // 统一 SSRF 收口
  } else if (!/^ldaps?:\/\//i.test(input.issuer)) {
    throw new DomainError("VALIDATION", "LDAP 地址必须是 ldap:// 或 ldaps://", null);
  }
  const values = {
    kind: input.kind, issuer: input.issuer, clientId: input.clientId,
    clientSecretEncrypted: input.clientSecret ? encryptSecret(input.clientSecret) : null,
    autoProvision: input.autoProvision ?? false, enabled: input.enabled ?? false,
    allowedEmailDomains: input.allowedEmailDomains ?? null,
    config: input.config ?? {},
  };
  if (input.id) {
    const patch: Record<string, unknown> = { ...values };
    if (!input.clientSecret) delete patch.clientSecretEncrypted;   // 不传新密钥则保留旧的
    const [row] = await db.update(idpConfig).set(patch).where(eq(idpConfig.id, input.id)).returning();
    if (!row) throw new DomainError("NOT_FOUND", "身份源不存在", null);
    return { ...row, clientSecretEncrypted: undefined, hasSecret: row.clientSecretEncrypted !== null };
  }
  const [row] = await db.insert(idpConfig).values(values).returning();
  return { ...row!, clientSecretEncrypted: undefined, hasSecret: row!.clientSecretEncrypted !== null };
}

export async function listIdps(actor: Actor) {
  assertAdmin(actor);
  const rows = await db.select().from(idpConfig).orderBy(desc(idpConfig.createdAt));
  return rows.map(({ clientSecretEncrypted, ...rest }) => ({ ...rest, hasSecret: clientSecretEncrypted !== null }));
}

/** 登录页用：**只暴露"有没有可用的 SSO"**，不泄露 issuer 与 client_id（未登录者不该看到内部配置） */
export async function publicIdpList() {
  const rows = await db.select({ id: idpConfig.id, kind: idpConfig.kind, issuer: idpConfig.issuer })
    .from(idpConfig).where(and(eq(idpConfig.enabled, true), eq(idpConfig.kind, "OIDC")));
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: safeLabel(r.issuer) }));
}

function safeLabel(issuer: string): string {
  try { return new URL(issuer).host; } catch { return "SSO"; }
}

export interface Discovery {
  issuer: string; authorization_endpoint: string; token_endpoint: string;
  jwks_uri: string; userinfo_endpoint?: string;
}

/**
 * OIDC 发现：`{issuer}/.well-known/openid-configuration`（issuer 带路径时按规范补在路径后）。
 * ⚠️ **返回的端点也要过 SSRF 校验** —— 否则恶意 IdP 可以给出指向内网的 token_endpoint，
 * 把平台变成内网探测/攻击的跳板。
 */
export async function discover(idp: { issuer: string }): Promise<Discovery> {
  await assertSafeOutboundUrl(idp.issuer);
  const base = idp.issuer.replace(/\/$/, "");
  const url = `${base}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await safeOutboundFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new DomainError("VALIDATION", `无法访问发现文档：${(e as Error).message}`, null);
  }
  if (!res.ok) throw new DomainError("VALIDATION", `发现文档返回 ${res.status}`, null);
  const doc = (await res.json()) as Partial<Discovery>;
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (!doc[k]) throw new DomainError("VALIDATION", `发现文档缺少 ${k}`, null);
    await assertSafeOutboundUrl(doc[k]!);          // 关键：端点同样收口
  }
  if (doc.issuer && doc.issuer.replace(/\/$/, "") !== base) {
    throw new DomainError("VALIDATION", "发现文档的 issuer 与配置不一致（规范要求必须一致）", null);
  }
  return doc as Discovery;
}

/** 建授权请求：返回 IdP 的授权 URL，并把 state/nonce/PKCE 落库（一次性） */
export async function startLogin(actor: Actor | null, idpId: string, redirectUri: string) {
  void actor;   // 登录前也要能发起（此时还没有 actor）
  const idp = (await db.select().from(idpConfig).where(eq(idpConfig.id, idpId)).limit(1))[0];
  if (!idp || !idp.enabled) throw new DomainError("NOT_FOUND", "身份源不可用", null);
  if (idp.kind !== "OIDC") throw new DomainError("VALIDATION", "本轮仅支持 OIDC", null);
  const d = await discover(idp);

  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const codeVerifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(codeVerifier).digest());
  await db.insert(ssoLoginState).values({
    state, idpConfigId: idp.id, nonce, codeVerifier, redirectUri,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  // 顺手清理过期握手（无需 worker）
  await db.delete(ssoLoginState).where(lt(ssoLoginState.expiresAt, new Date()));

  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", idp.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: u.toString(), state, expiresInSec: STATE_TTL_MS / 1000 };
}

/** 取出并**消费**握手状态（一次性）：回调第一步 */
export async function consumeState(state: string) {
  // DELETE RETURNING 原子消费；读后删会让并发回调取得同一份 nonce / PKCE 材料。
  const row = (await db.delete(ssoLoginState).where(eq(ssoLoginState.state, state)).returning())[0];
  if (!row) throw new DomainError("FORBIDDEN", "登录状态无效或已使用", null);
  if (row.expiresAt.getTime() < Date.now()) throw new DomainError("FORBIDDEN", "登录状态已过期", null);
  const idp = (await db.select().from(idpConfig).where(eq(idpConfig.id, row.idpConfigId)).limit(1))[0];
  if (!idp || !idp.enabled) throw new DomainError("FORBIDDEN", "身份源已停用", null);
  return { row, idp, clientSecret: idp.clientSecretEncrypted ? decryptSecret(idp.clientSecretEncrypted) : null };
}

// ── 回调：授权码兑换 + ID Token 校验（第十三期第二半）──────────

/**
 * 取 JWKS。⚠️ `jwks_uri` 已过 SSRF 校验（见 discover），此处仍带超时 —— 出站调用一律有上限。
 */
export async function fetchJwks(jwksUri: string): Promise<{ keys: (JsonWebKey & { kid?: string; alg?: string })[] }> {
  await assertSafeOutboundUrl(jwksUri);
  const res = await safeOutboundFetch(jwksUri, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new DomainError("VALIDATION", `JWKS 返回 ${res.status}`, null);
  const doc = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; alg?: string })[] };
  if (!doc.keys?.length) throw new DomainError("VALIDATION", "JWKS 为空", null);
  return { keys: doc.keys };
}

const b64uDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export interface IdTokenClaims {
  iss: string; sub: string; aud: string | string[]; exp: number; iat?: number; nonce?: string;
  email?: string; email_verified?: boolean; name?: string; preferred_username?: string;
}

/**
 * 校验 ID Token。**安全要点逐条落实**：
 *   1 `alg` 必须是 RS256 —— 明确拒绝 `none` 与 HS*（用公钥当 HMAC 密钥的经典混淆攻击）
 *   2 按 `kid` 选钥；找不到即拒（不得回退到"随便试一把"）
 *   3 验签用 `createPublicKey({format:"jwk"})` + `RSA-SHA256`，**先验签再看 claims**
 *   4 claims：`iss` 全等、`aud` 含 client_id、`exp` 未过期（±60s 宽松）、`nonce` **全等**（防重放）
 */
export async function verifyIdToken(
  idToken: string,
  opts: { jwksUri: string; issuer: string; clientId: string; nonce: string },
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new DomainError("FORBIDDEN", "ID Token 格式不正确", null);
  const [h, p, sig] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  try { header = JSON.parse(b64uDecode(h).toString("utf8")); }
  catch { throw new DomainError("FORBIDDEN", "ID Token 头部不可解析", null); }

  if (header.alg !== "RS256") {
    // 1：拒绝 none / HS256 —— 后者是"用 RSA 公钥当 HMAC 密钥"的经典混淆攻击
    throw new DomainError("FORBIDDEN", `不接受的签名算法：${header.alg}`, null);
  }
  const { keys } = await fetchJwks(opts.jwksUri);
  const jwk = keys.find((k) => (header.kid ? k.kid === header.kid : true));
  if (!jwk) throw new DomainError("FORBIDDEN", "JWKS 中没有匹配的密钥", null);

  let pub: import("node:crypto").KeyObject;
  try {
    const { createPublicKey } = await import("node:crypto");
    pub = createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
  } catch {
    throw new DomainError("FORBIDDEN", "JWKS 中的密钥不可用", null);
  }
  const { createVerify } = await import("node:crypto");
  const okSig = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(pub, b64uDecode(sig));
  if (!okSig) throw new DomainError("FORBIDDEN", "ID Token 签名校验失败", null);

  let claims: IdTokenClaims;
  try { claims = JSON.parse(b64uDecode(p).toString("utf8")); }
  catch { throw new DomainError("FORBIDDEN", "ID Token 载荷不可解析", null); }

  if (claims.iss?.replace(/\/$/, "") !== opts.issuer.replace(/\/$/, "")) {
    throw new DomainError("FORBIDDEN", "ID Token 的 issuer 与配置不一致", null);
  }
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.clientId)) throw new DomainError("FORBIDDEN", "ID Token 的 audience 不匹配", null);
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() - 60_000) {
    throw new DomainError("FORBIDDEN", "ID Token 已过期", null);
  }
  if (!claims.nonce || claims.nonce !== opts.nonce) {
    throw new DomainError("FORBIDDEN", "nonce 不匹配（可能是重放的令牌）", null);
  }
  if (!claims.sub) throw new DomainError("FORBIDDEN", "ID Token 缺少 sub", null);
  return claims;
}

/** 授权码兑换（client_secret_basic，失败则退回 client_secret_post —— 两种 IdP 都常见） */
export async function exchangeCode(
  idp: { tokenEndpoint: string; clientId: string },
  clientSecret: string | null,
  input: { code: string; redirectUri: string; codeVerifier: string },
): Promise<{ id_token?: string; access_token?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri,
    client_id: idp.clientId, code_verifier: input.codeVerifier,
  });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const useBasic = clientSecret !== null;
  if (useBasic) headers.authorization = `Basic ${Buffer.from(`${idp.clientId}:${clientSecret}`).toString("base64")}`;
  else body.set("client_id", idp.clientId);

  const doPost = async (b: URLSearchParams, hdrs: Record<string, string>) => {
    const res = await safeOutboundFetch(idp.tokenEndpoint, { method: "POST", headers: hdrs, body: b.toString(), signal: AbortSignal.timeout(15_000) });
    return { status: res.status, text: await res.text() };
  };
  let r = await doPost(body, headers);
  if (r.status >= 400 && useBasic) {
    // 有些 IdP 不接受 Basic：退回把 secret 放表单（OIDC 规范两种都允许）
    const b2 = new URLSearchParams(body); b2.set("client_secret", clientSecret!);
    const h2 = { ...headers }; delete h2.authorization;
    r = await doPost(b2, h2);
  }
  if (r.status >= 400) throw new DomainError("FORBIDDEN", `授权码兑换失败（${r.status}）`, null);
  try { return JSON.parse(r.text); }
  catch { throw new DomainError("FORBIDDEN", "令牌响应不是 JSON", null); }
}

/**
 * 完成登录：兑换 → 校验 → 绑定或建号 → 返回 memberId
 *
 * 账号匹配优先级：`(external_idp, external_subject)` → 邮箱（**且要求 email_verified**）。
 * 邮箱命中即**绑定**（写入 sub），这样同一个人第二次登录走 sub、不再看邮箱（邮箱会改）。
 * 未命中时：只有 `auto_provision` 开启**且**邮箱域在白名单内才建号 —— 否则拒绝，
 * 不能让任意 IdP 用户涌入（自托管下这等同于"谁能登录"的边界）。
 */
export async function completeLogin(input: { state: string; code: string }): Promise<{ memberId: string; created: boolean; linked: boolean }> {
  const { row, idp, clientSecret } = await consumeState(input.state);
  const d = await discover(idp);
  const tokens = await exchangeCode({ tokenEndpoint: d.token_endpoint, clientId: idp.clientId }, clientSecret,
    { code: input.code, redirectUri: row.redirectUri, codeVerifier: row.codeVerifier });
  if (!tokens.id_token) throw new DomainError("FORBIDDEN", "令牌响应缺少 id_token", null);
  const claims = await verifyIdToken(tokens.id_token, {
    jwksUri: d.jwks_uri, issuer: idp.issuer, clientId: idp.clientId, nonce: row.nonce,
  });

  const bySub = (await db.select().from(member)
    .where(and(eq(member.externalIdp, idp.id), eq(member.externalSubject, claims.sub))).limit(1))[0];
  if (bySub) return { memberId: bySub.id, created: false, linked: false };

  const email = (claims.email ?? "").toLowerCase();
  if (email && claims.email_verified === true) {
    const byEmail = (await db.select().from(member).where(eq(member.email, email)).limit(1))[0];
    if (byEmail) {
      await db.update(member).set({ externalIdp: idp.id, externalSubject: claims.sub }).where(eq(member.id, byEmail.id));
      return { memberId: byEmail.id, created: false, linked: true };
    }
  }
  if (!idp.autoProvision) throw new DomainError("FORBIDDEN", "该账号未在平台注册，且未开启自动建号", null);
  if (claims.email_verified !== true) throw new DomainError("FORBIDDEN", "自动建号需要已验证的邮箱", null);
  const domains = (idp.allowedEmailDomains ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (domains.length > 0 && !domains.includes(email.split("@")[1] ?? "")) {
    throw new DomainError("FORBIDDEN", "邮箱域不在允许范围内", null);
  }
  if (!email) throw new DomainError("FORBIDDEN", "自动建号需要 IdP 提供邮箱", null);

  const username = (claims.preferred_username ?? email.split("@")[0]!).slice(0, 60);
  const [created] = await db.insert(member).values({
    username: await uniqueUsername(username), email,
    name: (claims.name ?? username).slice(0, 120), status: "ACTIVE",
    /**
     * SSO 账号没有密码：写入**永不匹配的占位值**。
     * 不用 null（列是 NOT NULL，放宽约束会波及所有路径），也不生成随机可用哈希
     * （那等于给账号留一个"已知密码"）。登录路径对"用户不存在"用的正是同一个占位比较，
     * 因此 SSO 账号走密码登录**必然失败**，这是想要的行为。
     */
    passwordHash: "!sso",
    externalIdp: idp.id, externalSubject: claims.sub,
  }).returning({ id: member.id });
  return { memberId: created!.id, created: true, linked: false };
}

/** 用户名冲突时追加序号（SSO 建号不因重名失败） */
async function uniqueUsername(base: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}${i}`;
    const dup = (await db.select({ id: member.id }).from(member).where(eq(member.username, candidate)).limit(1))[0];
    if (!dup) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}
