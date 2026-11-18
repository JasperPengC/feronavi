import "./_env.ts";
/**
 * 项目概览页界面验收（Round 62 · 对标 YouQu P0）——可重复执行。
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
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  const link = page.locator(`a.table-project[href="/projects/${pid}"]`).first();
  check("项目列表行主链接指向概览页", (await link.count()) === 1);
  await link.click();
  await page.getByText("项目信息", { exact: true }).waitFor({ timeout: 15_000 });
  check("跳转到 /projects/:id 概览", page.url().endsWith(`/projects/${pid}`), page.url());
  const body = await page.locator("main").innerText();
  check("显示项目名称与「概览」页签", body.includes("结项终验") && body.includes("概览"));
  check("显示项目信息四卡（工作项/未完成/里程碑/成员）", body.includes("工作项") && body.includes("未完成") && body.includes("里程碑") && body.includes("成员"));
  check("显示项目信息与最近活动区块", body.includes("项目信息") && body.includes("最近活动"));
  check("显示项目成员区块", body.includes("项目成员") && body.includes("演示管理员"));
  await page.screenshot({ path: "/tmp/project-overview.png" });
  // 看板入口仍可用
  await page.getByRole("link", { name: "看板", exact: true }).first().click();
  await page.waitForTimeout(1800);
  check("页签可跳转看板", page.url().includes(`/projects/${pid}/board`), page.url());
} finally {
  await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  项目概览页验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
