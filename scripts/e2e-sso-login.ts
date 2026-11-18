/** SSO 回调与 ID Token 校验自检（第十四期）：验签、claims、绑定/建号 */
import "./_env-sso.ts";
import "./_env.ts";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { useLocalOutboundMock } from "../tests/support/local-outbound.ts";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, idpConfig, ssoLoginState, auditEntry, activityEntry, session } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as sso from "../src/server/services/sso.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w14f-admin", ISSUER = "https://1.1.1.1", CLIENT = "feronavi-client";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w14f@x.test", name: "SSO 管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14f-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
await db.delete(idpConfig);
for (const e of ["sso-user@corp.test", "linked@corp.test", "outsider@other.test"]) await db.delete(member).where(eq(member.email, e));

// ── 自建 RSA 密钥对，冒充 IdP 的签名密钥 ──
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
const KID = "test-key-1";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signIdToken(claims: Record<string, unknown>, opts: { alg?: string; kid?: string | null; key?: typeof privateKey } = {}) {
  const header = { alg: opts.alg ?? "RS256", typ: "JWT", ...(opts.kid === null ? {} : { kid: opts.kid ?? KID }) };
  const h = b64u(JSON.stringify(header)), p = b64u(JSON.stringify(claims));
  if ((opts.alg ?? "RS256") !== "RS256") {
    // 非 RS256 一律给一个假签名（服务端必须在验签**之前**就拒掉）
    return `${h}.${p}.${b64u("fake-signature")}`;
  }
  const sig = createSign("RSA-SHA256").update(`${h}.${p}`).sign(opts.key ?? privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3970), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3970";

let discoveryBody: Record<string, unknown> = {};
let tokenResponse: Record<string, unknown> = {};
let jwksKeys: unknown[] = [];
let lastTokenRequest = "";
let lastTokenAuthorization = "";
let hangToken = false;
let tokenTimeoutReached = false;
let protocolRequests = 0;
const provider = createServer(async (req, res) => {
  protocolRequests++;
  res.setHeader("content-type", "application/json");
  if (req.url === "/.well-known/openid-configuration") return res.end(JSON.stringify(discoveryBody));
  if (req.url === "/jwks") return res.end(JSON.stringify({ keys: jwksKeys }));
  if (req.url === "/token" && req.method === "POST") {
    if (hangToken) { tokenTimeoutReached = true; return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    lastTokenRequest = Buffer.concat(chunks).toString();
    lastTokenAuthorization = req.headers.authorization ?? "";
    return res.end(JSON.stringify(tokenResponse));
  }
  res.statusCode = 404; res.end("{}");
});
await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
const restoreFetch = useLocalOutboundMock(ISSUER, `http://127.0.0.1:${(provider.address() as { port: number }).port}`);

try {
  discoveryBody = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` };
  jwksKeys = [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }];
  const idp = await sso.upsertIdp(admin, { kind: "OIDC", issuer: ISSUER, clientId: CLIENT, clientSecret: "s3cret", enabled: true, autoProvision: true, allowedEmailDomains: "corp.test" });

  /** 走一遍「发起 → 回调」：返回 completeLogin 的结果或抛错 */
  async function flow(overrides: { claims?: Record<string, unknown>; alg?: string; kid?: string | null } = {}) {
    const started = await sso.startLogin(null, idp!.id, `${BASE}/api/v1/auth/sso/callback`);
    const nonce = new URL(started.authorizationUrl).searchParams.get("nonce")!;
    tokenResponse = {
      id_token: signIdToken({
        iss: ISSUER, sub: "sub-1", aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000), nonce, email: "sso-user@corp.test", email_verified: true, name: "SSO 用户",
        ...overrides.claims,
      }, { alg: overrides.alg, kid: overrides.kid }),
      access_token: "at",
    };
    return sso.completeLogin({ state: started.state, code: "authcode" });
  }

  // ① 正常流程：自动建号
  const first = await flow();
  ok("**合法 ID Token → 建号成功**", first.created === true, JSON.stringify(first));
  const created = (await db.select().from(member).where(eq(member.id, first.memberId)).limit(1))[0]!;
  ok("新账号绑定 sub 与 idp（后续登录按 sub 匹配）", created.externalSubject === "sub-1" && created.externalIdp === idp!.id);
  ok("**SSO 账号的密码哈希是永不匹配的占位值**（不能走密码登录）", created.passwordHash === "!sso");
  ok("令牌兑换用 PKCE：请求体带 code_verifier", lastTokenRequest.includes("code_verifier="));
  ok("client_secret 走 Basic 认证（不出现在 URL 里）", lastTokenAuthorization === `Basic ${Buffer.from(`${CLIENT}:s3cret`).toString("base64")}` && lastTokenRequest.includes("grant_type=authorization_code") && !lastTokenRequest.includes("s3cret"));

  // ② 再登录一次：按 sub 命中，不重复建号
  const second = await flow();
  ok("第二次登录复用同一账号（不重复建号）", second.memberId === first.memberId && second.created === false);
  const count = await db.select({ id: member.id }).from(member).where(eq(member.email, "sso-user@corp.test"));
  ok("库中同邮箱只有一条账号", count.length === 1, String(count.length));

  // ③ 邮箱已存在 → 绑定（不新建）
  const [preexisting] = await db.insert(member).values({ username: "linked-user", email: "linked@corp.test", name: "既有账号", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: "!sso" }).returning({ id: member.id });
  const linked = await flow({ claims: { sub: "sub-2", email: "linked@corp.test" } });
  ok("**邮箱命中既有账号 → 绑定 sub**（不是新建重复账号）", linked.memberId === preexisting!.id && linked.linked === true);

  // ④ 各种恶意/异常令牌
  const cases: [string, Record<string, unknown>, { alg?: string; kid?: string | null }][] = [
    ["nonce 不匹配 → 拒绝（防重放）", { nonce: "wrong-nonce" }, {}],
    ["audience 不匹配 → 拒绝", { aud: "other-client" }, {}],
    ["已过期 → 拒绝", { exp: Math.floor(Date.now() / 1000) - 600 }, {}],
    ["issuer 不一致 → 拒绝", { iss: "https://evil.example.com" }, {}],
    ["alg=none → 拒绝（签名算法混淆）", {}, { alg: "none" }],
    ["alg=HS256 → 拒绝（用公钥当 HMAC 密钥的经典攻击）", {}, { alg: "HS256" }],
    ["kid 找不到 → 拒绝（不回退到随便试一把）", {}, { kid: "unknown-kid" }],
  ];
  for (const [name, claims, signOpts] of cases) {
    let rejected = false;
    try { await flow({ claims, ...signOpts }); } catch (e) { rejected = (e as { code?: string }).code === "FORBIDDEN"; }
    ok(name, rejected);
  }

  // ⑤ 篡改签名
  {
    const started = await sso.startLogin(null, idp!.id, `${BASE}/api/v1/auth/sso/callback`);
    const nonce = new URL(started.authorizationUrl).searchParams.get("nonce")!;
    const good = signIdToken({ iss: ISSUER, sub: "sub-9", aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "x@corp.test" });
    const parts = good.split(".");
    tokenResponse = { id_token: `${parts[0]}.${parts[1]}.${b64u("tampered")}` };
    let rejected = false;
    try { await sso.completeLogin({ state: started.state, code: "c" }); } catch (e) { rejected = (e as { code?: string }).code === "FORBIDDEN"; }
    ok("签名被篡改 → 拒绝", rejected);
  }

  // ⑥ 邮箱域白名单（自动建号边界）
  {
    let rejected = false;
    try { await flow({ claims: { sub: "sub-3", email: "outsider@other.test" } }); }
    catch (e) { rejected = (e as { code?: string }).code === "FORBIDDEN"; }
    ok("**邮箱域不在白名单 → 不自动建号**（谁能登录是边界）", rejected);
    const exists = await db.select({ id: member.id }).from(member).where(eq(member.email, "outsider@other.test"));
    ok("未建号则库中确实没有该账号", exists.length === 0);
  }

  // ⑦ 关闭自动建号后：陌生账号被拒
  await sso.upsertIdp(admin, { id: idp!.id, kind: "OIDC", issuer: ISSUER, clientId: CLIENT, enabled: true, autoProvision: false, allowedEmailDomains: "corp.test" });
  {
    let rejected = false;
    try { await flow({ claims: { sub: "sub-4", email: "brandnew@corp.test" } }); }
    catch (e) { rejected = (e as { code?: string }).code === "FORBIDDEN"; }
    ok("未开自动建号 → 陌生账号被拒", rejected);
  }

  // ⑧ HTTP 回调：成功重定向到 / 并种会话；失败重定向到登录页且**不泄露原因**
  {
    await sso.upsertIdp(admin, { id: idp!.id, kind: "OIDC", issuer: ISSUER, clientId: CLIENT, enabled: true, autoProvision: true, allowedEmailDomains: "corp.test" });
    const started = await sso.startLogin(null, idp!.id, `${BASE}/api/v1/auth/sso/callback`);
    const nonce = new URL(started.authorizationUrl).searchParams.get("nonce")!;
    tokenResponse = { id_token: signIdToken({ iss: ISSUER, sub: "sub-1", aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "sso-user@corp.test", email_verified: true }) };
    const res = await fetch(`${BASE}/api/v1/auth/sso/callback?code=abc&state=${started.state}`, { redirect: "manual" });
    const setCookies = res.headers.getSetCookie();
    const cookies = setCookies.join(";");
    ok("回调成功 → 302 到首页", res.status === 302 && (res.headers.get("location") ?? "") === "/", `${res.status} ${res.headers.get("location")}`);
    /**
     * ⚠️ 断言 Cookie **值**，不只是名字：第一版实现解构错了字段（`session` 不存在），
     * Cookie 值会是字符串 "undefined"，而"名字匹配"的断言照样通过 —— 实测踩到。
     */
    const sessionCookie = setCookies.find((c) => c.includes("session="));
    const sessionValue = sessionCookie?.split("=")[1]?.split(";")[0] ?? "";
    ok("**会话 Cookie 有真值**（不是 undefined/空）", sessionValue.length >= 32 && sessionValue !== "undefined", `len=${sessionValue.length}`);
    ok("种下 CSRF 双 Cookie", cookies.includes("csrf_token="));
    // 更进一步：这个会话**真的能用**（拿它调受保护接口应 200）
    const me = await fetch(`${BASE}/api/v1/auth/me`, { headers: { cookie: setCookies.map((c) => c.split(";")[0]).join("; ") } });
    ok("**SSO 会话可访问受保护接口**（端到端验证会话有效）", me.status === 200, String(me.status));

    const bad = await fetch(`${BASE}/api/v1/auth/sso/callback?code=abc&state=nonexistent`, { redirect: "manual" });
    ok("无效 state → 重定向登录页且**原因不在 URL 里**",
      bad.status === 302 && (bad.headers.get("location") ?? "").includes("sso_error=1")
      && !(bad.headers.get("location") ?? "").includes("nonce"), bad.headers.get("location") ?? "");
  }
  const timeoutStart = Date.now();
  let timeoutRejected = false;
  hangToken = true;
  try { await flow(); } catch { timeoutRejected = true; } finally { hangToken = false; }
  ok("本地 IdP 不响应时 token 兑换在20秒内失败", tokenTimeoutReached && timeoutRejected && Date.now() - timeoutStart >= 14_000 && Date.now() - timeoutStart < 20_000, `elapsedMs=${Date.now() - timeoutStart}`);
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
  console.log(String((e as Error).stack).split("\n").slice(1, 4).join("\n"));
} finally {
  ok("OIDC discovery/token/JWKS 经本地真实 HTTP 传输", protocolRequests >= 3);
  restoreFetch();
  provider.closeAllConnections();
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await app.close();
  await db.delete(session);
  await db.delete(ssoLoginState);
  await db.delete(idpConfig);
  await db.delete(auditEntry); await db.delete(activityEntry);
  for (const e of [U, "linked-user"]) await db.delete(member).where(eq(member.username, e));
  for (const e of ["sso-user@corp.test", "linked@corp.test", "outsider@other.test", "brandnew@corp.test"]) await db.delete(member).where(eq(member.email, e));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
void randomUUID;
