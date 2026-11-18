import "./_env.ts";
/**
 * 项目归属部门 + 成员部门筛选界面验收（Round 72）——真实浏览器，自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const DEPT = `项目验收部门${STAMP}`;
const KEY = `PD${STAMP.toUpperCase()}`;
const NAME = `带部门验收项目${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let deptId = null, projectId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async (dept) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const d = await fetch("/api/v1/departments", { method: "POST", headers, body: JSON.stringify({ name: dept }) });
    const deptBody = await d.json();
    const me = await (await fetch("/api/v1/auth/me")).json();
    await fetch(`/api/v1/members/${me.memberId}/organization`, { method: "PATCH", headers, body: JSON.stringify({ departmentId: deptBody.id }) });
    return { deptId: deptBody.id, status: d.status };
  }, DEPT);
  deptId = prep.deptId;
  check("真实创建部门并把 demo 归属该部门", prep.status === 201 && !!deptId);

  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const drawer = page.locator(".ui-drawer");
  await drawer.locator("#p-key").fill(KEY);
  await drawer.locator("#p-name").fill(NAME);
  await drawer.getByRole("button", { name: "所属部门", exact: true }).click();
  await page.getByRole("option", { name: DEPT, exact: true }).click();
  await drawer.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForTimeout(2000);
  const [created] = await sql`select id, department_id from project where key = ${KEY}`;
  projectId = created?.id ?? null;
  check("UI 新建项目并真实写入归属部门", !!projectId && created?.department_id === deptId);

  await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("项目信息", { exact: true }).waitFor({ timeout: 15_000 });
  check("项目概览显示归属部门", (await page.locator("main").innerText()).includes(DEPT));
  await page.screenshot({ path: "/tmp/project-department.png" });

  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);
  await page.locator('.page [aria-label="按部门筛选"]').click();
  await page.getByRole("option", { name: DEPT, exact: true }).click();
  await page.waitForTimeout(1200);
  const memberBody = await page.locator("main").innerText();
  check("成员页按部门筛选后只显示该部门成员", memberBody.includes("演示管理员") && (await page.locator(".members-load-row").count()) === 1);
} finally {
  try {
    if (projectId) await sql`delete from project where id = ${projectId}`;
    if (deptId) {
      await sql`update member set department_id = null where username = 'demo'`;
      await sql`delete from department where id = ${deptId}`;
    }
    await sql`delete from audit_entry where action like 'project.%' or action = 'member.organization_updated'`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  项目部门/成员筛选验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
