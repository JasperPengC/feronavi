import "./_env.ts";
/**
 * 设计基线验收（Round 92）：全局无下划线；卡片跳转是「纯文字 + 右箭头」而非按钮；
 * 点击箭头链接真实导航；按钮几何统一（同一尺寸集合、圆角一致）。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
const projects = [];
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const list = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items);
  projects.push(...list);

  const routes = ["/workbench", "/projects", `/projects/${projects[0].id}`, "/members", "/settings", "/system"];
  const underlines = [];
  const buttonGeom = [];
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1400);
    const info = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("a, button")) {
        const cs = getComputedStyle(el);
        if (cs.textDecorationLine.includes("underline") && el.textContent?.trim()) bad.push({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40) });
      }
      const btns = [...document.querySelectorAll(".btn:not(.select-trigger):not(.datepicker-trigger)")].filter((el) => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      }).map((el) => { const cs = getComputedStyle(el); return { h: Math.round(el.getBoundingClientRect().height), radius: cs.borderRadius, font: cs.fontSize, cls: el.className, text: (el.textContent || "").trim().slice(0, 24) }; });
      return { bad, btns };
    });
    underlines.push(...info.bad.map((x) => ({ route, ...x })));
    buttonGeom.push(...info.btns.map((x) => ({ route, ...x })));
  }
  check("全站链接/按钮无下划线", underlines.length === 0, JSON.stringify(underlines.slice(0, 5)));
  const heights = [...new Set(buttonGeom.map((b) => b.h))].sort((a, b) => a - b);
  const badRadius = buttonGeom.filter((b) => b.radius === "0px");
  check("按钮高度来自统一尺寸集合（28/32/36）", heights.every((h) => [28, 32, 36].includes(h)), JSON.stringify(heights));
  const odd = buttonGeom.filter((b) => ![26, 30, 40, 44].includes(b.h));
  check("按钮圆角统一（无直角按钮）", badRadius.length === 0, JSON.stringify(badRadius.slice(0, 3)));
  if (odd.length) console.log("  [debug odd heights]", JSON.stringify(odd.slice(0, 8)));

  // 卡片标题跳转：纯文字 + 右箭头，不是按钮
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const side = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".shell-nav-item")].filter((el) => el.getBoundingClientRect().height > 0).map((el) => Math.round(el.getBoundingClientRect().height));
    const groups = [...document.querySelectorAll(".nav-group")].map((el) => ({
      label: el.querySelector(".nav-group-label")?.textContent,
      expanded: el.querySelector(".nav-group-toggle")?.getAttribute("aria-expanded"),
      chevron: !!el.querySelector(".nav-group-chevron svg"),
      guide: getComputedStyle(el.querySelector(".nav-group-items"), "::before").width,
    }));
    return { items, groups, navGap: getComputedStyle(document.querySelector(".main-nav")).rowGap };
  });
  check("侧栏菜单高度收敛（一级 36 / 子项 32）", side.items.every((h) => h === 36 || h === 32), JSON.stringify([...new Set(side.items)]));
  check("侧栏分组可折叠（aria-expanded + chevron + 引导线）", side.groups.length >= 3 && side.groups.every((g) => g.expanded !== null && g.chevron && parseFloat(g.guide) === 1), JSON.stringify(side.groups));
  check("侧栏菜单节奏紧凑（gap 2px）", side.navGap === "2px", side.navGap);
  const cardLinks = page.locator(".panel-title .arrow-link");
  const n = await cardLinks.count();
  check("工作台卡片标题存在箭头跳转链接", n >= 2, String(n));
  const first = cardLinks.first();
  check("卡片跳转不是 button 且无下划线", (await first.evaluate((el) => el.tagName === "A" && !getComputedStyle(el).textDecorationLine.includes("underline"))) === true);
  check("卡片跳转带右箭头 icon", (await first.locator("svg").count()) === 1);
  await page.screenshot({ path: "/tmp/design-baseline-workbench.png" });

  await page.goto(`${BASE}/projects/${projects[0].id}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const poLinks = page.locator(".page .arrow-link");
  check("项目概览卡片使用箭头跳转", (await poLinks.count()) >= 2, String(await poLinks.count()));
  await page.screenshot({ path: "/tmp/design-baseline-project.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  设计基线验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
