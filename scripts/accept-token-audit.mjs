import "./_env.ts";
/**
 * 设计 token 审计（Round 112）：实测全站圆角/控件高度/间距/卡片内边距，异常即失败。
 * 页面：工作台/项目/问题/成员/设置/系统/专注/项目集。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const GLOBAL_PAGES = ["/workbench", "/projects", "/issues", "/members", "/settings/personal", "/settings/integrations", "/settings/instance", "/system", "/portfolios", "/announcements", "/notifications", "/tokens", "/changelog", "/admin/organization", "/admin/roles", "/admin/audit"];
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
      const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const elements = (selector) => [...document.querySelectorAll(selector)].filter(visible);
      const vals = (sel, prop) => [...new Set(elements(sel).map((e) => getComputedStyle(e)[prop]).filter(Boolean))].sort();
      const token = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();
      const violations = { cards: [], buttons: [], inputs: [], buttonH: [], inputH: [], gaps: [], pads: [] };
      const audit = (key, nodes, property, allowed) => {
        for (const el of nodes) {
          const value = getComputedStyle(el)[property], expected = allowed(el);
          if (!expected.includes(value)) violations[key].push({ element: el.className, value, expected });
        }
      };
      const isNestedCard = (e) => { let p = e.parentElement; while (p) { if (p.matches(".card,.panel,.ui-panel,.settings-section,.sys-section")) return true; p = p.parentElement; } return false; };
      const topCards = [...document.querySelectorAll(".card, .panel, .ui-panel, .settings-section, .sys-section")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !isNestedCard(e) && !e.closest(".board-column-body"); });
      audit("cards", topCards, "borderRadius", (el) => [el.matches("table, .project-overview-page .dashboard-grid > div > .panel") ? "0px" : token(el.matches(".data-scroll") ? "--radius-md" : "--radius", el)]);
      audit("buttons", elements(".btn"), "borderRadius", (el) => [token("--radius-sm", el), token("--radius-pill", el)]);
      audit("inputs", elements(".input, .textarea, .select-trigger"), "borderRadius", (el) => el.matches(".wiki-title-input, .wiki-body-editor, .md-editor-input") ? ["0px"] : [token("--radius-sm", el), token("--radius-pill", el)]);
      audit("buttonH", elements(".btn"), "height", (el) => {
        if (el.matches(".shell-header .icon-choice-menu > .btn, .shell-header .notification-trigger, .shell-header .shell-menu-button")) return [token("--shell-control-size", el)];
        if (el.matches(".workbench-todo-add, .workbench-todo-delete")) return [matchMedia("(pointer: coarse)").matches ? "44px" : "32px"];
        if (el.matches(".select-trigger, .datepicker-trigger")) return [token(el.matches(".btn-sm") ? "--control-height-sm" : "--control-height", el)];
        return [token(el.matches(".btn-sm") ? "--button-height-sm" : "--button-height", el)];
      });
      audit("inputH", elements(".input, .select-trigger"), "minHeight", (el) => {
        return [token(el.matches(".btn-sm") ? "--control-height-sm" : "--control-height", el)];
      });
      audit("gaps", elements(".metric-grid, .dashboard-grid, .page-grid, .settings-grid, .sys-kpi-grid"), "gap", (el) => {
        if (el.matches(".workbench-top-grid, .workbench-lower-grid")) return [token("--card-padding", el)];
        return [token("--space-3", el), token("--space-4", el)];
      });
      // 0 为贴边表格，16 为内嵌内容，22 为系统/设置卡片；默认与紧凑面板读取设计 token。
      audit("pads", elements(".card, .panel, .ui-panel"), "padding", (el) => {
        if (el.matches(".board-card, .board-column-body .card")) return ["10px"];
        if (el.matches(".milestones-page aside.card")) return ["15px"];
        return ["0px", token("--space-4", el), token("--card-padding", el), token("--card-padding-compact", el), "22px"];
      });
      return {
        violations,
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
  const errors = (key) => Object.entries(data).flatMap(([page, state]) => state.violations[key].map((error) => ({ page, ...error })));
  for (const [key, label, values] of [
    ["cards", "卡片遵循当前 radius，项目概览内嵌面板保持直角", cards],
    ["buttons", "按钮使用当前控件或胶囊圆角", buttons],
    ["inputs", "输入与下拉使用当前圆角，正文编辑器保持直角", inputs],
    ["buttonH", "按钮高度遵循当前尺寸 token 与工作台紧凑规则", buttonH],
    ["inputH", "输入与下拉高度遵循尺寸 token 与设置区输入规则", inputH],
    ["gaps", "网格间距遵循设计 token 与工作台分区规则", gaps],
    ["pads", "卡片内边距符合默认、紧凑、贴边及管理页规则", pads],
  ]) check(label, values.length > 0 && errors(key).length === 0, JSON.stringify({ values, errors: errors(key).slice(0, 5) }));
  const overflowPages = Object.entries(data).filter(([, v]) => v.overflow).map(([k]) => k);
  check(`${PAGES.length} 路由明/暗桌面无横向溢出`, overflowPages.length === 0, JSON.stringify(overflowPages));
  console.log(`\n  已审计 ${Object.keys(data).length} 个页面状态（${Object.keys(data).length / 2} 路由 × 明/暗）`);
  console.log("  token 明细:", JSON.stringify({ cards, buttons, inputs, buttonH, inputH, gaps, pads }));
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  设计 token 审计 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
