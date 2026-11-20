import "./_env.ts";
/**
 * 移动端布局验收：390×844 下桌面页签收起，顶栏/工作区/Footer 均在视口内。
 * 页面内容从工作区顶部开始可见，且无横向溢出或隐藏页签留下的空行。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const reportDirectory = process.env.A11Y_REPORT_DIR ?? ".cache/a11y";
mkdirSync(reportDirectory, { recursive: true });
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", isMobile: true, hasTouch: true });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);
  const box = await page.evaluate(() => {
    const sel = [".shell-header", ".shell-tabbar", ".shell-workbench", ".shell-content", ".page-header", ".shell-footer", ".shell-main-col.app-main"];
    const out = { viewport: [innerWidth, innerHeight], scrollW: document.documentElement.scrollWidth };
    for (const s of sel) { const el = document.querySelector(s); if (!el) { out[s] = null; continue; } const r = el.getBoundingClientRect(); out[s] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
    return out;
  });
  const vh = box.viewport[1];
  check("页面无横向溢出", box.scrollW <= box.viewport[0] + 1, `${box.scrollW}/${box.viewport[0]}`);
  check("顶栏在视口内且不被压缩", box[".shell-header"].y >= 0 && box[".shell-header"].h <= 70 && box[".shell-header"].h >= 48, JSON.stringify(box[".shell-header"]));
  check("移动端桌面页签收起且不占布局空间", box[".shell-tabbar"].h === 0 && box[".shell-tabbar"].w === 0, JSON.stringify(box[".shell-tabbar"]));
  check("工作区紧接顶栏且高度合理", Math.abs(box[".shell-workbench"].y - box[".shell-header"].y - box[".shell-header"].h) <= 1 && box[".shell-workbench"].h > 300, JSON.stringify(box[".shell-workbench"]));
  check("页面标题在首屏可见（未被挤到屏下）", box[".page-header"].y >= 0 && box[".page-header"].y < vh - 100, `page-header.y=${box[".page-header"].y} viewportH=${vh}`);
  check("Footer 贴底且在视口内", box[".shell-footer"].y + box[".shell-footer"].h <= vh + 1, JSON.stringify(box[".shell-footer"]));
  check("工作区与 Footer 不重叠", box[".shell-content"].y + box[".shell-content"].h <= box[".shell-footer"].y + 1, `${box[".shell-content"].y + box[".shell-content"].h} / ${box[".shell-footer"].y}`);
  await page.screenshot({ path: `${reportDirectory}/mobile-after.png` });
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const settingsVisible = await page.getByText("设置", { exact: true }).count();
  check("移动端设置页可打开", settingsVisible > 0);
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  移动端布局验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
