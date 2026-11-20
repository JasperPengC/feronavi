import "./_env.ts";
/**
 * 问题追踪界面验收（Round 64 对标 P1）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const TITLE = `验收问题 ${STAMP}`;
const SUMMARY = `验收处理进展 ${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let createdId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/projects/${pid}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByText("总登记", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "展开趋势与分布", exact: true }).click();
  await page.getByText("近 14 天缺陷趋势", { exact: true }).waitFor({ timeout: 15_000 });
  const body = await page.locator("main").innerText();
  check("问题追踪页含统计卡（总登记/未完成/S1/逾期/处理率）", ["总登记", "未完成", "未完成 S1", "已逾期", "处理率"].every((x) => body.includes(x)));
  check("状态页签齐全", ["全部", "未完成", "已解决", "已取消"].every((x) => body.includes(x)));
  const insights = page.getByRole("dialog", { name: "问题概览", exact: true });
  check("近 14 天趋势与严重度分布可见", (await insights.innerText()).includes("近 14 天缺陷趋势") && (await insights.innerText()).includes("严重度分布")
    && (await page.locator(".issues-trend-day").count()) === 14
    && (await page.locator(".issues-severity li").count()) >= 4);
  await insights.getByRole("button", { name: "关闭", exact: true }).click();
  await insights.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "登记问题", exact: true }).click();
  const createDrawer = page.locator(".ui-drawer");
  await createDrawer.getByRole("textbox", { name: "标题", exact: true }).fill(TITLE);
  await createDrawer.getByRole("textbox", { name: "描述（选填）", exact: true }).fill("浏览器验收创建");
  await createDrawer.getByRole("button", { name: "严重度", exact: true }).click();
  await page.getByRole("option", { name: "S1", exact: true }).click();
  await createDrawer.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForTimeout(1500);
  check("界面登记问题后列表出现该行", (await page.locator("main").innerText()).includes(TITLE));
  const [created] = await sql`select id, type from work_item where project_id = ${pid} and title = ${TITLE}`;
  createdId = created?.id ?? null;
  check("问题真实写入 work_item 且 type=DEFECT", !!createdId && created.type === "DEFECT");

  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("button", { name: "严重度", exact: true }).click();
  await page.getByRole("option", { name: "S1", exact: true }).click();
  await page.waitForTimeout(1000);
  check("按 S1 筛选后仍包含新建问题", (await page.locator("main").innerText()).includes(TITLE));
  await page.getByRole("button", { name: "严重度", exact: true }).click();
  await page.getByRole("option", { name: "严重度", exact: true }).click();
  await page.waitForTimeout(800);

  await page.getByText(TITLE, { exact: true }).click();
  const detailDrawer = page.locator(".ui-drawer");
  await detailDrawer.getByText("处理进展", { exact: true }).waitFor({ timeout: 10_000 });
  check("点击行打开工作项抽屉且缺陷显示「处理进展」", (await detailDrawer.innerText()).includes("处理进展"));
  await detailDrawer.getByRole("button", { name: "记录进展", exact: true }).click();
  await detailDrawer.getByLabel("本阶段进展").fill(SUMMARY);
  await detailDrawer.getByLabel("下一步计划").fill("继续修复");
  await detailDrawer.getByLabel("阻塞项 / 风险").fill("等待复现");
  await detailDrawer.getByRole("button", { name: "保存进展" }).click();
  await page.waitForTimeout(1300);
  check("抽屉内保存处理进展后可见", (await detailDrawer.innerText()).includes(SUMMARY));
  const [upd] = await sql`select count(*)::int as n from work_item_progress_update where work_item_id = ${createdId} and summary = ${SUMMARY}`;
  check("处理进展真实写入库", upd.n === 1);
  await page.screenshot({ path: "/tmp/issues-page.png" });
  await detailDrawer.locator(".wi-drawer__progress .md-timeline li").filter({ hasText: SUMMARY }).getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForTimeout(1000);
  check("删除后处理进展消失", !(await detailDrawer.innerText()).includes(SUMMARY));
  const [removed] = await sql`select count(*)::int as n from work_item_progress_update where work_item_id = ${createdId} and summary = ${SUMMARY}`;
  check("删除进展同步写回数据库", removed.n === 0);
} finally {
  if (createdId) {
    try {
      await sql`delete from work_item_progress_update where work_item_id = ${createdId}`;
      await sql`delete from activity_entry where target_id = ${createdId}`;
      await sql`delete from audit_entry where target_id = ${createdId}`;
      await sql`delete from work_item_link where source_id = ${createdId} or target_id = ${createdId}`;
      await sql`delete from work_item where id = ${createdId}`;
    } catch (e) { console.error("[cleanup]", e.message); }
  }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  问题追踪页验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
