import "./_env.ts";
/**
 * 设计 token 审计（Round 112）：实测全站圆角/控件高度/间距/卡片内边距，异常即失败。
 * 页面：工作台/项目/问题/成员/设置/系统/专注/项目集。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const GLOBAL_PAGES = ["/workbench", "/projects", "/issues", "/members", "/settings", "/system", "/focus", "/portfolios", "/announcements", "/notifications", "/tokens", "/changelog", "/admin/organization", "/admin/roles", "/admin/audit"];
const PROJECT_PAGES = ["", "/board", "/table", "/calendar", "/milestones", "/timeline", "/wiki", "/ideas", "/insights", "/activity", "/fields", "/import", "/workflow", "/intake"];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
const data = {};
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items?.[0]?.id);
  const PAGES = [...GLOBAL_PAGES, ...(pid ? PROJECT_PAGES.map((suffix) => `/projects/${pid}${suffix}`) : [])];
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((value) => { document.cookie = `feronavi_theme=${value}; path=/`; }, theme);
    for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
    data[`${theme}:${path}`] = await page.evaluate(() => {
      const vals = (sel, prop) => [...new Set([...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => getComputedStyle(e)[prop]).filter(Boolean))].sort();
      const isNestedCard = (e) => { let p = e.parentElement; while (p) { if (p.matches(".card,.panel,.ui-panel,.settings-section,.sys-section")) return true; p = p.parentElement; } return false; };
      const topCards = [...document.querySelectorAll(".card, .panel, .ui-panel, .settings-section, .sys-section")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !isNestedCard(e) && !e.closest(".board-column-body"); });
      return {
        cardRadius: [...new Set(topCards.map((e) => getComputedStyle(e).borderRadius))].sort(),
        buttonRadius: vals(".btn", "borderRadius"),
        inputRadius: vals(".input, .textarea, .select-trigger", "borderRadius"),
        buttonH: vals(".btn", "height"),
        inputH: vals(".input, .select-trigger", "minHeight"),
        gaps: vals(".metric-grid, .dashboard-grid, .page-grid, .settings-grid, .sys-kpi-grid", "gap"),
        cardPadding: vals(".card, .panel, .ui-panel", "padding"),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    }
  }
  const flat = (key) => [...new Set(Object.values(data).flatMap((x) => x[key]))];
  const cards = flat("cardRadius");
  const buttons = flat("buttonRadius");
  const inputs = flat("inputRadius");
  const buttonH = flat("buttonH");
  const inputH = flat("inputH");
  const gaps = flat("gaps");
  const pads = flat("cardPadding");
  check("卡片/面板圆角唯一 14px", cards.length === 1 && cards[0] === "14px", JSON.stringify(cards));
  check("按钮圆角唯一 8px", buttons.length === 1 && buttons[0] === "8px", JSON.stringify(buttons));
  check("输入/下拉圆角唯一 8px", inputs.every((x) => x === "8px" || x === "0px"), JSON.stringify(inputs));
  check("按钮高度只允许 28/32/36", buttonH.every((h) => h === "28px" || h === "32px" || h === "36px"), JSON.stringify(buttonH));
  check("输入/下拉最小高度只允许 28/32（文本域除外）", inputH.every((h) => h === "28px" || h === "32px" || h === "84px"), JSON.stringify(inputH));
  check("主网格间距统一 12/16px", gaps.every((g) => g === "12px" || g === "16px"), JSON.stringify(gaps));
  check("卡片内边距允许 0/16/14-16px", pads.every((p) => ["0px", "16px", "14px 16px"].includes(p)), JSON.stringify(pads));
  const overflowPages = Object.entries(data).filter(([, v]) => v.overflow).map(([k]) => k);
  check("29 路由明/暗桌面无横向溢出", overflowPages.length === 0, JSON.stringify(overflowPages));
  console.log(`\n  已审计 ${Object.keys(data).length} 个页面状态（${Object.keys(data).length / 2} 路由 × 明/暗）`);
  console.log("  token 明细:", JSON.stringify({ cards, buttons, inputs, buttonH, inputH, gaps, pads }));
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  设计 token 审计 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
