import "./_env.ts";
/**
 * 成员权限详情界面验收（Round 25 长任务第 53 项）——可重复执行、自建自清。
 * 管理员查看任意成员权限；普通成员只能看自己（管理按钮不出现）。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-6);
const U = `permuser${stamp}`;
const NAME = `权限验收成员 ${stamp}`;
const PW = "perm-ui-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctxA.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const pageA = await ctxA.newPage();
let memberId = null;
try {
  await pageA.goto(`${BASE}/login`); await pageA.waitForTimeout(600);
  await pageA.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  // 管理员通过真实接口创建临时成员
  const created = await pageA.evaluate(async ({ u, name, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const r = await fetch("/api/v1/members", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ username: u, name, email: `${u}@x.test`, password: pw }),
    });
    return { status: r.status, body: await r.json() };
  }, { u: U, name: NAME, pw: PW });
  memberId = created.body?.id ?? null;
  check("真实创建临时成员", created.status === 201 && !!memberId, JSON.stringify(created.status));

  await pageA.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2500);
  const demoRow = pageA.locator(".members-load-row", { hasText: "演示管理员" }).first();
  await demoRow.getByRole("button", { name: "权限", exact: true }).click();
  await pageA.waitForTimeout(900);
  const drawer = pageA.locator(".perm-drawer");
  const text = await drawer.innerText().catch(() => "");
  check("管理员可查看任意成员权限（角色 + 作用域）", /管理员/.test(text) && /ORG/.test(text), text.split("\n").slice(0, 4).join(" | "));
  check("权限抽屉展示权限 key（含 setting:manage）", text.includes("setting:manage") && /权限（\d+）/.test(text));
  await pageA.keyboard.press("Escape"); await pageA.waitForTimeout(400);

  // 普通成员：只能看自己
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/login`);
  const loginB = await pageB.evaluate(async ({ u, pw }) => {
    const r = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) });
    return r.status;
  }, { u: U, pw: PW });
  check("临时成员登录成功", loginB === 200, String(loginB));
  await pageB.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await pageB.waitForTimeout(2500);
  const ownRow = pageB.locator(".members-load-row", { hasText: NAME }).first();
  check("普通成员自己那行有「权限」按钮", (await ownRow.getByRole("button", { name: "权限", exact: true }).count()) === 1);
  check("普通成员对他人行无「权限」按钮", (await pageB.locator(".members-load-row", { hasText: "演示管理员" }).first().getByRole("button", { name: "权限", exact: true }).count()) === 0);
  await ownRow.getByRole("button", { name: "权限", exact: true }).click();
  await pageB.waitForTimeout(900);
  const ownText = await pageB.locator(".perm-drawer").innerText().catch(() => "");
  check("成员看到自己的 MEMBER 角色与 work_item:create", /成员/.test(ownText) && ownText.includes("work_item:create"), ownText.split("\n").slice(0, 4).join(" | "));
  await pageA.screenshot({ path: "/tmp/member-permissions.png" });
  await ctxB.close();
} finally {
  try {
    if (memberId) {
      await sql`delete from audit_entry where target_id = ${memberId} or actor_id = ${memberId}`;
      await sql`delete from activity_entry where actor_id = ${memberId}`;
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  await ctxA.close(); await sql.end(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  成员权限详情验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
