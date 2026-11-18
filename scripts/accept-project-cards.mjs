import "./_env.ts";
/**
 * 项目卡片视图 + 真实风险信号验收（Round 83，对标 YouQu 项目卡）
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const KEY = `PC${STAMP.toUpperCase().slice(0, 6)}`;
const NAME = `风险项目${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let projectId = null, milestoneId = null, itemIds = [];
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ key, name }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const p = await (await fetch("/api/v1/projects", { method: "POST", headers, body: JSON.stringify({ key, name, description: "风险信号验收项目" }) })).json();
    const m = await (await fetch(`/api/v1/projects/${p.id}/milestones`, { method: "POST", headers, body: JSON.stringify({ name: "已逾期里程碑", dueDate: "2020-01-01" }) })).json();
    const w1 = await (await fetch(`/api/v1/projects/${p.id}/work-items`, { method: "POST", headers, body: JSON.stringify({ type: "DEFECT", title: "逾期缺陷", severity: "S1", dueDate: "2020-01-01" }) })).json();
    const w2 = await (await fetch(`/api/v1/projects/${p.id}/work-items`, { method: "POST", headers, body: JSON.stringify({ type: "DEFECT", title: "高优缺陷", severity: "S2" }) })).json();
    return { projectId: p.id, milestoneId: m.id, ids: [w1.id, w2.id] };
  }, { key: KEY, name: NAME });
  projectId = prep.projectId; milestoneId = prep.milestoneId; itemIds = prep.ids;
  check("真实创建项目+逾期里程碑+两个高优缺陷", !!projectId && !!milestoneId && itemIds.every(Boolean));

  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 15_000 });
  check("默认表格视图含风险信号 chips", (await page.locator("tr", { hasText: NAME }).innerText()).includes("逾期里程碑") && (await page.locator("tr", { hasText: NAME }).innerText()).includes("高优缺陷"));

  await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  await page.waitForTimeout(800);
  const card = page.locator(".project-card", { hasText: NAME });
  check("卡片视图渲染项目卡", (await card.count()) === 1);
  const cardText = await card.innerText();
  check("卡片显示真实风险信号", cardText.includes("逾期里程碑 1") && cardText.includes("逾期工作项 1") && cardText.includes("高优缺陷 2"), cardText.replace(/\n/g, " | "));
  check("卡片显示成员数与工作项数", cardText.includes("2") && cardText.includes(KEY));
  await page.getByRole("button", { name: /有风险/ }).click();
  await page.waitForTimeout(700);
  check("有风险筛选命中该项目", (await page.locator(".project-card", { hasText: NAME }).count()) === 1);
  await page.locator(".project-card", { hasText: NAME }).screenshot({ path: "/tmp/project-card-risk.png" });
  await page.screenshot({ path: "/tmp/project-cards.png" });
} finally {
  try {
    for (const id of itemIds) { if (id) { await sql`delete from activity_entry where target_id = ${id}`; await sql`delete from audit_entry where target_id = ${id}`; await sql`delete from work_item where id = ${id}`; } }
    if (milestoneId) await sql`delete from milestone where id = ${milestoneId}`;
    if (projectId) { await sql`delete from audit_entry where target_id = ${projectId}`; await sql`delete from project where id = ${projectId}`; }
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  项目卡片与风险信号验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
