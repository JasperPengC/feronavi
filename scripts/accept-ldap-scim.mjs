import "./_env.ts";
/**
 * LDAP/AD + SCIM 2.0 全自动验收。
 * 自动：启动 OpenLDAP 容器 → 写入用户 → 配置 IdP → 连接测试 → LDAP 登录
 *        → SCIM token/Users/Groups/PATCH → 清理数据/容器。
 * 依赖：Docker、隔离 runner 提供的测试服务/数据库/管理员账号。
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { Client } from "ldapts";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const ADMIN_USER = process.env.A11Y_USERNAME ?? "demo";
const ADMIN_PASS = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const containerName = `feronavi-test-ldap-${randomUUID()}`;
let containerId;
let LDAP_PORT;
const STAMP = randomUUID().replaceAll("-", "").slice(0, 10);
const files = mkdtempSync(join(tmpdir(), "feronavi-ldap-accept-"));
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser; let adminPage; let idpId; let scimTokenId; let scimToken; let groupId;
let interrupted = false;
const interrupt = () => { interrupted = true; void browser?.close().catch(() => {}); };
const checkInterrupted = () => { if (interrupted) throw new Error("LDAP/SCIM 验收已取消"); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  if (!DB || !BASE) throw new Error("需要隔离 runner 提供数据库与服务地址");

  console.log("  启动 OpenLDAP 容器…");
  const ldapEnv = join(files, "ldap.env");
  writeFileSync(ldapEnv, "LDAP_ORGANISATION=Feronavi Accept\nLDAP_DOMAIN=example.com\nLDAP_ADMIN_PASSWORD=adminpass\n", { mode: 0o600 });
  containerId = docker("run", "-d", "--rm", "--name", containerName, "--label", "feronavi.test.fixture=true", "-p", "127.0.0.1::389",
    "--env-file", ldapEnv,
    "osixia/openldap:1.5.0").trim();
  if (!/^[a-f0-9]{12,64}$/u.test(containerId)) throw new Error("Docker 未返回可验证的测试容器 ID");
  const published = /^127\.0\.0\.1:(\d+)$/u.exec(docker("port", containerId, "389/tcp").trim());
  if (!published) throw new Error("LDAP 未绑定 loopback 动态端口");
  LDAP_PORT = Number(published[1]);
  let ready = false;
  let consecutiveReady = 0;
  // bootstrap 阶段有临时 slapd；必须等正式 daemon 标记并从宿主端口连续 bind 成功。
  for (let i = 0; i < 60; i += 1) {
    checkInterrupted();
    const client = new Client({ url: `ldap://127.0.0.1:${LDAP_PORT}`, timeout: 2000, connectTimeout: 2000 });
    try {
      const logs = spawnSync("docker", ["logs", containerId], { encoding: "utf8" });
      if (!`${logs.stdout ?? ""}${logs.stderr ?? ""}`.includes("Running /container/run/process/slapd/run")) throw new Error("bootstrap 未完成");
      await client.bind("cn=admin,dc=example,dc=com", "adminpass");
      await client.search("dc=example,dc=com", { scope: "base", filter: "(objectClass=*)", attributes: ["dn"] });
      consecutiveReady++;
      if (consecutiveReady >= 3) { ready = true; break; }
    } catch { consecutiveReady = 0; }
    finally { await client.unbind().catch(() => {}); }
    await sleep(500);
  }
  if (!ready) throw new Error("LDAP 容器就绪超时");
  const seedClient = new Client({ url: `ldap://127.0.0.1:${LDAP_PORT}`, timeout: 5000, connectTimeout: 5000 });
  try {
    await seedClient.bind("cn=admin,dc=example,dc=com", "adminpass");
    await seedClient.add("ou=people,dc=example,dc=com", { objectClass: "organizationalUnit", ou: "people" });
    await seedClient.add(`uid=ldapaccept${STAMP},ou=people,dc=example,dc=com`, {
      objectClass: "inetOrgPerson", cn: "LDAP Accept", sn: "Accept", uid: `ldapaccept${STAMP}`,
      mail: `ldapaccept${STAMP}@example.com`, userPassword: "acceptpass",
    });
  } finally { await seedClient.unbind(); }
  check("OpenLDAP 启动并写入用户", true);

  checkInterrupted();
  browser = await chromium.launch({ channel: "chrome" });
  const adminCtx = await browser.newContext(); adminPage = await adminCtx.newPage();
  await adminPage.goto(`${BASE}/login`); await adminPage.waitForTimeout(300);
  await adminPage.evaluate(async ({ u, p }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }); }, { u: ADMIN_USER, p: ADMIN_PASS });

  const cfg = {
    kind: "LDAP", issuer: `ldap://127.0.0.1:${LDAP_PORT}`, clientId: "cn=admin,dc=example,dc=com",
    clientSecret: "adminpass", autoProvision: true, enabled: true, allowedEmailDomains: "example.com",
    config: { url: `ldap://127.0.0.1:${LDAP_PORT}`, bindDn: "cn=admin,dc=example,dc=com", baseDn: "ou=people,dc=example,dc=com",
      userFilter: "(uid={{username}})", usernameAttribute: "uid", emailAttribute: "mail", nameAttribute: "cn",
      startTls: false, tlsRejectUnauthorized: true, timeoutMs: 5000, defaultRoleKey: "MEMBER" },
  };
  const idp = await adminPage.evaluate(async (body) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const r = await fetch("/api/v1/settings/idp", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }, cfg);
  idpId = idp.body?.id;
  check("保存 LDAP 身份源", idp.status === 201 || idp.status === 200, String(idp.status));
  const tested = await adminPage.evaluate(async (id) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const r = await fetch(`/api/v1/settings/idp/${id}/test`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: "{}" });
    return { status: r.status, body: await r.json() };
  }, idpId);
  check("LDAP 连接测试", tested.status === 200 && tested.body?.ok === true, `${tested.status}/${tested.body?.dnCount}`);

  const loginCtx = await browser.newContext(); const loginPage = await loginCtx.newPage();
  await loginPage.goto(`${BASE}/login`); await loginPage.waitForTimeout(200);
  const ldapLogin = await loginPage.evaluate(async ({ id, u, p }) => {
    const r = await fetch("/api/v1/auth/ldap/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ idpId: id, username: u, password: p }) });
    const body = await r.json();
    const me = r.ok ? await fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((x) => x.json()) : null;
    return { status: r.status, body, me };
  }, { id: idpId, u: `ldapaccept${STAMP}`, p: "acceptpass" });
  check("LDAP 用户登录", ldapLogin.status === 200 && ldapLogin.me?.username === `ldapaccept${STAMP}`, `${ldapLogin.status}/${ldapLogin.me?.name}`);
  const badLdapLogin = await loginPage.evaluate(async ({ id, u }) => {
    const response = await fetch("/api/v1/auth/ldap/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idpId: id, username: u, password: "wrong-password" }) });
    return { status: response.status, body: await response.json() };
  }, { id: idpId, u: `ldapaccept${STAMP}` });
  check("LDAP 错误密码拒绝且不泄露凭据", badLdapLogin.status === 403 && !JSON.stringify(badLdapLogin.body).includes("wrong-password"));
  await loginCtx.close();

  // SCIM
  const scim = await adminPage.evaluate(async ({ uname, tokenName }) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const H = { "content-type": "application/json", "x-csrf-token": csrf };
    const t = await fetch("/api/v1/scim/tokens", { method: "POST", credentials: "same-origin", headers: H, body: JSON.stringify({ name: tokenName }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    if (!t.body?.token) return { token: t };
    const SH = { authorization: `Bearer ${t.body.token}`, "content-type": "application/scim+json" };
    const u = await fetch("/scim/v2/Users", { method: "POST", headers: SH, body: JSON.stringify({ userName: uname, displayName: "SCIM Accept", emails: [{ value: `${uname}@example.com` }], active: true }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const list = await fetch(`/scim/v2/Users?filter=userName eq "${uname}"`, { headers: SH }).then((r) => r.json());
    const patch = await fetch(`/scim/v2/Users/${u.body.id}`, { method: "PATCH", headers: SH, body: JSON.stringify({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const g = await fetch("/scim/v2/Groups", { method: "POST", headers: SH, body: JSON.stringify({ displayName: `scim-accept-${uname}`, members: [{ value: u.body.id }] }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return { token: t, user: u, list, patch, group: g, tokenValue: t.body.token };
  }, { uname: `scimaccept${STAMP}`, tokenName: `ldap-scim-${STAMP}` });
  scimTokenId = scim.token.body?.id; scimToken = scim.tokenValue;
  check("SCIM 创建用户", scim.user?.status === 201, String(scim.user?.status));
  check("SCIM 过滤查询", (scim.list?.totalResults ?? 0) === 1);
  check("SCIM 禁用用户", scim.patch?.status === 200 && scim.patch?.body?.active === false);
  groupId = scim.group?.body?.id;
  check("SCIM 创建组并关联成员", scim.group?.status === 201 && (scim.group?.body?.members?.length ?? 0) === 1);
  const invalidScim = await adminPage.evaluate(async () => (await fetch("/scim/v2/Users", { headers: { authorization: "Bearer invalid-test-token" } })).status);
  check("SCIM 错误 bearer token 被拒绝", invalidScim === 401);

  docker("stop", "--time", "1", containerId);
  const unavailable = await adminPage.evaluate(async ({ id, username }) => {
    const started = Date.now();
    const response = await fetch("/api/v1/auth/ldap/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idpId: id, username, password: "acceptpass" }), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, elapsed: Date.now() - started, body: await response.json() };
  }, { id: idpId, username: `ldapaccept${STAMP}` });
  check("LDAP 独立目录停止后10秒内明确失败", unavailable.status === 403 && unavailable.elapsed < 10_000 && !JSON.stringify(unavailable.body).includes("acceptpass"));

  // 清理：组、成员、token、IdP
  if (groupId && scimToken) {
    await adminPage.evaluate(async ({ id, token }) => { await fetch(`/scim/v2/Groups/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }); }, { id: groupId, token: scimToken });
  }
  if (scimTokenId) {
    await adminPage.evaluate(async (id) => {
      const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
      await fetch(`/api/v1/scim/tokens/${id}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
    }, scimTokenId);
  }
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  // 最后清理 IdP / 测试成员（即使中途失败）
  try {
    if (DB) {
      const sql = postgres(DB, { max: 1 });
      try {
      if (idpId) await sql`delete from idp_config where id = ${idpId}`;
      const rows = await sql`select id from member where username in (${`ldapaccept${STAMP}`}, ${`scimaccept${STAMP}`})`;
      for (const r of rows) { await sql`delete from role_assignment where member_id = ${r.id}`; await sql`update audit_entry set actor_id = null where actor_id = ${r.id}`; await sql`delete from member where id = ${r.id}`; }
      if (scimTokenId) await sql`delete from scim_token where id = ${scimTokenId}`;
      } finally { await sql.end(); }
    }
  } catch { /* ignore */ }
  try { if (containerId) docker("rm", "-f", containerId); } catch { /* 容器 --rm 已清理。 */ }
  rmSync(files, { recursive: true, force: true });
  if (adminPage) await adminPage.close().catch(() => {});
  if (browser) await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  LDAP/SCIM 验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
