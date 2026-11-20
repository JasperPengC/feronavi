import "./_env.ts";
/**
 * 邀请绑定项目角色界面验收（Round 25 长任务第 54 项）——可重复执行、自建自清。
 * 管理员界面邀请时选项目 + 项目角色 → 新账号接受后能在项目列表看到该项目。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-6);
const U = `projinv${stamp}`;
const EMAIL = `${U}@x.test`;
const PW = "projinv-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const [proj] = await sql`select key, name from project where id = ${pid}`;
const [role] = await sql`select id, name from role where key = 'PM'`;
const browser = await chromium.launch({ channel: "chrome" });
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctxA.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const pageA = await ctxA.newPage();
let memberId = null;
try {
  await pageA.goto(`${BASE}/login`); await pageA.waitForTimeout(600);
  await pageA.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await pageA.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2500);
  await pageA.getByRole("tab", { name: "邀请", exact: true }).click();
  await pageA.getByRole("button", { name: "邀请成员", exact: true }).click();
  await pageA.getByLabel("受邀人邮箱").fill(EMAIL);
  await pageA.getByRole("button", { name: "项目（可选）", exact: true }).click();
  await pageA.waitForTimeout(500);
  await pageA.getByRole("option", { name: new RegExp(`${proj.key} ${proj.name}`) }).click();
  await pageA.getByRole("button", { name: "项目角色（可选）", exact: true }).click();
  await pageA.waitForTimeout(500);
  await pageA.getByRole("option", { name: role.name, exact: true }).click();
  await pageA.getByRole("button", { name: "生成邀请链接" }).click();
  await pageA.waitForTimeout(1200);
  const link = (await pageA.getByTestId("invite-link").innerText()).trim();
  check("界面生成「项目 + 项目角色」邀请", /\/invite\//.test(link));

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await ctxB.newPage();
  await pageB.goto(link, { waitUntil: "domcontentloaded" }); await pageB.waitForTimeout(1000);
  await pageB.getByLabel(/用户名/).fill(U);
  await pageB.getByLabel(/显示姓名/).fill("项目受邀成员");
  await pageB.getByLabel(/密码/).fill(PW);
  await pageB.getByRole("button", { name: "接受邀请" }).click();
  await pageB.waitForTimeout(1600);
  const [m] = await sql`select id from member where username = ${U}`;
  memberId = m?.id ?? null;
  const [pm] = memberId ? await sql`select role_id from project_membership where project_id = ${pid} and member_id = ${memberId}` : [];
  check("受邀成员成为项目成员且角色为所选角色", pm?.role_id === role.id, JSON.stringify(pm));
  await pageB.getByRole("button", { name: "去登录" }).click(); await pageB.waitForTimeout(800);
  await pageB.getByLabel("用户名").fill(U);
  await pageB.getByLabel("密码").fill(PW);
  await pageB.getByRole("button", { name: "登录", exact: true }).click();
  await pageB.locator(".shell-header").waitFor();
  await pageB.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  const projectLink = pageB.getByRole("main").locator(`a[href="/projects/${pid}"]`).filter({ hasText: proj.name }).first();
  await projectLink.waitFor();
  const signedIn = await pageB.evaluate(async () => (await fetch("/api/v1/auth/me")).json());
  const listText = await pageB.getByRole("main").innerText();
  check("新账号项目列表包含该项目", signedIn.memberId === memberId && listText.includes(proj.name) && listText.includes(proj.key), pageB.url());
  await projectLink.click();
  await pageB.getByRole("heading", { name: proj.name, exact: true }).waitFor();
  check("受邀项目成员可进入对应项目概览", new URL(pageB.url()).pathname === `/projects/${pid}`);
  await ctxB.close();
  await pageA.screenshot({ path: "/tmp/project-invite.png" });
} finally {
  if (memberId) {
    try {
      await sql`delete from project_membership where member_id = ${memberId}`;
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from audit_entry where actor_id = ${memberId} or target_id = ${memberId}`;
      await sql`delete from activity_entry where actor_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    } catch (e) { console.error("[cleanup]", e.message); }
  }
  await sql`delete from invite where email = ${EMAIL}`;
  await sql.end();
  await ctxA.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  项目角色邀请验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
