import "./_env.ts";
/**
 * 组织架构界面验收（Round 66 对标 YouQu 部门/职位 P1）——真实浏览器，自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const DEPT = `验收部门${STAMP}`;
const CHILD = `验收小组${STAMP}`;
const POS = `验收职位${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
const drawer = page.locator(".ui-drawer");
const departmentDialog = page.getByRole("dialog", { name: "新建部门", exact: true });
const positionDialog = page.getByRole("dialog", { name: "新建职位", exact: true });
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const me = await page.evaluate(async () => (await fetch("/api/v1/auth/me")).json());
  const [{ email: actorEmail }] = await sql`select email from member where id = ${me.memberId}`;
  await page.goto(`${BASE}/admin/organization`, { waitUntil: "domcontentloaded" });
  const tree = page.getByRole("tree", { name: "部门", exact: true });
  await tree.waitFor({ timeout: 15_000 });
  check("侧栏/页面可进入组织架构", (await page.locator(".page").innerText()).includes("部门树与职位") || (await page.locator(".page").innerText()).includes("部门"));

  await page.getByRole("button", { name: "新建部门", exact: true }).click();
  await departmentDialog.getByLabel("名称", { exact: true }).fill(DEPT);
  await departmentDialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1000);
  check("新建顶级部门后树中出现", (await page.locator(".page").innerText()).includes(DEPT));

  const rootNode = tree.getByRole("treeitem").filter({ has: page.locator(".ui-tree-label", { hasText: DEPT }) });
  await rootNode.locator(":scope > .ui-tree-row").click();
  await page.getByRole("button", { name: "加子部门", exact: true }).click();
  await departmentDialog.getByLabel("名称", { exact: true }).fill(CHILD);
  await departmentDialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1000);
  await rootNode.locator(":scope > .ui-tree-row").getByRole("button", { name: "展开", exact: true }).click();
  const childNode = tree.locator('[role="treeitem"][aria-level="2"]', { hasText: CHILD });
  check("新建子部门后树中出现且为第二级", await childNode.isVisible());
  await childNode.locator(":scope > .ui-tree-row").click();

  await page.getByRole("tab", { name: /^职位 / }).click();
  await page.getByRole("button", { name: "新建职位", exact: true }).click();
  await positionDialog.getByLabel("名称", { exact: true }).fill(POS);
  await positionDialog.getByRole("button", { name: "所属部门", exact: true }).click();
  await page.getByRole("option", { name: CHILD, exact: true }).click();
  await positionDialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1000);
  check("新建职位后右侧出现且显示所属部门", (await page.locator(".page").innerText()).includes(POS) && (await page.locator(".page").innerText()).includes(CHILD));
  await page.screenshot({ path: "/tmp/organization-page.png" });

  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);
  const row = page.locator(".members-table tbody tr").filter({ has: page.getByText(actorEmail, { exact: true }) });
  await row.getByRole("button", { name: "归属", exact: true }).click();
  await drawer.getByRole("button", { name: "所属部门", exact: true }).click();
  await page.getByRole("option", { name: CHILD, exact: true }).click();
  await drawer.getByRole("button", { name: "职位", exact: true }).click();
  await page.getByRole("option", { name: POS, exact: true }).click();
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1200);
  check("成员归属保存后行内显示部门·职位", (await row.innerText()).includes(CHILD) && (await row.innerText()).includes(POS));
  await page.screenshot({ path: "/tmp/organization.png" });
  const [m] = await sql`select department_id, position_id from member where username = 'demo'`;
  check("成员归属真实写入库", !!m?.department_id && !!m?.position_id);
  const [d] = await sql`select id from department where name = ${CHILD}`;
  check("子部门真实写入库", !!d?.id);
} finally {
  try {
    await sql`update member set department_id = null, position_id = null where username = 'demo'`;
    await sql`delete from position where name = ${POS}`;
    await sql`delete from department where name in (${CHILD}, ${DEPT})`;
    await sql`delete from audit_entry where action like 'department.%' or action like 'position.%' or action = 'member.organization_updated'`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  组织架构验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
