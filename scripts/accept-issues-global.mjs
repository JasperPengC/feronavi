import "./_env.ts";
/**
 * 跨项目问题总览界面验收（Round 71 对标 YouQu P2）——真实浏览器。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByText("总登记", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByText("近 14 天缺陷趋势", { exact: true }).waitFor({ timeout: 15_000 });
  const body = await page.locator("main").innerText();
  check("侧栏「问题追踪」进入跨项目总览", body.includes("跨项目缺陷总览"));
  check("全局统计卡与趋势/严重度可见", ["总登记", "未完成", "未完成 S1", "近 14 天缺陷趋势", "严重度分布"].every((x) => body.includes(x)));
  check("项目筛选控件存在", (await page.locator('.page .toolbar [aria-label="按项目筛选"]').count()) === 1);
  const rowsBefore = await page.locator("main tbody tr").count();
  check("列表显示项目列", body.includes("项目") && rowsBefore >= 1, `rows=${rowsBefore}`);

  await page.locator('.page .toolbar [aria-label="按项目筛选"]').click();
  await page.getByRole("option", { name: /FINOK/ }).first().click();
  await page.waitForTimeout(1000);
  const filtered = await page.locator("main tbody tr").count();
  check("按项目筛选后仍有结果且不报错", filtered >= 1, `rows=${filtered}`);
  check("项目页问题视图仍可用", await (async () => {
    await page.goto(`${BASE}/projects/${pid}/issues`, { waitUntil: "domcontentloaded" });
    await page.getByText("总登记", { exact: true }).waitFor({ timeout: 15_000 });
    return (await page.locator("main").innerText()).includes("缺陷的登记、筛选与处理进展");
  })());
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/issues-global.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  跨项目问题总览验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
