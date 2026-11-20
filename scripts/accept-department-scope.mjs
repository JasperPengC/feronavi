import "./_env.ts";
/**
 * 部门数据范围（只读可见性）界面验收（Round 73）——真实浏览器，自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const DEPT = `范围验收部门${STAMP}`;
const KEY = `DS${STAMP.toUpperCase()}`;
const U = `ds${STAMP}`;
const PW = "ds-accept-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await adminCtx.newPage();
let deptId = null, projectId = null, memberId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ dept, key, u, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const d = await fetch("/api/v1/departments", { method: "POST", headers, body: JSON.stringify({ name: dept }) });
    const deptBody = await d.json();
    const p = await fetch("/api/v1/projects", { method: "POST", headers, body: JSON.stringify({ key, name: "部门范围验收项目", departmentId: deptBody.id }) });
    const projectBody = await p.json();
    const m = await fetch("/api/v1/members", { method: "POST", headers, body: JSON.stringify({ username: u, name: "部门范围验收成员", email: `${u}@x.test`, password: pw }) });
    const memberBody = await m.json();
    return { deptId: deptBody.id, projectId: projectBody.id, memberId: memberBody.id, statuses: [d.status, p.status, m.status] };
  }, { dept: DEPT, key: KEY, u: U, pw: PW });
  deptId = prep.deptId; projectId = prep.projectId; memberId = prep.memberId;
  check("真实创建部门/项目/成员", prep.statuses.every((s) => s === 201 || s === 200), JSON.stringify(prep.statuses));

  // 用真实 MEMBER 角色在 DEPARTMENT 范围指派
  // 直建成员会带 ORG 级 MEMBER 指派；本验收要验证**纯部门档**，先清掉再插 DEPARTMENT 指派
  await sql`delete from role_assignment where member_id = ${memberId}`;
  const [memberRole] = await sql`select id from role where key = 'MEMBER'`;
  await sql`insert into role_assignment (member_id, role_id, scope_type, scope_id) values (${memberId}, ${memberRole.id}, 'DEPARTMENT', ${deptId})`;

  const userCtx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
  const up = await userCtx.newPage();
  await up.goto(`${BASE}/login`); await up.waitForTimeout(400);
  await up.evaluate(async ({ u, pw }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) }); }, { u: U, pw: PW });
  // 管理员创建的成员必须先完成首次改密；通过真实接口完成，再用新密码登录。
  const initialized = await up.evaluate(async ({ u, pw }) => {
    const me = await fetch("/api/v1/auth/me").then((response) => response.json());
    if (!me.mustChangePassword) throw new Error("新成员应要求修改初始密码");
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const newPassword = `${pw}-changed`;
    const changed = await fetch("/api/v1/auth/password/change", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ currentPassword: pw, newPassword }) });
    if (!changed.ok) throw new Error(`首次改密失败：${changed.status}`);
    const login = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: newPassword }) });
    const current = await fetch("/api/v1/auth/me").then((response) => response.json());
    return login.status === 200 && current.mustChangePassword === false;
  }, { u: U, pw: PW });
  check("部门成员完成首次改密并重新登录", initialized);
  await up.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await up.waitForTimeout(1800);
  const projectLinks = await up.locator("a.table-project").allTextContents();
  check("部门成员项目列表只显示部门项目", projectLinks.some((x) => x.includes("部门范围验收项目")) && !projectLinks.some((x) => x.includes("结项终验")), JSON.stringify(projectLinks));
  await up.goto(`${BASE}/projects/${projectId}`, { waitUntil: "domcontentloaded" }); await up.waitForTimeout(1200);
  check("部门成员可读项目概览", (await up.locator("main").innerText()).includes("部门范围验收项目"));
  await up.screenshot({ path: "/tmp/department-scope.png" });
  await userCtx.close();

  // 管理端角色页 DEPARTMENT 选项存在
  await page.goto(`${BASE}/admin/roles`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  await page.getByRole("tab", { name: "成员角色指派", exact: true }).click();
  const scopeTrigger = page.getByRole("button", { name: "数据范围类型", exact: true }).first();
  await scopeTrigger.waitFor();
  const hasTrigger = (await scopeTrigger.count()) > 0;
  if (hasTrigger) {
    await scopeTrigger.click();
    check("角色指派支持 DEPARTMENT（只读可见）范围", (await page.getByRole("option", { name: /DEPARTMENT/ }).count()) >= 1);
    await page.keyboard.press("Escape");
  } else {
    check("角色指派支持 DEPARTMENT（只读可见）范围", false, "找不到数据范围选择器");
  }
} finally {
  try {
    await sql`delete from audit_entry where action like 'department.%' or action like 'project.%' or action like 'role.%' or action like 'member.%'`;
    if (memberId) await sql`delete from audit_entry where actor_id = ${memberId} or target_id = ${memberId}`;
    if (memberId) await sql`delete from role_assignment where member_id = ${memberId}`;
    if (projectId) await sql`delete from project where id = ${projectId}`;
    if (deptId) await sql`delete from department where id = ${deptId}`;
    if (memberId) await sql`delete from member where id = ${memberId}`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await adminCtx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  部门数据范围验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
