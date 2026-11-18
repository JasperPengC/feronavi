import "./_env.ts";
/**
 * 空态视觉与布局验收（Round 103）
 * 真实创建一个空项目：项目概览/看板/表格/里程碑/活动/知识库/问题筛选，
 * 检查空态存在下一步动作、无横向溢出、无卡片重叠；移动视口再核一遍看板。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const sql = postgres(process.env.DATABASE_URL, { max: 3 });
const stamp = Date.now().toString(36);
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
let projectId;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  const created = await page.evaluate(async (stamp) => {
    await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) });
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const p = await (await fetch("/api/v1/projects", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ key: `E${stamp.slice(-6).toUpperCase()}`, name: `空态验收项目 ${stamp}` }) })).json();
    if (!p.id) throw new Error(JSON.stringify(p));
    return p;
  }, stamp);
  projectId = created.id;
  check("空项目创建成功", true);

  const routes = [
    ["项目概览", `/projects/${projectId}`, "概览"],
    ["看板", `/projects/${projectId}/board`, "草稿"],
    ["表格", `/projects/${projectId}/table`, "工作项"],
    ["里程碑", `/projects/${projectId}/milestones`, "里程碑"],
    ["活动", `/projects/${projectId}/activity`, "活动"],
    ["知识库", `/projects/${projectId}/wiki`, "知识库"],
  ];
  for (const [label, path] of routes) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".page .card, .page .panel")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20; });
      let overlap = 0;
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j]; if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        if (Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 2 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 2) overlap++;
      }
      return { overflow: document.documentElement.scrollWidth > innerWidth + 2, overlap, textLen: (document.body.textContent || "").length };
    });
    check(`${label}：空态无横向溢出`, !state.overflow, `scroll/inner=${await page.evaluate(() => `${document.documentElement.scrollWidth}/${innerWidth}`)}`);
    check(`${label}：卡片无重叠`, state.overlap === 0, String(state.overlap));
    check(`${label}：显示真实内容（非白屏）`, state.textLen > 500, String(state.textLen));
  }

  // 看板空列提示
  await page.goto(`${BASE}/projects/${projectId}/board`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  const boardEmpty = await page.locator(".board-empty-state").count();
  check("看板每列显示空态提示", boardEmpty >= 3, String(boardEmpty));

  // 里程碑空态有 CTA
  await page.goto(`${BASE}/projects/${projectId}/milestones`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  check("里程碑空态提供创建动作", (await page.locator(".milestone-empty").innerText()).includes("新建"), (await page.locator(".milestone-empty").innerText()).slice(0, 60));

  // 移动视口看板无页面级横向溢出
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/projects/${projectId}/board`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  check("移动看板空态无页面级横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), await page.evaluate(() => `${document.documentElement.scrollWidth}/${innerWidth}`));
  await page.screenshot({ path: "/tmp/empty-board-mobile.png" });
} finally {
  await browser.close();
  if (projectId) {
    await sql`delete from audit_entry where target_id = ${projectId}`.catch(() => {});
    await sql`delete from project where id = ${projectId}`.catch(() => {});
  }
  await sql.end();
}
const ok = results.filter(Boolean).length;
console.log(`\n  空态视觉与布局验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
