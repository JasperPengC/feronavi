/** 隔离实例上的三引擎页面与真实交互验收；空页探针由 Linux runner 提供。 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

const probeOnly = process.env.BROWSER_PROBE_ONLY === "1";
if (!probeOnly) assertIsolatedTestEnvironment();
const BASE = process.env.BASE;
if (!probeOnly && !BASE) throw new Error("浏览器验收需要隔离 runner 提供 BASE");
const reportDirectory = process.env.A11Y_REPORT_DIR ?? ".cache/a11y";
mkdirSync(reportDirectory, { recursive: true });
const launchers = { Chromium: chromium, Firefox: firefox, WebKit: webkit };
const requested = process.env.BROWSERS?.split(",").map((value) => value.trim().toLowerCase());
if (requested?.some((value) => !Object.keys(launchers).some((name) => name.toLowerCase() === value))) {
  throw new Error("BROWSERS 只能选择 Chromium、Firefox、WebKit；未知或空引擎不能计为通过");
}
const selected = Object.entries(launchers).filter(([name]) => !requested || requested.includes(name.toLowerCase()));
const pages = [
  ["/workbench", "我的工作台"], ["/projects", "全部项目"], ["/issues", "问题追踪"],
  ["/members", "成员"], ["/settings/personal", "个人偏好"], ["/system", "系统自检"],
];
const report = {
  startedAt: new Date().toISOString(), probeOnly,
  runtime: { platform: process.platform, architecture: process.arch, node: process.version, playwright: createRequire(import.meta.url)("playwright/package.json").version },
  engines: [], checks: [],
};
const check = (name, pass, details = undefined) => {
  report.checks.push({ name, pass, ...(details === undefined ? {} : { details }) });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${details === undefined ? "" : ` ${typeof details === "string" ? details : JSON.stringify(details)}`}`);
};
async function bounded(promise, label, timeout = 15_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超过 ${timeout}ms 未就绪`)), timeout); })]); }
  finally { clearTimeout(timer); }
}
const pendingRequests = new WeakMap();
function trackRequests(page) {
  const state = { active: new Set(), changedAt: Date.now() };
  pendingRequests.set(page, state);
  const finiteApi = request => new URL(request.url()).pathname.startsWith("/api/") && !new URL(request.url()).pathname.endsWith("/events");
  page.on("request", request => { if (finiteApi(request)) { state.active.add(request); state.changedAt = Date.now(); } });
  const finish = request => { if (state.active.delete(request)) state.changedAt = Date.now(); };
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
}
async function settleRequests(page) {
  // 阶段间等待写后 SSE 刷新完成；WebKit 会将主动导航取消的 fetch 记为 access-control pageerror。
  const state = pendingRequests.get(page);
  await bounded((async () => {
    while (state.active.size || Date.now() - state.changedAt < 150) await new Promise(resolve => setTimeout(resolve, 25));
  })(), "阶段间请求收敛");
}
async function navigate(page, url) {
  await settleRequests(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
}
async function reload(page) {
  await settleRequests(page);
  await page.reload({ waitUntil: "domcontentloaded" });
}
async function chooseTheme(page, theme) {
  const syncPreference = !!(await page.locator(".shell-header").count());
  const select = async () => {
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("menu", { name: "主题", exact: true }).getByRole("menuitemradio", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
  };
  // 同时接住交互和网络等待的失败，保留 WebKit trace，避免悬空 promise 提前终止进程。
  if (syncPreference) {
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/v1/me/preferences") && response.request().method() === "PUT"),
      select(),
    ]);
    assert.equal(response.status(), 200);
  } else await select();
  await page.waitForFunction((expected) => document.documentElement.classList.contains(`theme-${expected}`), theme);
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(reportDirectory, `${name}.png`), animations: "disabled" });
}
async function interactions(page, label, artifact, theme, mobile) {
  await navigate(page, `${BASE}/projects`);
  await page.getByRole("button", { name: "新建项目", exact: true }).first().waitFor();
  await chooseTheme(page, theme === "dark" ? "light" : "dark");
  await chooseTheme(page, theme);
  await reload(page);
  await page.waitForFunction((expected) => document.documentElement.classList.contains(`theme-${expected}`), theme);
  check(`${label}：主题菜单切换与刷新保留`, true);

  if (mobile) {
    await page.locator(".shell-menu-button").click();
    await page.locator('.shell-sidebar[data-open="true"]').waitFor();
    assert.equal(await page.locator(".shell-main-col").getAttribute("inert"), "");
    await page.keyboard.press("Escape");
    await page.locator('.shell-sidebar[data-open="false"]').waitFor({ state: "attached" });
    assert.equal(await page.locator(".shell-main-col").getAttribute("inert"), null);
    assert.equal(await page.locator(".shell-menu-button").evaluate((element) => element === document.activeElement), true);
  } else {
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  }
  await page.locator(".profile-trigger").click();
  await page.locator(".shell-user-menu").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".shell-user-menu").waitFor({ state: "hidden" });
  check(`${label}：导航与用户菜单可操作`, true);

  const trigger = page.getByRole("button", { name: "新建项目", exact: true }).first();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "新建项目", exact: true });
  await drawer.waitFor();
  assert.equal(await page.locator("#root").getAttribute("inert"), "");
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.equal(await page.locator("#root").getAttribute("inert"), null);
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.click();
  const key = `X${Date.now().toString(36).toUpperCase()}`;
  const title = `跨浏览器验收 ${artifact}`;
  const submit = drawer.getByRole("button", { name: "创建", exact: true });
  assert.equal(await submit.isEnabled(), false);
  await drawer.locator("#p-key").fill(key);
  await drawer.locator("#p-name").fill(title);
  await screenshot(page, `${artifact}-project-form`);
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v1/projects") && response.request().method() === "POST"),
    submit.click(),
  ]);
  assert.equal(response.status(), 201, await response.text());
  const project = await response.json();
  await drawer.waitFor({ state: "hidden" });
  await reload(page);
  await page.getByRole("link", { name: new RegExp(title, "u") }).first().waitFor();
  check(`${label}：抽屉焦点恢复、项目表单校验与写入持久化`, true);

  await navigate(page, `${BASE}/projects/${project.id}/board`);
  await page.getByRole("button", { name: "新建工作项", exact: true }).click();
  const itemDialog = page.getByRole("dialog", { name: "新建工作项", exact: true });
  const itemTitle = `工作项 ${artifact}`;
  await itemDialog.getByRole("textbox", { name: "标题", exact: true }).fill(itemTitle);
  // 同时等待点击、创建与自动展开详情；所有拒绝都有接收方，便于保留失败截图和 trace。
  const [itemCreated, ...detailResponses] = await Promise.all([
    page.waitForResponse((result) => result.url().endsWith(`/api/v1/projects/${project.id}/work-items`) && result.request().method() === "POST"),
    ...["", "/links", "/sla", "/approvals", "/children"].map(suffix => page.waitForResponse(response => {
      const path = new URL(response.url()).pathname;
      return new RegExp(`^/api/v1/work-items/[^/]+${suffix}$`, "u").test(path) && response.request().method() === "GET";
    })),
    itemDialog.getByRole("button", { name: "创建", exact: true }).click(),
  ]);
  assert.equal(itemCreated.status(), 201);
  await itemDialog.waitFor({ state: "hidden" });
  for (const response of detailResponses) if (response) { assert.equal(response.status(), 200); await response.finished(); }
  await page.locator(".work-item-detail").getByRole("heading", { name: itemTitle, exact: true }).waitFor();
  await reload(page);
  await page.getByRole("button", { name: itemTitle, exact: true }).click();
  await page.locator(".work-item-detail").getByRole("heading", { name: itemTitle, exact: true }).waitFor();
  await page.waitForFunction(() => {
    const box = document.querySelector(".work-item-detail")?.getBoundingClientRect();
    return !!box && Math.abs(box.right - innerWidth) < 1 && box.left >= -1;
  });
  await screenshot(page, `${artifact}-work-item-drawer`);
  await page.locator(".work-item-detail").getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".work-item-detail").waitFor({ state: "hidden" });
  check(`${label}：工作项表单写入、刷新与详情抽屉`, true);
}

for (const [name, launcher] of selected) {
  let browser;
  const engine = { name, probe: false };
  report.engines.push(engine);
  try {
    browser = await launcher.launch({ timeout: 60_000 });
    const probe = await bounded(browser.newContext(), `${name} 空白上下文`);
    try {
      const page = await bounded(probe.newPage(), `${name} 空白页`);
      await page.setContent("<title>Linux engine probe</title><button>ready</button>");
      assert.equal(await page.title(), "Linux engine probe");
      await page.getByRole("button", { name: "ready" }).click();
    } finally { await bounded(probe.close(), `${name} 空白上下文清理`); }
    Object.assign(engine, { version: browser.version(), probe: true });
    check(`${name}：空白页面创建、脚本与点击`, true);
    if (probeOnly) continue;
    for (const theme of ["light", "dark"]) for (const mobile of [false, true]) {
      const artifact = `cross-${name.toLowerCase()}-${theme}-${mobile ? "mobile" : "desktop"}`;
      const label = `${name} ${theme} ${mobile ? "390×844" : "1440×950"}`;
      let context;
      let page;
      const errors = [];
      let failed = false;
      try {
        context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 950 }, locale: "zh-CN", colorScheme: theme, ...(name === "Firefox" ? {} : { isMobile: mobile }), hasTouch: mobile });
        context.setDefaultTimeout(15_000);
        context.setDefaultNavigationTimeout(30_000);
        await context.tracing.start({ screenshots: true, snapshots: true });
        page = await bounded(context.newPage(), `${name} 页面`);
        trackRequests(page);
        page.on("pageerror", (error) => errors.push({ type: "pageerror", message: error.message }));
        page.on("console", (message) => { if (message.type() === "error") errors.push({ type: "console", message: message.text() }); });
        await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
        await chooseTheme(page, theme);
        await page.locator("#username").fill(process.env.A11Y_USERNAME ?? "demo");
        await page.locator("#password").fill(process.env.A11Y_PASSWORD ?? "demo-password-12345");
        const login = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST");
        await page.locator('form button[type="submit"]').click();
        assert.equal((await login).status(), 200);
        await page.locator(".shell-header").waitFor();
        await chooseTheme(page, theme);
        check(`${label}：真实登录表单`, true);
        for (const [path, expected] of pages) {
          await navigate(page, BASE + path);
          await page.locator(".shell-header").waitFor();
          await page.waitForFunction((text) => document.querySelector("main")?.textContent?.includes(text), expected);
          await page.waitForFunction((value) => document.documentElement.classList.contains(`theme-${value}`), theme);
          await page.evaluate(() => document.fonts.ready);
          const state = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth + 2,
            shell: !!document.querySelector(".shell-header") && !!document.querySelector(".shell-footer"),
            width: innerWidth, theme: document.documentElement.className,
          }));
          check(`${label}：${path} 渲染`, !state.overflow && state.shell, state);
          if (state.overflow || !state.shell) failed = true;
          await screenshot(page, `${artifact}-${path.slice(1).replaceAll("/", "-")}`);
        }
        await interactions(page, label, artifact, theme, mobile);
      } catch (error) {
        failed = true;
        check(`${label}：运行`, false, error.stack ?? String(error));
        if (page) await screenshot(page, `${artifact}-failure`).catch(() => {});
      } finally {
        if (errors.length) failed = true;
        check(`${label}：无 JS/控制台错误`, errors.length === 0, errors);
        if (context) {
          await context.tracing.stop(failed ? { path: join(reportDirectory, `${artifact}-failure.zip`) } : {}).catch(() => {});
          await bounded(context.close(), `${name} 上下文清理`);
        }
      }
    }
  } catch (error) {
    engine.error = error.message;
    if (/空白页 超过|Executable doesn't exist|browserType\.launch/u.test(error.message)) {
      engine.skipped = true;
      console.log(`  SKIP ${name}：当前宿主浏览器运行环境不可用 ${error.message}`);
    } else {
      check(`${name}：引擎运行`, false, error.stack ?? String(error));
    }
  } finally { if (browser) await bounded(browser.close(), `${name} 浏览器清理`).catch((error) => check(`${name}：清理`, false, error.message)); }
}
report.finishedAt = new Date().toISOString();
report.passed = report.checks.length > 0 && report.checks.every((item) => item.pass);
writeFileSync(join(reportDirectory, probeOnly ? "probe-results.json" : "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\n跨浏览器验收 ${report.checks.filter((item) => item.pass).length}/${report.checks.length}`);
process.exitCode = report.passed ? 0 : 1;
