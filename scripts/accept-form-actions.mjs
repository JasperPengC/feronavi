import "./_env.ts";
/**
 * 表单操作按钮位置验收（Round 106）
 * 规范：表单提交统一放在表单底部右侧（主按钮贴内容右边缘）；页头操作仍在右上；行内操作在行尾。
 * 覆盖设置页全部区块 + 项目新建抽屉 + 弹窗操作栏。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1400);

  const settings = await page.evaluate(() => {
    const sections = [...document.querySelectorAll(".settings-section")];
    const bad = [];
    const headerActions = document.querySelectorAll(".settings-section__actions").length;
    for (const section of sections) {
      const sr = section.getBoundingClientRect();
      for (const btn of section.querySelectorAll(".btn-primary")) {
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const rightGap = Math.round(sr.right - r.right);
        const w = Math.round(r.width);
        if (rightGap > 24 || w > sr.width * 0.5) bad.push({ title: section.querySelector("h2")?.textContent, text: btn.textContent?.trim(), rightGap, w });
      }
    }
    const rows = [...document.querySelectorAll(".settings-actions-row")].map((x) => getComputedStyle(x).justifyContent);
    const inline = [...document.querySelectorAll(".settings-form-inline")].map((form) => {
      const btn = form.querySelector(".btn-primary");
      const field = form.querySelector("input, .select-trigger, textarea");
      if (!btn || !field) return null;
      const br = btn.getBoundingClientRect(); const fr = field.getBoundingClientRect(); const pr = form.getBoundingClientRect();
      return { below: br.top >= fr.bottom - 2, rightGap: Math.round(pr.right - br.right) };
    }).filter(Boolean);
    return { headerActions, bad, rows, inline };
  });
  check("设置卡片标题栏不再放提交按钮", settings.headerActions === 0, String(settings.headerActions));
  check("设置页主按钮均贴内容右边缘（≤24px）且不是整行大按钮", settings.bad.length === 0, JSON.stringify(settings.bad.slice(0, 3)));
  check("设置页操作行统一右对齐", settings.rows.length > 0 && settings.rows.every((x) => x === "flex-end"), JSON.stringify(settings.rows.slice(0, 5)));
  check("设置页内联表单按钮在字段下方且右对齐", settings.inline.length > 0 && settings.inline.every((x) => x.below && x.rightGap <= 24), JSON.stringify(settings.inline.slice(0, 3)));
  await page.screenshot({ path: "/tmp/form-actions-settings.png", fullPage: false });

  // 其他页表单：主按钮必须在 .form-actions 内、贴内容右边缘
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  const formCases = [
    ["公告", "/announcements", "发送给全员"],
    ["API 令牌", "/tokens", "创建"],
    ["自定义字段", `/projects/${pid}/fields`, "创建"],
    ["今日聚焦", "/focus", "加时间块"],
  ];
  const formResults = [];
  for (const [name, path, label] of formCases) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
    const info = await page.evaluate((text) => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(text));
      if (!btn) return { found: false };
      const actions = btn.closest(".form-actions");
      const card = btn.closest(".card, .panel, .ui-panel");
      if (!actions || !card) return { found: true, inActions: false };
      const br = btn.getBoundingClientRect(); const cr = card.getBoundingClientRect();
      return { found: true, inActions: true, justify: getComputedStyle(actions).justifyContent, rightGap: Math.round(cr.right - br.right), width: Math.round(br.width), cardWidth: Math.round(cr.width) };
    }, label);
    formResults.push({ name, ...info });
  }
  check("公告/令牌/字段/聚焦表单主按钮均在底部右侧操作行", formResults.every((x) => x.found && x.inActions && x.justify === "flex-end" && x.rightGap >= 0 && x.rightGap <= 80), JSON.stringify(formResults));

  // 项目新建抽屉：底部右侧
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  await page.getByRole("button", { name: "新建项目", exact: true }).click(); await page.waitForTimeout(500);
  const drawer = page.locator(".ui-drawer").first();
  const drawerActions = page.locator(".ui-drawer .drawer-actions").first();
  const drawerState = await drawerActions.evaluate((el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const d = el.closest(".ui-drawer").getBoundingClientRect();
    return { justify: cs.justifyContent, rightGap: Math.round(d.right - r.right), bottomGap: Math.round(d.bottom - r.bottom) };
  });
  check("新建项目抽屉按钮在底部右侧", drawerState.justify === "flex-end" && drawerState.rightGap >= 0 && drawerState.rightGap <= 80 && drawerState.bottomGap >= 0, JSON.stringify(drawerState));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("抽屉已关闭", !(await drawer.isVisible().catch(() => false)));
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  表单操作按钮位置验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
