import "./_env.ts";
/** 交互状态验收（Round 118）：hover / focus-visible / disabled / 下拉 / 抽屉 / 模态。 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);

  // ① 主按钮 hover 背景变化
  const btn = page.locator(".btn.btn-primary").first();
  const before = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  await btn.hover(); await page.waitForTimeout(180);
  const after = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  check("主按钮 hover 有可见背景变化", before !== after, `${before} → ${after}`);

  // ② 键盘 focus-visible 有可见指示
  const focused = await page.evaluate(() => {
    const el = document.querySelector(".btn.btn-primary");
    if (!el) return null;
    el.focus();
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow };
  });
  check("按钮键盘聚焦有可见轮廓/阴影", !!focused && (focused.width !== "0px" || focused.shadow !== "none"), JSON.stringify(focused));

  // ③ 抽屉：圆角、遮罩、焦点、Escape
  await page.getByRole("button", { name: /新建项目/ }).first().click();
  await page.waitForTimeout(350);
  const drawer = await page.evaluate(() => {
    const el = document.querySelector(".ui-drawer");
    if (!el) return null;
    const s = getComputedStyle(el);
    const active = document.activeElement;
    const body = getComputedStyle(el.querySelector(".ui-drawer-body"));
    return { radius: s.borderTopLeftRadius, expectedRadius: s.getPropertyValue("--radius").trim(), bodyPad: body.padding,
      inlinePadding: [body.paddingLeft, body.paddingRight], expectedPadding: s.getPropertyValue("--card-padding").trim(),
      focusedInside: !!el.contains(active), role: el.getAttribute("role") };
  });
  check("项目抽屉使用当前圆角与水平内边距 token", !!drawer && drawer.role === "dialog" && drawer.radius === drawer.expectedRadius && drawer.inlinePadding.every((value) => value === drawer.expectedPadding), JSON.stringify(drawer));
  check("抽屉打开后焦点在面板内", !!drawer && drawer.focusedInside);
  await page.keyboard.press("Escape"); await page.locator(".ui-drawer").waitFor({ state: "hidden" });
  check("Escape 关闭抽屉", await page.locator(".ui-drawer").count() === 0);

  // ④ 下拉：面板打开、圆角、选项 hover
  await page.goto(`${BASE}/settings/personal`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  const trigger = page.locator(".select-trigger").first();
  await trigger.click(); await page.waitForTimeout(200);
  const panel = await page.evaluate(() => {
    const el = document.querySelector(".select-panel");
    if (!el) return null;
    const s = getComputedStyle(el);
    return { role: el.querySelector("[role='listbox']")?.getAttribute("role"), radius: s.borderRadius, display: s.display, items: el.querySelectorAll("[role='option']").length };
  });
  // menu-panel 的现行浮层圆角为 12px；触发器使用独立的控件圆角 token。
  check("下拉面板使用统一菜单圆角且包含可访问选项", !!panel && panel.display !== "none" && panel.radius === "12px" && panel.role === "listbox" && panel.items > 0, JSON.stringify(panel));
  await page.keyboard.press("Escape");

  // ⑤ 表格排序：th[aria-sort] 随点击切换，排序按钮有 focus 样式
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  await page.goto(`${BASE}/projects/${pid}/table`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  const sortBefore = await page.evaluate(() => document.querySelector("th[aria-sort]")?.getAttribute("aria-sort"));
  await page.locator(".sort-button").first().click(); await page.waitForTimeout(500);
  const sortAfter = await page.evaluate(() => document.querySelector("th[aria-sort]")?.getAttribute("aria-sort"));
  check("可排序表头有 aria-sort 且点击切换", sortBefore === "ascending" && sortAfter === "descending", `${sortBefore} → ${sortAfter}`);

  // ⑥ 禁用态：令牌页创建按钮（未填用途）不可点击且视觉降级
  await page.goto(`${BASE}/tokens`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  await page.getByRole("button", { name: "新建令牌", exact: true }).click();
  const disabled = await page.getByRole("dialog").getByRole("button", { name: "创建", exact: true }).evaluate((el) => {
    const s = getComputedStyle(el);
    return { disabled: el.disabled, opacity: s.opacity, cursor: s.cursor };
  });
  check("未填写用途时创建按钮禁用且有视觉降级", disabled.disabled && Number(disabled.opacity) < 1 && disabled.cursor === "not-allowed", JSON.stringify(disabled));
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();

  // ⑦ 用无匹配搜索稳定产生空态，避免依赖演示项目集是否为空。
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("搜索标题或编号").fill(`ui-state-no-match-${Date.now()}`);
  await page.locator(".ui-state-empty").waitFor();
  const empty = await page.evaluate(() => {
    const el = document.querySelector(".ui-state-empty");
    if (!el) return null;
    const s = getComputedStyle(el);
    return { radius: s.borderRadius, expectedRadius: s.getPropertyValue("--radius").trim(), padding: s.padding, minHeight: s.minHeight, action: el.querySelector("button")?.textContent?.trim() };
  });
  check("空态块有统一圆角、内边距和恢复动作", !!empty && empty.radius === empty.expectedRadius && empty.padding !== "0px" && empty.action === "清除筛选", JSON.stringify(empty));

  // ⑧ 错误态：拦截问题统计接口 500，检查统一 error block + 重试
  await page.route("**/api/v1/issues/stats", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "验收失败", details: null }) }));
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  const errorInfo = await page.evaluate(() => {
    const el = document.querySelector(".ui-state-error");
    if (!el) return null;
    return { role: el.getAttribute("role"), title: el.querySelector("strong")?.textContent, retry: el.querySelector("button")?.textContent?.trim() };
  });
  check("页面错误态使用统一 StateBlock（role=alert + 重试）", !!errorInfo && errorInfo.role === "alert" && !!errorInfo.title && !!errorInfo.retry, JSON.stringify(errorInfo));
  await page.unroute("**/api/v1/issues/stats");

  // ⑨ 加载态：延迟接口，检查统一 LoadingBlock 的 role/aria-busy/spinner
  await page.route("**/api/v1/projects", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue(); });
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  const loading = await page.waitForSelector(".ui-loading", { timeout: 2500 }).catch(() => null);
  const loadingInfo = loading ? await loading.evaluate((el) => ({
    role: el.getAttribute("role"), busy: el.getAttribute("aria-busy"),
    spinner: getComputedStyle(el.querySelector(".ui-loading-spinner")).animationName,
    label: el.textContent?.trim(),
  })) : null;
  check("页面加载态使用统一 LoadingBlock（status + aria-busy + spinner）", !!loadingInfo && loadingInfo.role === "status" && loadingInfo.busy === "true" && loadingInfo.spinner.includes("spin") && !!loadingInfo.label, JSON.stringify(loadingInfo));
  await page.unroute("**/api/v1/projects");
} finally { await ctx.close(); await b.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  交互状态验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
