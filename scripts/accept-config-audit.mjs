import "./_env.ts";
/**
 * 配置类动作审计的界面验收（Round 25 长任务第 30 项）——可重复执行、自建自删。
 * 真实创建项目集/Webhook → 审计页能按动作检索到记录。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-5);
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let portfolioId = null, endpointId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ stamp, pid }) => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf() };
    const pf = await fetch("/api/v1/portfolios", { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ name: `审计验收项目集 ${stamp}` }) }).then((r) => r.json());
    await fetch(`/api/v1/portfolios/${pf.id}`, { method: "PATCH", credentials: "same-origin", headers: h, body: JSON.stringify({ name: `审计验收项目集 ${stamp}（改）` }) });
    await fetch(`/api/v1/portfolios/${pf.id}/projects`, { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ projectId: pid }) });
    const ep = await fetch("/api/v1/webhooks", { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ name: `审计验收端点 ${stamp}`, url: "https://example.com/hook", events: ["work_item.created"] }) }).then((r) => r.json());
    return { portfolioId: pf.id, endpointId: ep.endpoint?.id };
  }, { stamp, pid });
  portfolioId = prep.portfolioId; endpointId = prep.endpointId;
  check("真实创建项目集与 Webhook", !!portfolioId && !!endpointId, JSON.stringify(prep));

  await page.goto(`${BASE}/admin/audit`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
  const search = page.getByLabel("搜索动作（如 auth.login）…");
  await search.fill("portfolio."); await page.waitForTimeout(1200);
  const actions = await page.locator(".audit-table .audit-operation .table-primary").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")));
  check("审计页可按 portfolio. 检索到创建/更新/加项目", ["portfolio.created", "portfolio.updated", "portfolio.project_added"].every((a) => actions.includes(a)), JSON.stringify(actions.slice(0, 5)));
  await search.fill("webhook."); await page.waitForTimeout(1200);
  const whActions = await page.locator(".audit-table .audit-operation .table-primary").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")));
  check("审计页可按 webhook. 检索到创建", whActions.includes("webhook.created"), JSON.stringify(whActions.slice(0, 5)));
  await page.screenshot({ path: "/tmp/config-audit.png" });
} finally {
  if (portfolioId || endpointId) {
    await page.evaluate(async ({ portfolioId, endpointId }) => {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
      if (portfolioId) await fetch(`/api/v1/portfolios/${portfolioId}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
      if (endpointId) await fetch(`/api/v1/webhooks/${endpointId}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
    }, { portfolioId, endpointId }).catch(() => {});
  }
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  配置类审计界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
