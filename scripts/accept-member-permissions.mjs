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
  const actor = await pageA.evaluate(async () => (await fetch("/api/v1/auth/me")).json());
  const [{ email: actorEmail }] = await sql`select email from member where id = ${actor.memberId}`;
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
  if (!memberId) throw new Error("临时成员创建失败");

  await pageA.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2500);
  const demoRow = pageA.locator(".members-table tbody tr").filter({ has: pageA.getByText(actorEmail, { exact: true }) });
  await demoRow.getByRole("button", { name: "权限", exact: true }).click();
  await pageA.waitForTimeout(900);
  const drawer = pageA.locator(".perm-drawer");
  const text = await drawer.innerText().catch(() => "");
  check("管理员可查看管理员权限（角色 + 作用域）", /管理员/.test(text) && /ORG/.test(text), text.split("\n").slice(0, 5).join(" | "));
  check("权限抽屉展示权限 key（含 setting:manage）", text.includes("setting:manage") && /权限（\d+）/.test(text));
  await pageA.keyboard.press("Escape"); await pageA.waitForTimeout(400);
  await pageA.locator(".members-table tbody tr").filter({ has: pageA.getByText(`${U}@x.test`, { exact: true }) }).getByRole("button", { name: "权限", exact: true }).click();
  await pageA.locator(".perm-drawer .perm-chip").first().waitFor();
  const memberText = await pageA.locator(".perm-drawer").innerText();
  check("管理员可查看其他成员的 MEMBER 角色和权限", memberText.includes("成员") && memberText.includes("work_item:create"));
  await pageA.keyboard.press("Escape");

  // 普通成员：只能看自己
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/login`);
  const loginB = await pageB.evaluate(async ({ u, pw }) => {
    const r = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) });
    return r.status;
  }, { u: U, pw: PW });
  check("临时成员登录成功", loginB === 200, String(loginB));
  const passwordSetup = await pageB.evaluate(async ({ u, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const newPassword = `${pw}-changed`;
    const changed = await fetch("/api/v1/auth/password/change", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ currentPassword: pw, newPassword }) });
    const login = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: newPassword }) });
    return { changed: changed.status, login: login.status };
  }, { u: U, pw: PW });
  check("临时成员完成首次改密并重新登录", passwordSetup.changed === 200 && passwordSetup.login === 200, JSON.stringify(passwordSetup));
  await pageB.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await pageB.waitForTimeout(2500);
  await pageB.locator(".members-table tbody tr").filter({ has: pageB.getByText(`${U}@x.test`, { exact: true }) }).waitFor();
  // 成员目录的权限按钮只对 member:manage 可见；普通成员权限边界由真实 API 验证。
  const own = await pageB.evaluate(async ({ id, adminId }) => {
    const self = await fetch(`/api/v1/members/${id}/permissions`);
    const other = await fetch(`/api/v1/members/${adminId}/permissions`);
    return { self: { status: self.status, body: await self.json() }, other: { status: other.status } };
  }, { id: memberId, adminId: actor.memberId });
  check("普通成员可通过权限接口查看自己的 MEMBER 角色与 work_item:create", own.self.status === 200 && own.self.body?.assignments?.some((assignment) => assignment.role.key === "MEMBER") && own.self.body?.permissions?.includes("work_item:create"), JSON.stringify({ status: own.self.status, assignments: own.self.body?.assignments?.length }));
  check("普通成员不能通过权限接口查看他人", own.other.status === 403, JSON.stringify(own.other));
  check("普通成员看不到目录的管理操作", await pageB.getByRole("button", { name: "归属", exact: true }).count() === 0 && await pageB.getByRole("button", { name: "权限", exact: true }).count() === 0);
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
