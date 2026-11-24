import "./_env.ts";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE;
assert.ok(base); assert.ok(process.env.PROJECT_ID);
const output = resolve(".cache/workbench-ui-review");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function capture(target, name) {
  await page.waitForFunction(() => !CSS.supports("selector(:active-view-transition)") || !document.documentElement.matches(":active-view-transition"));
  await target.screenshot({ path: `${output}/${name}.png` });
}
async function assertFooterAligned() {
  const offsets = await page.evaluate(() => {
    const brand = document.querySelector(".footer-brand").getBoundingClientRect();
    const panel = document.querySelector(".workbench-group-list").getBoundingClientRect();
    return { brand: brand.left, panel: panel.left };
  });
  assert.ok(Math.abs(offsets.brand - offsets.panel) <= 1, JSON.stringify(offsets));
}
async function login() {
  await page.getByLabel(/用户名/).fill("demo");
  await page.getByLabel(/^密码/).fill("demo-password-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}
try {
  await page.goto(`${base}/login`);
  await login();
  await page.evaluate(async (projectId) => {
    const me = await (await fetch("/api/v1/auth/me")).json();
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "");
    const due = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    for (let i = 1; i <= 55; i++) {
      const response = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ type: "TASK", title: `分组验收 ${i}：检查中文长标题、优先级和到期日期的布局`, assigneeId: me.memberId, priority: "HIGH", dueDate: due }),
      });
      if (!response.ok) throw new Error(`样本创建失败 ${response.status}`);
    }
  }, process.env.PROJECT_ID);
  await page.goto(`${base}/workbench`);
  const cards = page.locator(".workbench-groups-grid");
  await cards.getByRole("link", { name: "查看全部：我创建的" }).waitFor();
  assert.equal(await cards.getByRole("link").count(), 4);
  assert.equal(await cards.getByRole("button", { name: /显示其余/ }).count(), 0);
  assert.ok(await cards.evaluate((grid) => [...grid.querySelectorAll(".workbench-group-head")].every((head) => {
    const title = head.querySelector(".workbench-group-title").getBoundingClientRect();
    const link = head.querySelector("a").getBoundingClientRect();
    return link.left >= title.right && Math.abs(link.top - title.top) < 12;
  })));
  await capture(cards, "cards-desktop");
  await cards.getByRole("link", { name: "查看全部：我创建的" }).click();
  await page.waitForURL("**/workbench/createdByMe");
  await page.getByRole("region", { name: "我创建的" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workbench-group-list .workbench-item-row").length === 50);
  await assertFooterAligned();
  await capture(page, "list-desktop");
  await page.getByRole("button", { name: /下一页/ }).click();
  await page.waitForURL("**/workbench/createdByMe?page=2");
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll(".workbench-group-list .workbench-item-row");
    return rows.length > 0 && rows.length < 50;
  });
  assert.equal(await page.getByRole("button", { name: /上一页/ }).isEnabled(), true);
  await page.locator(".workbench-group-list button.row-link").first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 375, height: 850 });
  await page.waitForFunction(() => document.querySelector(".shell-sidebar")?.getAttribute("data-open") !== "true");
  await assertFooterAligned();
  await capture(page, "list-mobile");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("link", { name: "返回工作台" }).click();
  await page.waitForURL("**/workbench");
  await cards.getByRole("link", { name: "查看全部：我创建的" }).waitFor();
  await cards.locator(".panel").first().evaluate((panel) => panel.scrollIntoView({ block: "start" }));
  await capture(page, "cards-mobile");
  assert.ok(await cards.evaluate((grid) => grid.scrollWidth <= grid.clientWidth));
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "深色", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("theme-dark"));
  await capture(page, "cards-dark");
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`${base}/workbench/createdByMe?page=2`);
  await page.getByRole("region", { name: "我创建的" }).waitFor();
  // 清除真实会话 cookie，再点击下一页触发业务请求；应用壳仍持有缓存身份。
  await context.clearCookies({ name: "feronavi_session" });
  // SSE 等后台请求也可能先发现失效；只在仍处于列表时触发一次新的分页请求。
  await page.evaluate(() => {
    if (location.pathname.startsWith("/workbench/")) {
      document.querySelector(".page-pagination button:not(:disabled)")?.click();
    }
  });
  await page.waitForURL((url) => url.pathname === "/login");
  await page.getByRole("heading", { name: "登录" }).waitFor();
  const target = new URL(page.url()).searchParams.get("returnTo");
  assert.ok(target?.startsWith("/workbench/createdByMe"));
  await login();
  await page.getByRole("region", { name: "我创建的" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/workbench/createdByMe");
  assert.deepEqual(errors, []);
  console.log("工作台分组浏览器验收通过：标题链接、完整列表、分页、详情、窄屏、深色、会话失效与重新登录");
  console.log(`截图：${output}`);
} finally { await context.close(); await browser.close(); }
