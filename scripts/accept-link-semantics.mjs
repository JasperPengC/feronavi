import "./_env.ts";
/**
 * 链接 / 按钮语义 · 真实浏览器验收（前端统一化 Round 17）
 *
 * 用户要求：「跳转用 <Link>/<a>（可中键新开、可复制 URL、读屏为链接）；提交/删除/开关/弹窗等动作用 <button>」。
 * 这个脚本守的是**真实渲染出来的标签与 href**：
 *   ① 侧栏导航项必须是真链接（<a href>），不是按钮；
 *   ② 账户菜单里的「个人偏好」必须是链接（此前是 button + navigate，本轮修掉）；
 *   ③ 账户菜单里的「退出登录」必须是按钮（动作，不是跳转）；
 *   ④ 顶栏面包屑链接是真链接；
 *   ⑤ 全站扫描：`<button>` 上不应出现「看起来是站内跳转」的显式路径跳转（本轮人工审计为 0）。
 */
import { chromium } from "playwright";

const HOST = process.env.BASE;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(HOST + "/login");
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });
  await page.goto(HOST + "/workbench", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);

  // ① 侧栏导航项
  const nav = await page.evaluate(() => {
    const items = [...document.querySelectorAll("nav a, .shell-nav-item, [data-nav-item]")].filter((el) => (el.textContent || "").trim());
    return items.map((el) => ({ tag: el.tagName.toLowerCase(), href: el.getAttribute("href"), text: (el.textContent || "").trim().slice(0, 12) }));
  });
  check("侧栏导航项都是真链接", nav.length > 0 && nav.every((x) => x.tag === "a" && !!x.href), JSON.stringify(nav.slice(0, 4)));

  // ②③ 打开账户菜单
  await page.locator(".shell-user-trigger, .avatar").last().click().catch(() => {});
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.shell-user-menu [role="menuitem"], .shell-user-menu a, .shell-user-menu button')];
    return items.map((el) => ({ tag: el.tagName.toLowerCase(), href: el.getAttribute("href"), text: (el.textContent || "").trim() }));
  });
  const settings = menu.find((x) => x.text.includes("个人偏好"));
  const logout = menu.find((x) => x.text.includes("退出") || x.text.includes("注销") || x.text.includes("登出"));
  check("账户菜单「个人偏好」是真链接（可中键/复制地址）", !!settings && settings.tag === "a" && settings.href === "/settings/personal", JSON.stringify(settings));
  check("账户菜单「退出登录」是按钮（动作）", !!logout && logout.tag === "button", JSON.stringify(logout));
  await page.screenshot({ path: "/tmp/accept-link-semantics-menu.png" });

  // ③b 通知铃铛：开浮层是**动作**，触发器必须是按钮（不是链接）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const bell = await page.evaluate(() => {
    // 侧栏也新增了「通知」导航链接，优先精确锁定铃铛按钮
    const el = document.querySelector(".notification-trigger") ?? document.querySelector('[aria-label*="通知"]');
    return el ? { tag: el.tagName.toLowerCase(), cls: el.className.slice(0, 40) } : null;
  });
  if (bell) {
    await page.locator(".notification-trigger").first().click();
    await page.waitForTimeout(600);
    const popover = await page.evaluate(() => {
      const d = document.querySelector('.notification-popover, [role="dialog"]');
      return d ? { role: d.getAttribute("role"), items: d.querySelectorAll(".notification-item").length } : null;
    });
    check("通知铃铛触发器是按钮（开浮层属动作）", bell.tag === "button", JSON.stringify(bell));
    check("点铃铛真的打开浮层", !!popover, JSON.stringify(popover));
    await page.screenshot({ path: "/tmp/accept-link-semantics-bell.png" });
    await page.keyboard.press("Escape");
  } else {
    check("通知铃铛触发器是按钮（开浮层属动作）", false, "未找到铃铛");
  }

  // ④ 面包屑
  const crumbs = await page.evaluate(() => [...document.querySelectorAll(".shell-breadcrumb a, [class*=breadcrumb] a")].map((a) => ({ tag: a.tagName.toLowerCase(), href: a.getAttribute("href") })));
  check("面包屑是真链接", crumbs.every((c) => c.tag === "a" && !!c.href), JSON.stringify(crumbs.slice(0, 3)));

  // ⑤ 全站扫描：按钮里不应出现站内路径字符串（粗筛，人工审计为 0）
  const suspicious = await page.evaluate(() => [...document.querySelectorAll("button")].filter((btn) => /to="\/|\/projects\/|navigate\(/.test(btn.outerHTML)).length);
  check("按钮上未发现显式站内跳转", suspicious === 0, `suspicious=${suspicious}`);
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/accept-link-error.png" }).catch(() => {});
}
const ok = results.filter((r) => r.pass).length;
console.log(`\n  链接/按钮语义验收 ${ok}/${results.length}`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
