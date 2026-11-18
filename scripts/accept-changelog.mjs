import "./_env.ts";
/**
 * 平台更新日志验收：记录的是 Feronavi 产品自身版本，不是各项目的 release.notes。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/changelog`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(700);

  const body = await page.locator("main").innerText();
  check("页面是平台更新日志", (await page.locator("h1").innerText()).includes("平台更新日志"));
  check("明确区分平台版本与项目发布", body.includes("项目发布说明") && body.includes("平台版本"));
  const entries = page.locator(".cl-item");
  const count = await entries.count();
  check("展示平台版本时间线（≥5 条）", count >= 5, String(count));
  const versions = await page.locator(".cl-version").allInnerTexts();
  check("版本按从新到旧排列", versions[0] === "v6.18" && versions.includes("v6.17"), versions.join(","));
  const dates = await page.locator(".cl-date").allInnerTexts();
  check("日期倒序", dates.every((d, i) => i === 0 || d <= dates[i - 1]), dates.slice(0, 3).join(","));
  check("内容包含真实产品更新要点", body.includes("看板") && body.includes("权限") && body.includes("工作项"));
  check("不混入项目发布说明/项目筛选", !body.includes("FINOK") && !body.includes("全部项目") && !body.includes("验收说明"));
  check("平台更新不可在页面直接编辑", (await page.getByRole("button", { name: "编辑", exact: true }).count()) === 0);
  await page.screenshot({ path: "/tmp/changelog-platform.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  平台更新日志验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
