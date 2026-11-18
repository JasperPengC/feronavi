import "./_env.ts";
/**
 * 洞察页仪表盘验收（Round 25）：单一仪表盘 + 六类挂件真实渲染
 *
 * 覆盖点：
 *   ① 页面上**只有一个**仪表盘面板（此前重复两套：一套能渲染、一套写「尚未实现」）；
 *   ② 六类挂件（燃尽 / 累积流 / 数字 / 占比饼图 / 列表 / 活动热力）都用**真实聚合数据**渲染；
 *   ③ 六个 widget-data 接口全部 200；
 *   ④ 页面不再出现「尚未实现」占位；
 *   ⑤ 验收用的仪表盘跑完即删（用唯一名称，不污染真实数据）。
 *
 * 用法：`node scripts/accept-insight-dashboard.mjs`（HOST 默认 http://127.0.0.1:3000）
 */
import { chromium } from "playwright";
const HOST = process.env.BASE;
const b = await chromium.launch({ channel: "chrome" });
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };

async function makeCtx(theme) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: theme === "dark" ? "dark" : "light" });
  await ctx.addCookies([{ name: "feronavi_theme", value: theme, domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(HOST + "/login"); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  return { ctx, page };
}
const put = (page, prefs) => page.evaluate(async (p) => {
  const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1];
  await fetch("/api/v1/me/preferences", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf || "") }, body: JSON.stringify(p) });
}, prefs);

// 1) 准备数据：登录 → 建仪表盘 + 6 个挂件（绑定迭代）
const { page } = await makeCtx("light");
const setup = await page.evaluate(async () => {
  const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
  const j = (r) => r.json();
  const projects = await fetch("/api/v1/projects").then(j);
  const pid = projects.items[0].id;
  const iters = await fetch(`/api/v1/projects/${pid}/iterations`).then(j);
  const iterationId = (iters[0] || iters.items?.[0] || {}).id ?? "";
  const name = `验收洞察-${Date.now()}`;
  const d = await fetch("/api/v1/dashboards", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ name, projectId: pid }) }).then(j);
  const types = ["BURNDOWN", "CUMULATIVE_FLOW", "COUNT", "PIE", "LIST", "ACTIVITY_HEATMAP"];
  for (const t of types) {
    await fetch(`/api/v1/dashboards/${d.id}/widgets`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ type: t, config: { iterationId } }) });
  }
  return { pid, iterationId, dashId: d.id, name };
});
console.log("  准备数据:", JSON.stringify(setup));
const { page: p } = { page };
const dataRes = [];
p.on("response", (r) => { if (r.url().includes("/widgets/") && r.url().endsWith("/data")) dataRes.push(r.status()); });

// 2) 打开洞察页并选择新仪表盘
await p.goto(`${HOST}/projects/${setup.pid}/insights`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
await p.getByRole("button", { name: setup.name, exact: true }).click();
await p.waitForTimeout(2500);

check("仪表盘面板只有一个", await p.locator("section.panel", { hasText: "把关心的指标拼成一屏" }).count() === 1);
check("页面不再出现「尚未实现」占位", await p.getByText(/尚未实现/).count() === 0);
const cards = p.locator(".widget-card");
check("六个挂件都出现", await cards.count() === 6, `count=${await cards.count()}`);
check("六个挂件数据接口全部 200", dataRes.length >= 6 && dataRes.every((s) => s === 200), JSON.stringify(dataRes));
const cardTexts = await cards.allTextContents();
check("COUNT 渲染真实总数", /\d+/.test(cardTexts[2] || ""), (cardTexts[2] || "").slice(0, 60));
check("PIE 渲染分组标签", (cardTexts[3] || "").includes("按优先级分组"), (cardTexts[3] || "").slice(0, 60));
check("LIST 渲染行", await p.locator(".widget-card .row-title").count() > 0);
check("HEATMAP 渲染日期格", await p.locator(".widget-card [aria-label*='·']").count() > 0);
check("BURNDOWN 图表渲染", await p.locator('svg[aria-label^="燃尽图"]').count() > 0);
check("CUMULATIVE_FLOW 图表渲染", await p.locator('svg[aria-label^="累积流图"]').count() > 0);
await p.screenshot({ path: "/tmp/insight-dash-light.png" });

// 3) 深色截图
await put(p, { theme: "dark", locale: "zh-CN", timezone: "Asia/Shanghai", density: "comfortable" });
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(2600);
await p.getByRole("button", { name: setup.name, exact: true }).click();
await p.waitForTimeout(2200);
await p.screenshot({ path: "/tmp/insight-dash-dark.png" });
await put(p, { theme: "system", locale: "zh-CN", timezone: "Asia/Shanghai", density: "comfortable" });

// 4) 清理：删除验收仪表盘
const cleanup = await p.evaluate(async (dashId) => {
  const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
  const del = await fetch(`/api/v1/dashboards/${dashId}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
  const after = await fetch(`/api/v1/dashboards/${dashId}`, { credentials: "same-origin" });
  return { del: del.status, get: after.status };
}, setup.dashId);
check("验收仪表盘已清理", cleanup.del === 204 || cleanup.del === 200, JSON.stringify(cleanup));
const ok = results.filter(Boolean).length;
console.log(`\n  洞察仪表盘验收 ${ok}/${results.length}`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
