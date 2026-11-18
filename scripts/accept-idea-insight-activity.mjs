import "./_env.ts";
/**
 * 想法与洞察看板活动的界面验收（Round 25 长任务第 33 项）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-5);
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let ideaId = null, dashboardId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ pid, stamp }) => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf() };
    const i = await fetch(`/api/v1/projects/${pid}/ideas`, { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ title: `想法活动验收 ${stamp}`, description: "x" }) }).then((r) => r.json());
    await fetch(`/api/v1/ideas/${i.id}`, { method: "PATCH", credentials: "same-origin", headers: h, body: JSON.stringify({ status: "UNDER_REVIEW" }) });
    const d = await fetch("/api/v1/dashboards", { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ name: `洞察活动验收 ${stamp}`, projectId: pid }) }).then((r) => r.json());
    const w = await fetch(`/api/v1/dashboards/${d.id}/widgets`, { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ type: "COUNT", config: {} }) }).then((r) => r.json());
    await fetch(`/api/v1/dashboard-widgets/${w.id}`, { method: "PATCH", credentials: "same-origin", headers: h, body: JSON.stringify({ sortOrder: 2 }) });
    return { ideaId: i.id, dashboardId: d.id, widgetId: w.id };
  }, { pid, stamp });
  ideaId = prep.ideaId; dashboardId = prep.dashboardId;
  check("真实创建想法（含更新）与项目看板/挂件", !!ideaId && !!dashboardId && !!prep.widgetId, JSON.stringify(prep));

  await page.goto(`${BASE}/projects/${pid}/activity`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "想法", exact: true }).click();
  await page.waitForTimeout(1100);
  const ideaSummaries = await page.locator(".activity-summary").allTextContents();
  check("「想法」筛选出现创建与更新事件",
    ideaSummaries.some((s) => s.includes("提交了想法") && s.includes(stamp)) && ideaSummaries.some((s) => s.includes("更新了想法")),
    ideaSummaries.slice(0, 3).join(" | "));
  await page.getByRole("button", { name: "洞察", exact: true }).click();
  await page.waitForTimeout(1100);
  const insightSummaries = await page.locator(".activity-summary").allTextContents();
  check("「洞察」筛选出现看板与挂件事件",
    insightSummaries.some((s) => s.includes("创建了洞察看板") && s.includes(stamp))
    && insightSummaries.some((s) => s.includes("添加了挂件")) && insightSummaries.some((s) => s.includes("更新了看板") && s.includes("挂件")),
    insightSummaries.slice(0, 4).join(" | "));
  await page.screenshot({ path: "/tmp/idea-insight-activity.png" });
} finally {
  try {
    if (dashboardId) await sql`delete from dashboard where id = ${dashboardId}`;
    if (ideaId) await sql`delete from idea where id = ${ideaId}`;
    if (ideaId || dashboardId) {
      await sql`delete from activity_entry where project_id = ${pid} and (summary like ${"%" + stamp + "%"} or target_id in (${ideaId ?? dashboardId}, ${dashboardId ?? ideaId}))`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  想法/洞察活动界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
