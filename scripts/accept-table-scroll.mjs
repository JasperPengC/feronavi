import "./_env.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { installTableFixtures, tableRoutes } from "./table-scroll-fixtures.mjs";

const BASE = process.env.BASE;
assert(BASE, "通过 run-isolated-test.ts --browser 运行");
const directory = ".cache/table-scroll-2026-11-09/acceptance";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ locale: "zh-CN", reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const checks = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
const near = (a, b, label) => assert(Math.abs(a - b) <= 1, `${label}: ${a} → ${b}`);
async function visit(path, setup) {
  await page.goto(BASE + path);
  await page.locator(".page-header h1").waitFor();
  if (setup) await setup(page);
  await page.waitForTimeout(200);
}
async function fit(label) {
  const geometry = await page.locator(".shell-content").evaluate(el => ({
    scroll: el.scrollHeight - el.clientHeight,
    x: document.documentElement.scrollWidth - innerWidth,
    bottom: el.getBoundingClientRect().bottom,
  }));
  assert(geometry.scroll <= 1, `${label}: 外层滚动 ${geometry.scroll}`);
  assert(geometry.x <= 1, `${label}: 页面横向溢出 ${geometry.x}`);
  for (const element of await page.locator(".page-header, .page-tabs:visible, .page-pagination:visible, .data-scroll:visible").all()) {
    const box = await element.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= geometry.bottom + 1, `${label}: 内容越出主体视口`);
  }
}
try {
  await page.goto(BASE + "/login");
  await page.getByLabel("用户名", { exact: false }).fill("demo");
  await page.getByLabel("密码", { exact: false }).fill("demo-password-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(url => !url.pathname.endsWith("/login"));
  const response = await context.request.get(BASE + "/api/v1/projects");
  const project = (await response.json()).items[0];
  assert(project);
  const state = await installTableFixtures(page, project);
  const routes = tableRoutes(project.id);

  for (const [variant, theme, width, height] of [
    ["desktop-light", "light", 1440, 950], ["desktop-dark", "dark", 1440, 950],
    ["short-desktop", "light", 1280, 650],
    ["tablet-landscape", "light", 1024, 768], ["tablet-portrait", "dark", 768, 1024],
    ["mobile-light", "light", 390, 844], ["mobile-dark", "dark", 390, 844], ["small-mobile", "light", 360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await context.addCookies([{ name: "feronavi_theme", value: theme, url: BASE }]);
    for (const [name, path, setup] of routes) {
      await visit(path, setup);
      const scroll = page.locator(".data-scroll:visible").first();
      await scroll.waitFor();
      await fit(`${variant}/${name}`);
      const geometry = await scroll.evaluate(el => ({ h: el.clientHeight, sh: el.scrollHeight }));
      assert(geometry.h >= 100 && geometry.sh > geometry.h, `${variant}/${name}: 缺少可用数据区 ${JSON.stringify(geometry)}`);
      const head = scroll.locator("thead");
      const hasHead = await head.count() && await head.evaluate(el => getComputedStyle(el).display !== "none" && getComputedStyle(el).clipPath === "none");
      const headerBefore = hasHead ? await head.boundingBox() : null;
      const pageHead = await page.locator(".page-header").boundingBox();
      const pagination = page.locator(".page-pagination");
      const footerBefore = await pagination.count() ? await pagination.boundingBox() : null;
      const row = scroll.locator("tbody tr, .activity-list > li").first();
      const rowBefore = await row.boundingBox();
      await page.screenshot({ path: `${directory}/${variant}-${name}.png` });
      await scroll.hover();
      await page.mouse.wheel(0, 480);
      await page.waitForTimeout(180);
      assert(await scroll.evaluate(el => el.scrollTop) > 0, `${name}: 滚轮未移动数据`);
      near((await page.locator(".page-header").boundingBox()).y, pageHead.y, `${name}: 标题移动`);
      assert((await row.boundingBox()).y < rowBefore.y, `${name}: 数据行未移动`);
      if (headerBefore) near((await head.boundingBox()).y, headerBefore.y, `${name}: 表头移动`);
      if (footerBefore) near((await pagination.boundingBox()).y, footerBefore.y, `${name}: 分页移动`);
      assert.equal(await page.locator(".shell-content").evaluate(el => el.scrollTop), 0);

      if (await scroll.evaluate(el => el.scrollWidth > el.clientWidth + 1)) {
        await page.mouse.wheel(300, 0);
        await page.waitForTimeout(160);
        assert(await scroll.evaluate(el => el.scrollLeft) > 0, `${name}: 横滚不可用`);
        if (hasHead) {
          const cells = await scroll.evaluate(el => [...el.querySelectorAll("thead th")].map((th, i) => {
            const td = el.querySelector("tbody tr")?.children[i];
            return td ? [th.getBoundingClientRect().x, td.getBoundingClientRect().x] : null;
          }).filter(Boolean));
          cells.forEach(([x, bodyX]) => near(x, bodyX, `${name}: 表头与数据错列`));
        }
        checks.push(`${variant}/${name}/横滚对齐`);
      }
      await scroll.focus();
      const beforeKey = await scroll.evaluate(el => el.scrollTop);
      await scroll.press("PageUp");
      await page.waitForTimeout(180);
      assert(await scroll.evaluate(el => el.scrollTop) < beforeKey, `${name}: 键盘滚动不可用`);
      if (footerBefore) {
        await pagination.getByRole("button", { name: "下一页" }).click();
        await page.waitForTimeout(200);
        assert.equal(await page.locator(".data-scroll").first().evaluate(el => el.scrollTop), 0, `${name}: 翻页未回到首行`);
        await pagination.getByRole("button", { name: "上一页" }).click();
      }
      await fit(`${variant}/${name}/滚动后`);
      checks.push(`${variant}/${name}/滚动与键盘分页`);
    }
    console.log(`${variant}: ${routes.length} 个列表通过`);
  }

  // 展开状态和筛选动作不能将表格或分页挤出屏幕。
  for (const [width, height] of [[1440, 950], [1280, 650], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await visit("/issues");
    await page.locator(".issues-insights-toggle").click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${directory}/issues-insights-${width}.png` });
    assert(await page.getByRole("dialog").getByText("近 14 天缺陷趋势").isVisible());
    // 抽屉出现后，鼠标可能正好停在图表上；Escape 先关闭最上层提示，再关闭抽屉。
    if (await page.getByRole("tooltip").count()) {
      await page.keyboard.press("Escape");
      await page.getByRole("tooltip").waitFor({ state: "hidden" });
      assert(await page.getByRole("dialog").isVisible());
    }
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.locator(".issues-filter-toggle").click();
    await fit("问题展开统计与筛选");
    assert((await page.locator(".data-scroll").boundingBox()).height >= 100, "展开问题筛选后数据区不足");
    await page.screenshot({ path: `${directory}/issues-expanded-${width}.png` });
    await visit(`/projects/${project.id}/fields`);
    await page.locator(".page-header button[aria-controls=custom-field-create]").click();
    await fit("字段创建表单");
    assert((await page.locator(".data-scroll").boundingBox()).height >= 100);
    await page.screenshot({ path: `${directory}/fields-expanded-${width}.png` });
    checks.push(`${width}/展开统计筛选与字段表单`);
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await visit("/admin/audit");
  await page.locator(".data-scroll").hover();
  await page.mouse.wheel(0, 500);
  await page.locator(".audit-search").fill("work_item");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".data-scroll").evaluate(el => el.scrollTop), 0);
  checks.push("审计筛选回到首行");

  for (const [width, height] of [[1440, 950], [360, 740]]) {
    await page.setViewportSize({ width, height });
    await visit(`/projects/${project.id}/table`);
    const checkbox = page.locator(".table-view-table tbody tr").first().getByRole("checkbox");
    await checkbox.click();
    await fit("工作项批量选择");
    assert((await page.locator(".data-scroll").boundingBox()).height >= 100);
    await page.screenshot({ path: `${directory}/work-items-selected-${width}.png` });
    await checkbox.click();
    assert.equal(await page.locator(".table-batch-bar").count(), 0);
    checks.push(`${width}/批量选择和取消`);
  }

  for (const [width, height] of [[1440, 950], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await visit(`/projects/${project.id}/calendar`);
    await page.getByRole("button", { name: "未排期工作项", exact: true }).click();
    const dialog = page.getByRole("dialog"), body = dialog.locator(".ui-drawer-body");
    const pagination = dialog.locator(".page-pagination");
    await pagination.waitFor();
    await dialog.locator(".calendar-work-list > li").nth(29).waitFor({ state: "attached" });
    await page.screenshot({ path: `${directory}/calendar-drawer-initial-${width}.png` });
    const footer = await pagination.boundingBox();
    assert(footer.y + footer.height <= height);
    await body.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);
    assert(await body.evaluate(el => el.scrollTop) > 0, `日历抽屉 ${width}: ${JSON.stringify(await body.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight, rect: el.getBoundingClientRect().toJSON() })))}`);
    near((await pagination.boundingBox()).y, footer.y, "日历抽屉分页移动");
    await pagination.getByRole("button", { name: "下一页" }).click();
    await page.waitForTimeout(150);
    assert.equal(await body.evaluate(el => el.scrollTop), 0);
    await page.screenshot({ path: `${directory}/calendar-drawer-${width}.png` });
    await page.keyboard.press("Escape");
    checks.push(`${width}/日历抽屉分页`);
  }

  for (const count of [0, 1]) {
    state.count = count;
    for (const [name, path, setup] of routes.filter(([name]) => name !== "projects")) {
      await visit(path, setup);
      await fit(`${name}/${count}条`);
      if (name === "members" && count === 0) {
        await page.getByText("还没有成员", { exact: true }).waitFor();
        await page.locator(".ui-state-empty").getByRole("button", { name: "创建成员", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
      }
      checks.push(`${name}/${count}条`);
    }
  }

  // 恢复真实 API，覆盖夹具之外的渲染与重试路径。
  await page.unrouteAll({ behavior: "wait" });
  await page.setViewportSize({ width: 1440, height: 950 });
  for (const [name, path, setup] of routes) {
    await visit(path, setup);
    await page.locator(".ui-loading:visible, .ui-state-loading:visible").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".page [role=alert]").count(), 0, `${name}: 真实接口加载错误`);
    await fit(`${name}/真实接口`);
    await page.screenshot({ path: `${directory}/real-${name}.png` });
    checks.push(`${name}/真实接口`);
  }
  const realAudit = await context.request.get(BASE + "/api/v1/audit-entries?page=1&pageSize=30");
  assert.equal(realAudit.status(), 200);
  const auditResult = await realAudit.json();
  await visit("/admin/audit");
  assert.equal(await page.locator(".audit-table tbody tr").count(), auditResult.items.length);
  assert(auditResult.items.length > 0);

  for (const [name, path, setup, endpoint] of [
    ["audit", "/admin/audit", null, "**/api/v1/audit-entries?*"],
    ["members", "/members", null, "**/api/v1/members"],
    ["issues", "/issues", null, /\/api\/v1\/issues\?/],
    ["work-items", `/projects/${project.id}/table`, null, /\/work-items\?.*view=table/],
    ["imports", `/projects/${project.id}/import`, routes.find(([name]) => name === "imports")[2], `**/projects/${project.id}/imports`],
  ]) {
    const fail = route => route.fulfill({ status: 503, json: { code: "INTERNAL", message: "暂时不可用" } });
    await page.route(endpoint, fail);
    await visit(path, setup);
    const alert = page.locator(".page [role=alert]");
    await alert.waitFor();
    const retry = alert.getByRole("button", { name: "重新载入", exact: true });
    await retry.waitFor();
    await fit(`${name}/读取失败`);
    await page.unroute(endpoint, fail);
    await retry.click();
    await alert.waitFor({ state: "hidden" });
    await fit(`${name}/重试恢复`);
    checks.push(`${name}/错误提示和原位重试`);
  }
  assert.deepEqual(errors, [], "浏览器异常");
  writeFileSync(`${directory}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(`表格滚动验收通过：${checks.length} 项`);
} finally {
  await context.close();
  await browser.close();
}
