import "./_env.ts";
/**
 * 功能开关设置界面验收（Round 25 长任务第 23 项）——可重复执行、自建自删。
 * 前置：本地 3000 服务 + demo 管理员（setting:manage）。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const KEY = `ui.accept.${stamp}`;
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
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const section = page.locator(".settings-section", { hasText: "功能开关" });
  await section.scrollIntoViewIfNeeded();
  check("设置页出现「功能开关」区块", (await section.count()) === 1);
  check("区块如实说明当前无内置消费者", (await section.innerText()).includes("没有内置业务消费者"));
  await section.getByLabel("开关 key").fill(KEY);
  await section.getByRole("button", { name: "添加开关" }).click();
  await page.waitForTimeout(1300);
  const row = section.locator(".settings-record-list li", { hasText: KEY });
  check("添加后列表出现该开关且默认启用", (await row.count()) === 1 && (await row.innerText()).includes("已启用"));
  await row.getByRole("button", { name: "停用" }).click();
  await page.waitForTimeout(1100);
  check("可停用开关", (await row.innerText()).includes("已停用"));
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  const section2 = page.locator(".settings-section", { hasText: "功能开关" });
  const row2 = section2.locator(".settings-record-list li", { hasText: KEY });
  check("刷新后状态持久化（已停用）", (await row2.count()) === 1 && (await row2.innerText()).includes("已停用"));
  await row2.getByRole("button", { name: "启用" }).click();
  await page.waitForTimeout(1000);
  check("可再次启用", (await row2.innerText()).includes("已启用"));
  await section2.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/feature-flags.png" });
} finally {
  await sql`delete from feature_flag where key = ${KEY}`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  功能开关设置验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
