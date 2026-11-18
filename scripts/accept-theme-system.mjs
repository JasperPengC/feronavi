import "./_env.ts";
/**
 * 「跟随系统」主题验收（Round 91）：真实浏览器深/浅系统模拟 + 服务端 system 归一化。
 * 复现并防回归：服务端值 "system" 曾被直接当客户端值，导致选跟随系统却永远浅色。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "dark" });
const page = await ctx.newPage();
const htmlClass = () => page.evaluate(() => document.documentElement.className);
const csrf = () => page.evaluate(() => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || ""));
const setPref = async (theme) => page.evaluate(async ({ theme, csrf }) => {
  await fetch("/api/v1/me/preferences", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ theme }) });
}, { theme, csrf: await csrf() });
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  check("登录页在系统深色下直接是深色（无 FOUC 兜底）", (await htmlClass()).includes("theme-dark"), await htmlClass());
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await setPref("system");
  await page.evaluate(() => { document.cookie = "feronavi_theme=auto; path=/"; });
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);
  check("服务端偏好 system + 系统深色 → 工作台深色（不再强制浅色）", (await htmlClass()).includes("theme-dark"), await htmlClass());
  await page.screenshot({ path: "/tmp/theme-dark-system.png" });

  // 历史 cookie=system 也必须按跟随系统处理（真实历史 bug 的防回归）
  await page.evaluate(() => { document.cookie = "feronavi_theme=system; path=/"; });
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  check("历史 cookie=system + 系统深色 → 深色", (await htmlClass()).includes("theme-dark"), await htmlClass());

  // 系统切成浅色，auto 模式必须实时跟随
  await page.emulateMedia({ colorScheme: "light" }); await page.waitForTimeout(700);
  check("系统切浅色 → 自动变浅色", (await htmlClass()).includes("theme-light"), await htmlClass());
  await page.screenshot({ path: "/tmp/theme-light-system.png" });
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(700);
  check("系统切回深色 → 自动变深色", (await htmlClass()).includes("theme-dark"), await htmlClass());

  // 头部选择「跟随系统」并持久化到服务端
  await page.getByRole("button", { name: "主题", exact: true }).click();
  check("主题菜单显示跟随系统并已选中", (await page.getByRole("menuitemradio", { name: /跟随系统/ }).getAttribute("aria-checked")) === "true");
  await page.getByRole("menuitemradio", { name: /跟随系统/ }).click(); await page.waitForTimeout(700);
  check("选择跟随系统后仍为深色", (await htmlClass()).includes("theme-dark"), await htmlClass());
  const prefs = await page.evaluate(async () => (await (await fetch("/api/v1/me/preferences")).json()));
  check("账号偏好持久化为 system", prefs.theme === "system", JSON.stringify(prefs.theme));

  // 手动浅色必须覆盖系统深色（固定选择不被系统改变）
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^浅色/ }).click(); await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(600);
  check("手动浅色不被系统深色覆盖", (await htmlClass()).includes("theme-light"), await htmlClass());
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^跟随系统/ }).click(); await page.waitForTimeout(600);
  check("切回跟随系统后系统深色 → 深色", (await htmlClass()).includes("theme-dark"), await htmlClass());

  await setPref("system");
  await page.emulateMedia({ colorScheme: "dark" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  跟随系统主题验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
