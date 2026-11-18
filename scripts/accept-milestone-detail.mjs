import "./_env.ts";
/**
 * 里程碑详情界面验收（Round 62 对标 P1）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const SUMMARY = `验收进展 ${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let msId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/projects/${pid}/milestones`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  const link = page.locator('a.row-name[href*="/milestones/"]').first();
  check("里程碑列表行名称指向详情页", (await link.count()) === 1);
  await link.click();
  await page.getByText("进展记录", { exact: false }).first().waitFor({ timeout: 15_000 });
  const url = page.url();
  msId = /milestones\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null;
  check("进入 /milestones/:id 详情", !!msId, url);
  const body = await page.locator("main").innerText();
  check("显示基本信息/进展记录/关联工作项/参与人", body.includes("基本信息") && body.includes("进展记录") && body.includes("关联工作项") && body.includes("参与人"));

  await page.getByRole("button", { name: "记录进展", exact: true }).click();
  await page.getByLabel("本阶段进展").fill(SUMMARY);
  await page.getByLabel("下一步计划").fill("继续验收");
  await page.getByLabel("阻塞项 / 风险").fill("等待部署窗口");
  await page.getByRole("button", { name: "保存进展" }).click();
  await page.waitForTimeout(1400);
  check("保存后进展可见", (await page.locator("main").innerText()).includes(SUMMARY));
  const [row] = await sql`select count(*)::int as n from milestone_progress_update where milestone_id = ${msId} and summary = ${SUMMARY}`;
  check("真实库写入进展记录", row.n === 1);

  await page.screenshot({ path: "/tmp/milestone-detail.png" });
  const li = page.locator(".md-timeline > li", { hasText: SUMMARY });
  await li.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForTimeout(1200);
  check("删除后进展消失", !(await page.locator("main").innerText()).includes(SUMMARY));
} finally {
  if (msId) {
    try {
      await sql`delete from milestone_progress_update where milestone_id = ${msId}`;
      await sql`delete from activity_entry where target_type = 'MILESTONE' and target_id = ${msId} and action = 'milestone.progress_added'`;
    } catch (e) { console.error("[cleanup]", e.message); }
  }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  里程碑详情页验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
