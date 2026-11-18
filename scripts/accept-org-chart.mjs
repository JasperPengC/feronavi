import "./_env.ts";
/**
 * 交互式组织架构图界面验收（Round 78）——真实浏览器，自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const ROOT = `研发部${STAMP}`;
const CHILD = `平台组${STAMP}`;
const GRAND = `基础设施组${STAMP}`;
const POS = `架构师${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let deptIds = [];
let tempMemberId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ root, child, grand, pos }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const r = await (await fetch("/api/v1/departments", { method: "POST", headers, body: JSON.stringify({ name: root }) })).json();
    const c = await (await fetch("/api/v1/departments", { method: "POST", headers, body: JSON.stringify({ name: child, parentId: r.id }) })).json();
    const g = await (await fetch("/api/v1/departments", { method: "POST", headers, body: JSON.stringify({ name: grand, parentId: c.id }) })).json();
    const p = await (await fetch("/api/v1/positions", { method: "POST", headers, body: JSON.stringify({ name: pos, departmentId: c.id }) })).json();
    const me = await (await fetch("/api/v1/auth/me")).json();
    await fetch(`/api/v1/members/${me.memberId}/organization`, { method: "PATCH", headers, body: JSON.stringify({ departmentId: c.id, positionId: p.id }) });
    return { ids: [r.id, c.id, g.id], me: me.memberId, posId: p.id };
  }, { root: ROOT, child: CHILD, grand: GRAND, pos: POS });
  deptIds = prep.ids;
  check("真实创建三级部门 + 职位 + demo 归属", deptIds.length === 3 && deptIds.every(Boolean));

  await page.goto(`${BASE}/admin/organization`, { waitUntil: "domcontentloaded" });
  await page.locator(".org-chart-tree").waitFor({ timeout: 15_000 });
  check("默认展示架构图视图", (await page.locator(".org-chart-tree").count()) === 1);
  const treeText = await page.locator(".org-chart").innerText();
  check("三级部门都出现在树中", treeText.includes(ROOT) && treeText.includes(CHILD) && treeText.includes(GRAND));
  check("统计显示部门/成员/职位/层级", treeText.includes("部门") && treeText.includes("成员") && treeText.includes("职位") && treeText.includes("层级"));

  // 折叠根部门 → 子/孙隐藏；展开恢复
  await page.locator(".org-chart-node", { hasText: ROOT }).getByRole("button", { name: "收起", exact: true }).click();
  await page.waitForTimeout(500);
  check("折叠根部门后子部门隐藏", !(await page.locator(".org-chart").innerText()).includes(CHILD));
  await page.locator(".org-chart-node", { hasText: ROOT }).getByRole("button", { name: "展开", exact: true }).click();
  await page.waitForTimeout(400);
  check("展开后子部门恢复", (await page.locator(".org-chart").innerText()).includes(CHILD));

  // 搜索成员名（demo 管理员）→ 祖先链保留
  await page.getByLabel("搜索部门或成员").fill("演示管理员");
  await page.waitForTimeout(500);
  const searchText = await page.locator(".org-chart").innerText();
  check("搜索成员保留祖先链（不含无关子部门）", searchText.includes(ROOT) && searchText.includes(CHILD) && !searchText.includes(GRAND), searchText.slice(0, 80));
  await page.getByLabel("搜索部门或成员").fill("不存在的部门zzz");
  await page.waitForTimeout(400);
  check("无匹配时显示空态提示", (await page.locator(".org-chart").innerText()).includes("没有匹配"));
  await page.getByLabel("搜索部门或成员").fill("");
  await page.waitForTimeout(300);

  // 点击部门节点 → 右侧直属成员/职位
  await page.locator(".org-chart-node", { hasText: CHILD }).click();
  await page.waitForTimeout(500);
  const detail = await page.locator(".org-chart-detail").innerText();
  check("点击节点显示直属成员与职位", detail.includes("演示管理员") && detail.includes(POS));
  await page.screenshot({ path: "/tmp/org-chart.png" });
} finally {
  try {
    if (tempMemberId) {
      await sql`delete from audit_entry where actor_id = ${tempMemberId}`;
      await sql`delete from member where id = ${tempMemberId}`;
    }
    await sql`update member set department_id = null, position_id = null where username = 'demo'`;
    if (deptIds.length) await sql`delete from position where department_id in ${sql(deptIds)}`;
    if (deptIds[2]) await sql`delete from department where id = ${deptIds[2]}`;
    if (deptIds[1]) await sql`delete from department where id = ${deptIds[1]}`;
    if (deptIds[0]) await sql`delete from department where id = ${deptIds[0]}`;
    await sql`delete from audit_entry where action like 'department.%' or action like 'position.%' or action = 'member.organization_updated'`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  组织架构图验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
