import "./_env.ts";
/**
 * 成员目录（部门侧栏 + 搜索/状态/角色筛选 + 表格）界面验收（Round 82）
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const DEPT = `验收部门${STAMP}`;
const U = `md${STAMP}`;
const NAME = `目录成员${STAMP}`;
const PW = "md-accept-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let deptId = null, memberId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ name, dept, u, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const d = await (await fetch("/api/v1/departments", { method: "POST", headers, body: JSON.stringify({ name: dept }) })).json();
    const roles = await (await fetch("/api/v1/roles")).json();
    const memberRole = (roles.roles ?? roles.items ?? []).find((r) => r.key === "MEMBER");
    const m = await (await fetch("/api/v1/members", { method: "POST", headers, body: JSON.stringify({ username: u, name, email: `${u}@x.test`, password: pw, roleIds: memberRole ? [memberRole.id] : [] }) })).json();
    await fetch(`/api/v1/members/${m.id}/organization`, { method: "PATCH", headers, body: JSON.stringify({ departmentId: d.id, positionId: null }) });
    return { deptId: d.id, memberId: m.id };
  }, { name: NAME, dept: DEPT, u: U, pw: PW });
  deptId = prep.deptId; memberId = prep.memberId;
  check("真实创建验收部门与成员", !!deptId && !!memberId);

  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" });
  const dir = page.locator(".members-directory");
  await dir.waitFor({ timeout: 15_000 });
  check("页面显示成员目录面板", (await dir.count()) === 1);
  const head = await dir.innerText();
  check("表格含用户/部门/岗位/角色/状态/加入时间", ["用户", "部门", "岗位", "角色", "状态", "加入时间"].every((k) => head.includes(k)), head.slice(0, 100));
  check("部门侧栏含全部成员与验收部门", head.includes("全部成员") && head.includes(DEPT));
  check("角色列显示 MEMBER 归属", head.includes("成员") && head.includes("ORG"));

  // 部门侧栏筛选
  await dir.locator(".members-dept-item", { hasText: DEPT }).click();
  await page.waitForTimeout(700);
  const filtered = await dir.locator("table tbody").innerText();
  check("点击部门后表格只剩该部门成员", filtered.includes(NAME) && !filtered.includes("演示管理员"), filtered.slice(0, 80));

  // 搜索 + 状态筛选
  await dir.getByLabel("搜索姓名/工号/邮箱").fill(NAME);
  await page.waitForTimeout(600);
  check("搜索命中验收成员", (await dir.locator("table tbody").innerText()).includes(NAME));
  await dir.getByLabel("搜索姓名/工号/邮箱").fill("");
  await page.waitForTimeout(400);
  await dir.locator('[aria-label="状态"]').click();
  await page.getByRole("option", { name: "停用", exact: true }).click();
  await page.waitForTimeout(700);
  check("状态筛选停用后无匹配", (await dir.innerText()).includes("没有匹配的成员"));
  await dir.locator('[aria-label="状态"]').click();
  await page.getByRole("option", { name: "全部状态", exact: true }).click();
  await page.waitForTimeout(500);
  await dir.locator('[aria-label="角色"]').click();
  await page.getByRole("option", { name: "成员", exact: true }).click();
  await page.waitForTimeout(700);
  const roleFiltered = await dir.locator("table tbody").innerText();
  check("角色筛选成员后不含管理员角色行", roleFiltered.includes(NAME) && !roleFiltered.includes("演示管理员"), roleFiltered.slice(0, 80));
  await page.screenshot({ path: "/tmp/members-directory.png" });
} finally {
  try {
    if (memberId) {
      await sql`delete from audit_entry where actor_id = ${memberId} or target_id = ${memberId}`;
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    }
    if (deptId) await sql`delete from department where id = ${deptId}`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  成员目录验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
