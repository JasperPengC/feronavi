import "./_env.ts";
/**
 * 大数据量/长内容布局压力验收（Round 101）
 * 真实创建 1 个长名称项目 + 80 条长标题工作项：
 * 项目列表/看板/表格在桌面与移动视口无页面级横向溢出、卡片/行不重叠，长标题不会撑破布局。
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
    const headers = { "content-type": "application/json", "x-csrf-token": csrf() };
    const longName = "超长名称压力验收项目 · 这是一个用于验证项目列表布局在极端长度下不会撑破容器的项目名称 · " + stamp;
    const p = await (await fetch("/api/v1/projects", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify({ key: `S${stamp.slice(-6).toUpperCase()}`, name: longName }) })).json();
    if (!p.id) throw new Error("project create failed: " + JSON.stringify(p));
    for (let i = 0; i < 80; i++) {
      const title = `${String(i + 1).padStart(2, "0")} 超长工作项标题 · 用于验证看板卡片与表格单元格在长文本、长数字编号和连续英文标识符下的容器约束 · ${"X".repeat(40)} · ${stamp}`;
      const r = await fetch(`/api/v1/projects/${p.id}/work-items`, { method: "POST", credentials: "same-origin", headers, body: JSON.stringify({ title, type: i % 7 === 0 ? "DEFECT" : "TASK", priority: ["LOW", "MEDIUM", "HIGH", "URGENT"][i % 4], description: "长描述 ".repeat(30) }) });
      if (!r.ok) throw new Error("work item create failed: " + r.status + " " + (await r.text()).slice(0, 120));
    }
    return p;
  }, stamp);
  projectId = created.id;
  check("压力数据创建成功（1 项目 + 80 工作项）", true);

  for (const [label, width, height, path] of [
    ["桌面项目列表", 1440, 950, "/projects"],
    ["桌面看板", 1440, 950, `/projects/${projectId}/board`],
    ["桌面表格", 1440, 950, `/projects/${projectId}/table`],
    ["移动项目列表", 390, 844, "/projects"],
    ["移动看板", 390, 844, `/projects/${projectId}/board`],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1600);
    const state = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".card, .panel, .work-item-card, table")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10; });
      let overlap = 0;
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j]; if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
        if (ix > 2 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 2) overlap++;
      }
      return { overflow: document.documentElement.scrollWidth > innerWidth + 2, overlap, bodyLen: (document.body.textContent || "").length };
    });
    check(`${label}：无页面级横向溢出`, !state.overflow, `scroll/inner=${await page.evaluate(() => `${document.documentElement.scrollWidth}/${innerWidth}`)}`);
    check(`${label}：卡片/表格无相互重叠`, state.overlap === 0, String(state.overlap));
    if (label === "桌面看板") {
      const chrome = await page.evaluate(() => {
        const card = document.querySelector(".workspace-switcher")?.getBoundingClientRect();
        const foot = document.querySelector(".footer-project")?.getBoundingClientRect();
        const footBar = document.querySelector(".shell-footer")?.getBoundingClientRect();
        return { cardH: card ? Math.round(card.height) : null, footOverflow: foot && footBar ? foot.right > footBar.right + 1 : false };
      });
      check("超长项目名在侧栏工作区卡片内截断（不撑高）", chrome.cardH !== null && chrome.cardH <= 56, JSON.stringify(chrome));
      check("超长项目名在页脚内不溢出", chrome.footOverflow === false, JSON.stringify(chrome));
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`${BASE}/projects/${projectId}/board`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1400);
  await page.screenshot({ path: "/tmp/stress-board.png" });
} finally {
  await browser.close();
  if (projectId) {
    await sql`delete from audit_entry where target_id = ${projectId}`.catch(() => {});
    await sql`delete from project where id = ${projectId}`.catch(() => {});
  }
  await sql.end();
}
const ok = results.filter(Boolean).length;
console.log(`\n  大数据量布局压力验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
