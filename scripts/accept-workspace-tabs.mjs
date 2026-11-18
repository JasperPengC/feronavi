import "./_env.ts";
/**
 * 工作区页签界面验收（Round 69 对标 YouQu P2）——真实浏览器。
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
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const tabbar = page.locator(".shell-tabbar");
  check("工作区显示页签条与固定首页", (await tabbar.count()) === 1 && (await tabbar.innerText()).includes("总览"));
  const homeClose = page.locator('.shell-tab[data-active="true"] .shell-tab-close');
  check("首页页签不可关闭", (await homeClose.count()) === 0);

  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const labels = (await tabbar.innerText()).replace(/\s+/g, " ");
  check("访问后自动累积三个页签", (await page.locator(".shell-tab").count()) === 3 && labels.includes("项目") && labels.includes("成员"), labels);
  check("当前页签高亮", (await page.locator('.shell-tab[data-active="true"]').innerText()).includes("成员"));

  await page.locator(".shell-tab-link", { hasText: "项目" }).first().click();
  await page.waitForTimeout(800);
  check("点击页签可回到对应页面", page.url().endsWith("/projects"), page.url());
  await page.locator('.shell-tab[data-active="true"] .shell-tab-close').click();
  await page.waitForTimeout(1000);
  check("关闭当前页签后跳到相邻页", page.url().endsWith("/workbench") || page.url().endsWith("/members"), page.url());
  check("关闭后页签减少", (await page.locator(".shell-tab").count()) <= 2);

  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  check("刷新后页签仍保留（sessionStorage）", (await page.locator(".shell-tab").count()) >= 2, String(await page.locator(".shell-tab").count()));
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/workspace-tabs.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  工作区页签验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
