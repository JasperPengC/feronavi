import "./_env.ts";
/**
 * 系统页运维状态验收（Round 25 长任务第 27 项）——只读。
 * 前置：本地 3000 服务 + demo 管理员（setting:manage）。
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
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/system`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const card = page.locator(".card", { hasText: "运维状态" });
  check("系统页出现「运维状态」卡", (await card.count()) === 1);
  // 仪表盘化后调度明细在可展开 details 中：先展开再核对（设计变更，非删信息）
  const sched = card.locator("summary", { hasText: "后台调度" });
  if (await sched.count()) await sched.click();
  const text = await card.innerText();
  check("展示 Webhook 投递计数", /端点/.test(text) && /待投递/.test(text) && /死信/.test(text));
  check("展示日志保留期（天）", /日志保留期/.test(text) && /审计/.test(text) && /活动/.test(text));
  check("展示平台计数（集成/开关/MCP）", /启用集成/.test(text) && /启用开关/.test(text) && /MCP 客户端/.test(text));
  check("展示后台调度间隔（含集成同步）", /后台调度/.test(text) && /(h|min|s)/.test(text) && text.includes("集成同步"));
  check("仪表盘 KPI 卡 4 张（服务/迁移/任务/死信）", (await page.locator(".sys-kpi-grid .metric-card").count()) === 4, String(await page.locator(".sys-kpi-grid .metric-card").count()));
  check("异常置顶/全绿横幅可见", (await page.locator(".sys-all-ok, .sys-alert-stack").count()) === 1);
  check("运维状态按主题分组（Webhook/任务/留存/平台）", (await card.locator(".sys-group").count()) >= 4, String(await card.locator(".sys-group").count()));
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/system-ops.png" });
  await page.screenshot({ path: "/tmp/system-dashboard.png", fullPage: false });
} finally {
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  系统页运维状态验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
