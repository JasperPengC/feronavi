import "./_env.ts";
/**
 * 在线状态界面验收（Round 25 长任务第 48 项）——可重复执行、自建自清。
 * 两个真实浏览器上下文（demo + 临时成员）→ 顶栏在线人数实时变化（SSE）→ 关闭一方后回落。
 */
import { chromium } from "playwright";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const U = `presence-ui-${stamp}`;
const PW = "presence-ui-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
let ctxA = null, ctxB = null, memberId = null;
try {
  const pwHash = await hash(PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const [m] = await sql`insert into member (username, email, name, status, timezone, password_hash)
    values (${U}, ${U + "@x.test"}, ${"在线验收成员"}, 'ACTIVE', 'Asia/Shanghai', ${pwHash}) returning id`;
  memberId = m.id;
  const [role] = await sql`select id from role where key = 'MEMBER'`;
  await sql`insert into role_assignment (member_id, role_id, scope_type, scope_id) values (${memberId}, ${role.id}, 'ORG', null)`;

  ctxA = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
  await ctxA.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
  const pageA = await ctxA.newPage();
  await pageA.goto(`${BASE}/login`);
  await pageA.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await pageA.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await pageA.waitForTimeout(2500);
  check("A 登录后顶栏显示在线头像组", (await pageA.locator(".presence-avatars").count()) === 1);
  check("A 初始看到「1 人在线」", /1 人在线/.test(await pageA.locator(".presence-avatars").innerText().catch(() => "")), await pageA.locator(".presence-avatars").innerText().catch(() => ""));

  ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/login`);
  const loginB = await pageB.evaluate(async ({ u, pw }) => {
    const r = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) });
    return r.status;
  }, { u: U, pw: PW });
  check("B 用临时成员登录成功", loginB === 200, String(loginB));
  await pageB.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await pageB.waitForTimeout(2200);
  check("B 看到「2 人在线」", /2 人在线/.test(await pageB.locator(".presence-avatars").innerText().catch(() => "")), await pageB.locator(".presence-avatars").innerText().catch(() => ""));

  // A 通过 SSE 感知 B 上线（不刷新）
  let aText = "";
  for (let i = 0; i < 20; i++) {
    await pageA.waitForTimeout(300);
    aText = await pageA.locator(".presence-avatars").innerText().catch(() => "");
    if (/2 人在线/.test(aText)) break;
  }
  check("A 无刷新实时看到「2 人在线」", /2 人在线/.test(aText), aText);
  await pageA.screenshot({ path: "/tmp/presence-online.png" });

  await ctxB.close(); ctxB = null;
  let back = "";
  for (let i = 0; i < 25; i++) {
    await pageA.waitForTimeout(300);
    back = await pageA.locator(".presence-avatars").innerText().catch(() => "");
    if (/1 人在线/.test(back)) break;
  }
  check("B 关闭后 A 实时回落「1 人在线」", /1 人在线/.test(back), back);
} finally {
  try {
    if (memberId) {
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from audit_entry where actor_id = ${memberId}`;
      await sql`delete from activity_entry where actor_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  if (ctxB) await ctxB.close();
  if (ctxA) await ctxA.close();
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  在线状态界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
