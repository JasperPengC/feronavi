import "./_env.ts";
/**
 * 键盘/语义可访问性人工等价验收（Round 102）
 * axe 之外检查：标题层级、landmark、控件可访问名称、跳过导航、焦点可见、基础 Tab 顺序。
 * 注意：这不等于真人读屏测试，脚本会如实标注。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const USERNAME = process.env.A11Y_USERNAME ?? "demo";
const PASSWORD = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async ({ username, password }) => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); }, { username: USERNAME, password: PASSWORD });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items?.[0]?.id);

  // 跳过导航：首次 Tab 应聚焦 skip link，Enter 后进入 main
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const firstFocus = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), cls: document.activeElement?.className }));
  check("首次 Tab 聚焦「跳到主内容」", firstFocus.text === "跳到主内容", JSON.stringify(firstFocus));
  await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  const mainFocus = await page.evaluate(() => document.activeElement?.id);
  check("Enter 后焦点进入主内容", mainFocus === "main-content", mainFocus ?? "");

  const pages = ["/workbench", "/projects", `/projects/${pid}`, "/issues", "/members", "/settings", "/system", "/admin/roles", `/projects/${pid}/board`, `/projects/${pid}/table`, `/projects/${pid}/wiki`, `/projects/${pid}/automation`];
  for (const path of pages) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
    const info = await page.evaluate(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const nameOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim()
        || el.closest("label")?.textContent?.trim()
        || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim()) || "";
      const unnamed = [...document.querySelectorAll("button, a[href], input, select, textarea")].filter(visible).filter((el) => !nameOf(el)).slice(0, 5).map((el) => el.outerHTML.slice(0, 100));
      const h1 = document.querySelectorAll("h1").length;
      return {
        h1, unnamed,
        landmarks: { header: !!document.querySelector("header"), nav: document.querySelectorAll("nav").length, main: !!document.querySelector("main"), footer: !!document.querySelector("footer") },
      };
    });
    check(`${path}：唯一 h1`, info.h1 === 1, String(info.h1));
    check(`${path}：landmark 完整（header/nav/main/footer）`, info.landmarks.header && info.landmarks.nav >= 1 && info.landmarks.main && info.landmarks.footer, JSON.stringify(info.landmarks));
    check(`${path}：所有可见控件有可访问名称`, info.unnamed.length === 0, JSON.stringify(info.unnamed));
  }

  // 焦点可见：Tab 到侧栏链接后应有可见轮廓
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  await page.evaluate(() => document.body.focus());
  let focusVisible = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => { const el = document.activeElement; if (!el) return null; const cs = getComputedStyle(el); return { tag: el.tagName, outline: cs.outlineStyle, shadow: cs.boxShadow }; });
    if (s && (s.outline !== "none" || (s.shadow && s.shadow !== "none"))) { focusVisible = true; break; }
  }
  check("键盘焦点有可见轮廓/阴影", focusVisible);
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  键盘/语义可访问性验收 ${ok}/${results.length}（自动等价检查，非真人读屏）`);
process.exit(ok === results.length ? 0 : 1);
