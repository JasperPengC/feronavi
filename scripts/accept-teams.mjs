import "./_env.ts";
/**
 * 团队界面验收（Round 25 长任务第 44 项）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const ROOT = `验收团队 ${stamp}`;
const CHILD = `验收子团队 ${stamp}`;
const RENAMED = `验收子团队 ${stamp}（改）`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  await page.getByRole("tab", { name: "团队", exact: true }).click();
  check("成员页出现「团队」面板", (await page.getByText("团队", { exact: true }).count()) > 0);

  await page.getByRole("tab", { name: "团队", exact: true }).click();

  // 建根团队
  await page.getByRole("button", { name: "新建团队", exact: true }).click();
  await page.getByLabel("团队名称").fill(ROOT);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1300);
  check("新建根团队后出现在树中", (await page.getByText(ROOT, { exact: true }).count()) === 1);

  // 建子团队
  const rootRow = page.locator(`.team-row[data-team-name="${ROOT}"]`);
  await rootRow.getByRole("button", { name: "添加子团队" }).click();
  await page.getByLabel("团队名称").fill(CHILD);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1300);
  check("子团队出现在树中", (await page.getByText(CHILD, { exact: true }).count()) === 1);

  // 改名
  const childRow = page.locator(`.team-row[data-team-name="${CHILD}"]`);
  await childRow.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("团队名称").fill(RENAMED);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(1200);
  check("改名生效", (await page.getByText(RENAMED, { exact: true }).count()) === 1);

  // 查看成员（空态）
  await page.locator(`.team-row[data-team-name="${RENAMED}"]`).getByRole("button", { name: "查看成员" }).click();
  await page.waitForTimeout(900);
  check("成员抽屉显示空态", (await page.getByText("该团队（含子团队）暂无成员。").count()) === 1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);

  // 删除子团队 → 根团队
  await page.locator(`.team-row[data-team-name="${RENAMED}"]`).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForTimeout(1100);
  check("子团队已删除", (await page.getByText(RENAMED, { exact: true }).count()) === 0);
  await page.locator(`.team-row[data-team-name="${ROOT}"]`).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForTimeout(1100);
  check("根团队已删除", (await page.getByText(ROOT, { exact: true }).count()) === 0);
  check("真实库无残留", (await sql`select count(*)::int as n from team where name like ${"验收团队 %" + stamp}`)[0].n === 0
    && (await sql`select count(*)::int as n from team where name like ${"验收子团队 %" + stamp + "%"}`)[0].n === 0);
  await page.screenshot({ path: "/tmp/teams-panel.png" });
} finally {
  await sql`delete from team where name like ${"验收团队%" + stamp} or name like ${"验收子团队%" + stamp + "%"}`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  团队界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
