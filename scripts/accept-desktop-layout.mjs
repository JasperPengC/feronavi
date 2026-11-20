import "./_env.ts";
/**
 * PC 桌面布局验收（Round 104）
 * 常见桌面视口 + 浏览器缩放近似（125%/150% 的 CSS 视口）：
 * 1280/1366/1440/1920/2560、1152/1024/960；检查横向溢出、卡片重叠、侧栏/外壳、超宽屏主体全宽。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items?.[0]?.id);
  const routes = ["/workbench", "/projects", `/projects/${pid}`, "/issues", "/members", "/settings", "/system", `/projects/${pid}/board`, `/projects/${pid}/table`];
  const viewports = [
    ["1280×800（常见笔记本）", 1280, 800],
    ["1366×768（常见办公本）", 1366, 768],
    ["1440×900", 1440, 900],
    ["1920×1080（FHD）", 1920, 1080],
    ["2560×1440（2K）", 2560, 1440],
    ["1152×720（1440@125%）", 1152, 720],
    ["1024×640（1280@125%）", 1024, 640],
    ["960×600（1440@150%）", 960, 600],
  ];
  for (const [label, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    let ok = true;
    for (const route of routes) {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
      const state = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".page .card, .page .panel")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20; });
        let overlap = 0;
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i], b = cards[j]; if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          if (Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 2 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 2) overlap++;
        }
        const pageEl = document.querySelector(".page");
        const contentEl = document.querySelector(".shell-content");
        const cs = pageEl ? getComputedStyle(pageEl) : null;
        const contentStyle = contentEl ? getComputedStyle(contentEl) : null;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
          overlap,
          sidebar: !!document.querySelector(".shell-sidebar"),
          menuButton: !!document.querySelector(".shell-menu-button") && getComputedStyle(document.querySelector(".shell-menu-button")).display !== "none",
          pageWidth: pageEl ? Math.round(pageEl.getBoundingClientRect().width) : 0,
          availableWidth: contentEl ? Math.round(contentEl.getBoundingClientRect().width - parseFloat(contentStyle.paddingLeft) - parseFloat(contentStyle.paddingRight)) : 0,
          maxWidth: cs?.maxWidth ?? "",
        };
      });
      if (state.overflow || state.overlap > 0) { ok = false; check(`${label} ${route}`, false, JSON.stringify(state)); }
      if (width >= 1280 && !state.sidebar) { ok = false; check(`${label} ${route} 侧栏存在`, false); }
      if (width >= 1280 && state.menuButton) { ok = false; check(`${label} ${route} 不应出现移动汉堡`, false); }
      if (width === 2560 && Math.abs(state.pageWidth - state.availableWidth) > 2) { ok = false; check(`${label} ${route} 主体占满可用宽度`, false, JSON.stringify(state)); }
    }
    check(`${label}：9 个页面无溢出/重叠，桌面外壳正确`, ok);
  }
  // 2560 截图与内容宽度
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  const wide = await page.evaluate(() => {
    const el = document.querySelector(".page"); const content = document.querySelector(".shell-content");
    const r = el.getBoundingClientRect(); const c = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    return { width: Math.round(r.width), availableWidth: Math.round(c.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), leftGap: Math.round(r.left - c.left), rightGap: Math.round(c.right - r.right) };
  });
  check("2560 超宽屏主体占满可用宽度并保留对称留白", wide.width > 1920 && Math.abs(wide.width - wide.availableWidth) <= 2 && wide.leftGap > 0 && Math.abs(wide.leftGap - wide.rightGap) <= 2, JSON.stringify(wide));
  await page.screenshot({ path: "/tmp/pc-ultrawide-workbench.png" });
  // 1024/960 缩放近似：移动外壳应可用（汉堡能打开侧栏）
  for (const [label, width, height] of [["1024×640", 1024, 640], ["960×600", 960, 600]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(700);
    const menu = page.locator(".shell-menu-button");
    const visible = await menu.isVisible().catch(() => false);
    if (visible) { await menu.click(); await page.waitForTimeout(300); }
    const open = await page.locator(".shell-sidebar[data-open='true']").count();
    check(`${label}（缩放近似）：汉堡可见且能打开侧栏`, visible && open === 1, JSON.stringify({ visible, open }));
  }
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  PC 桌面布局验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
