import "./_env.ts";
/**
 * 多副本在线状态界面验收（Round 61）——可重复执行、自建自清。
 * 两个真实浏览器上下文分别访问两个隔离 app 实例（同测试库及独立缓存）：
 * A demo 在线 → B 临时成员登录后 A **无刷新**变 2 人 → 关 B 后 A 回落 1 人。
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { join } from "node:path";
const A = process.env.A_URL;
const B = process.env.B_URL;
if (!A || !B || A === B || A !== process.env.FERONAVI_TEST_A_URL || B !== process.env.FERONAVI_TEST_B_URL) throw new Error("多副本地址必须由隔离 runner 提供");
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-6);
const U = `multiui${stamp}`;
const NAME = `多副本验收成员 ${stamp}`;
const PW = "multi-ui-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctxA.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const pageA = await ctxA.newPage();
let memberId = null;
try {
  await pageA.goto(`${A}/login`); await pageA.waitForTimeout(600);
  await pageA.evaluate(async (a) => { await fetch(`${a}/api/v1/auth/login`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); }, A);
  await pageA.goto(`${A}/projects`, { waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2200);
  check("A 初始「1 人在线」", /1 人在线/.test(await pageA.locator(".presence-avatars").innerText().catch(() => "")), await pageA.locator(".presence-avatars").innerText().catch(() => ""));

  const created = await pageA.evaluate(async ({ a, u, name, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const r = await fetch(`${a}/api/v1/members`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ username: u, name, email: `${u}@x.test`, password: pw }) });
    return { status: r.status, body: await r.json() };
  }, { a: A, u: U, name: NAME, pw: PW });
  memberId = created.body?.id ?? null;
  check("真实创建临时成员", created.status === 201 && !!memberId);

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const pageB = await ctxB.newPage();
  await pageB.goto(`${B}/login`); await pageB.waitForTimeout(500);
  const loginB = await pageB.evaluate(async ({ b, u, pw }) => {
    const r = await fetch(`${b}/api/v1/auth/login`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) });
    return r.status;
  }, { b: B, u: U, pw: PW });
  check("B 实例上临时成员登录", loginB === 200, String(loginB));
  await pageB.goto(`${B}/projects`, { waitUntil: "domcontentloaded" }); await pageB.waitForTimeout(2200);
  check("B 看到「2 人在线」（共享注册表）", /2 人在线/.test(await pageB.locator(".presence-avatars").innerText().catch(() => "")), await pageB.locator(".presence-avatars").innerText().catch(() => ""));

  let aText = "";
  for (let i = 0; i < 20; i++) {
    await pageA.waitForTimeout(300);
    aText = await pageA.locator(".presence-avatars").innerText().catch(() => "");
    if (/2 人在线/.test(aText)) break;
  }
  check("A 无刷新实时变「2 人在线」（跨实例）", /2 人在线/.test(aText), aText);
  await pageA.screenshot({ path: join(process.env.FERONAVI_TEST_DIRECTORY, "multi-instance-presence.png") });

  await ctxB.close();
  let back = "";
  for (let i = 0; i < 25; i++) {
    await pageA.waitForTimeout(300);
    back = await pageA.locator(".presence-avatars").innerText().catch(() => "");
    if (/1 人在线/.test(back)) break;
  }
  check("B 关闭后 A 回落「1 人在线」（跨实例）", /1 人在线/.test(back), back);
} finally {
  if (memberId) {
    try {
      await sql`delete from audit_entry where actor_id = ${memberId} or target_id = ${memberId}`;
      await sql`delete from activity_entry where actor_id = ${memberId}`;
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    } catch (e) { console.error("[cleanup]", e.message); }
  }
  await sql.end(); await ctxA.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  多副本在线状态验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
