import "./_env.ts";
/**
 * 项目成员管理界面验收（Round 25 长任务第 55 项）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-6);
const U = `pmui${stamp}`;
const NAME = `项目成员验收 ${stamp}`;
const PW = "pmui-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const [proj] = await sql`select key, name from project where id = ${pid}`;
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let memberId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const created = await page.evaluate(async ({ u, name, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const r = await fetch("/api/v1/members", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ username: u, name, email: `${u}@x.test`, password: pw }),
    });
    return { status: r.status, body: await r.json() };
  }, { u: U, name: NAME, pw: PW });
  memberId = created.body?.id ?? null;
  check("真实创建临时成员", created.status === 201 && !!memberId);
  const currentMembers = await page.evaluate(async (projectId) => {
    const response = await fetch(`/api/v1/projects/${projectId}/members`);
    if (!response.ok) throw new Error(`读取项目成员失败：${response.status}`);
    return (await response.json()).members;
  }, pid);

  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  await page.getByRole("button", { name: `项目成员 ${proj.name}` }).click();
  await page.waitForTimeout(1000);
  const drawer = page.locator(".project-members");
  await drawer.waitFor();
  const currentList = drawer.locator(".project-member-list li");
  await currentList.first().waitFor();
  check("打开项目成员抽屉并完整列出当前成员", currentMembers.length > 0 && await currentList.count() === currentMembers.length
    && (await Promise.all(currentMembers.map((member) => currentList.filter({ hasText: `@${member.username}` }).count()))).every((count) => count === 1));

  await page.getByRole("button", { name: "成员", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("option", { name: new RegExp(NAME) }).click();
  // 多角色 UI：角色是 chips，不再是下拉
  await page.getByRole("button", { name: "项目角色：成员", exact: true }).click();
  await page.getByRole("button", { name: "加入项目" }).click();
  await page.waitForTimeout(1300);
  check("加入后列表出现该成员", (await drawer.innerText()).includes(NAME));
  const [pm] = memberId ? await sql`select pm.role_id, r.key from project_membership pm join role r on r.id = pm.role_id where pm.project_id = ${pid} and pm.member_id = ${memberId}` : [];
  check("真实库写入所选 MEMBER 项目角色", pm?.key === "MEMBER", JSON.stringify(pm));

  await drawer.locator("li", { hasText: NAME }).getByRole("button", { name: "移除" }).click();
  await page.waitForTimeout(1200);
  check("移除后列表不再包含", !(await drawer.innerText()).includes(NAME));
  const [left] = memberId ? await sql`select count(*)::int as n from project_membership where project_id = ${pid} and member_id = ${memberId}` : [{ n: 0 }];
  check("真实库已清理 membership", left.n === 0);
  await page.screenshot({ path: "/tmp/project-members-drawer.png" });
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
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  项目成员管理验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
