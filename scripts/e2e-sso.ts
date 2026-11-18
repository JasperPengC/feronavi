/** SSO（OIDC）自检（第十四期）：发现、SSRF 收口、PKCE、一次性 state */
import "./_env-sso.ts";   // 必须在 url-safety 之前加载（它在模块加载时读该开关）
import "./_env.ts";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, idpConfig, ssoLoginState, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as sso from "../src/server/services/sso.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w14e-admin";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w14e@x.test", name: "SSO 管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14e-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
await db.delete(idpConfig);

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3971), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3971";

try {
  /**
   * 发现文档用**注入 fetch** 提供，issuer 用可解析的公网域名。
   * 为什么不起本机假 IdP：SSRF 守卫会（正确地）拦掉 127.0.0.1 —— 那是它的职责，不是它的缺陷。
   */
  const ISSUER = "https://example.com";
  let discoveryBody: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.startsWith(`${ISSUER}/.well-known/openid-configuration`)) {
      return new Response(JSON.stringify(discoveryBody), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input as never, init as never);
  }) as typeof fetch;

  try {
    // ① SSRF 收口：公网 https 之外一律先拦（云元数据地址）
    let blocked = false;
    try { await sso.upsertIdp(admin, { kind: "OIDC", issuer: "https://169.254.169.254", clientId: "x", clientSecret: "s" }); }
    catch (e) { blocked = (e as { code?: string }).code === "VALIDATION"; }
    ok("issuer 过统一 SSRF 校验（云元数据被拒）", blocked);

    // ② 配置：密钥加密、不回显
    const idp = await sso.upsertIdp(admin, {
      kind: "OIDC", issuer: ISSUER, clientId: "feronavi-client", clientSecret: "top-secret",
      enabled: true, autoProvision: false, allowedEmailDomains: "example.com",
    });
    ok("创建身份源", !!idp!.id && idp!.enabled === true);
    const row = (await db.select().from(idpConfig).where(eq(idpConfig.id, idp!.id)).limit(1))[0]!;
    ok("client_secret 信封加密入库", row.clientSecretEncrypted!.startsWith("enc:v1:") && !row.clientSecretEncrypted!.includes("top-secret"));
    const list = await sso.listIdps(admin);
    ok("列表不回显密钥、只报 hasSecret", list[0]!.hasSecret === true && !JSON.stringify(list).includes("top-secret"));

    // ③ 发现文档：缺字段 / issuer 不一致 → 明确拒绝
    discoveryBody = { issuer: ISSUER, token_endpoint: `${ISSUER}/token` };
    let missing = false;
    try { await sso.discover(row); } catch (e) { missing = (e as { code?: string }).code === "VALIDATION"; }
    ok("发现文档缺 jwks_uri → VALIDATION", missing);
    discoveryBody = {
      issuer: "https://evil.example.com",
      authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`,
    };
    let mismatch = false;
    try { await sso.discover(row); } catch (e) { mismatch = (e as { code?: string }).code === "VALIDATION"; }
    ok("发现文档 issuer 与配置不一致 → 拒绝（规范要求一致）", mismatch);

    // 顺势测：**发现文档给的端点也要过 SSRF 校验**（恶意 IdP 可借此把平台当内网跳板）
    discoveryBody = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: "http://169.254.169.254/token", jwks_uri: `${ISSUER}/jwks`,
    };
    let endpointBlocked = false;
    try { await sso.discover(row); } catch (e) { endpointBlocked = (e as { code?: string }).code === "VALIDATION"; }
    ok("**发现文档里的端点指向内网 → 拒绝**（不只校验 issuer）", endpointBlocked);

    discoveryBody = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`,
    };

    // ④ 发起登录：PKCE + state + nonce
    const started = await sso.startLogin(null, idp!.id, "http://localhost:3000/api/v1/auth/sso/callback");
    const u = new URL(started.authorizationUrl);
    const q = u.searchParams;
    ok("授权 URL 指向发现文档给的 authorize 端点", u.origin + u.pathname === `${ISSUER}/authorize`, u.origin + u.pathname);
    ok("带 response_type=code 与 client_id", q.get("response_type") === "code" && q.get("client_id") === "feronavi-client");
    ok("**PKCE S256**：code_challenge_method 与 challenge 都在", q.get("code_challenge_method") === "S256" && (q.get("code_challenge") ?? "").length >= 40);
    ok("state 与 nonce 随机且都在", (q.get("state") ?? "").length >= 24 && (q.get("nonce") ?? "").length >= 24);
    ok("scope 含 openid", (q.get("scope") ?? "").includes("openid"));
    const stateRow = (await db.select().from(ssoLoginState).where(eq(ssoLoginState.state, q.get("state")!)).limit(1))[0]!;
    ok("**code_verifier 只存在服务端**（授权 URL 里只有 challenge）",
      stateRow.codeVerifier.length >= 32 && !started.authorizationUrl.includes(stateRow.codeVerifier));

    // ⑤ state 一次性
    const consumed = await sso.consumeState(q.get("state")!);
    ok("消费 state 可取回 nonce 与 verifier 供回调校验", consumed.row.nonce === q.get("nonce") && !!consumed.clientSecret);
    let reused = false;
    try { await sso.consumeState(q.get("state")!); } catch (e) { reused = (e as { code?: string }).code === "FORBIDDEN"; }
    ok("**state 不能重复使用**（防授权码注入）", reused);

    // ⑥ 过期 state
    const s2 = await sso.startLogin(null, idp!.id, "http://localhost:3000/api/v1/auth/sso/callback");
    await db.update(ssoLoginState).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ssoLoginState.state, new URL(s2.authorizationUrl).searchParams.get("state")!));
    let expired = false;
    try { await sso.consumeState(new URL(s2.authorizationUrl).searchParams.get("state")!); }
    catch (e) { expired = (e as { code?: string }).code === "FORBIDDEN"; }
    ok("过期 state 被拒", expired);

    // ⑦ 停用后不可用
    await sso.upsertIdp(admin, { id: idp!.id, kind: "OIDC", issuer: ISSUER, clientId: "feronavi-client", enabled: false });
    let disabled = false;
    try { await sso.startLogin(null, idp!.id, "http://localhost:3000/cb"); } catch (e) { disabled = (e as { code?: string }).code === "NOT_FOUND"; }
    ok("停用的身份源不可发起登录", disabled);
    ok("登录页只看到启用的身份源（停用后为空）", (await sso.publicIdpList()).length === 0);

    // ⑧ HTTP
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: U, password: "w14e-password-1234" }),
    });
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
    const httpList = await fetch(`${BASE}/api/v1/settings/idp`, { headers: { cookie } });
    const lb = (await httpList.json()) as { idps: { hasSecret: boolean }[] };
    ok("HTTP 身份源列表 200 且不含密钥", httpList.status === 200 && lb.idps[0]!.hasSecret === true && !JSON.stringify(lb).includes("top-secret"));
    const anon = await fetch(`${BASE}/api/v1/settings/idp`);
    ok("匿名看不到身份源配置", anon.status === 403, String(anon.status));
    const pub = await fetch(`${BASE}/api/v1/auth/sso/providers`);
    ok("登录页的公开列表可匿名访问（只给 host 级标签）", pub.status === 200, String(pub.status));
    const httpStart = await fetch(`${BASE}/api/v1/auth/sso/${idp!.id}/start`, {
      method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ redirectUri: "http://localhost:3000/api/v1/auth/sso/callback" }),
    });
    ok("停用后 HTTP 发起登录 → 403/404（不泄露细节）", httpStart.status === 404 || httpStart.status === 403, String(httpStart.status));
  } finally {
    globalThis.fetch = realFetch;
  }
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
  console.log(String((e as Error).stack).split("\n").slice(1, 4).join("\n"));
} finally {
  await app.close();
  await db.delete(ssoLoginState);
  await db.delete(idpConfig);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
