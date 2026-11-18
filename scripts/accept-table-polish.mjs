import "./_env.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { installTableFixtures, tableRoutes } from "./table-scroll-fixtures.mjs";

const BASE = process.env.BASE;
assert(BASE, "通过 run-isolated-test.ts --browser 运行");
const directory = ".cache/table-polish-2026-11-09/acceptance";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ locale: "zh-CN", reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const checks = [], errors = [];
page.on("pageerror", error => errors.push(error.message));

async function visit(path, setup) {
  await page.goto(BASE + path);
  await page.locator(".page-header h1").waitFor();
  if (setup) await setup(page);
  await page.waitForTimeout(120);
}

async function inspect(label, table = false) {
  const bounds = await page.locator(".shell-content").evaluate(el => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    const header = el.querySelector(".page-header").getBoundingClientRect();
    return { width: innerWidth, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      rootPadding: getComputedStyle(el.firstElementChild).padding,
      x: document.documentElement.scrollWidth - innerWidth,
      top: header.top - rect.top, left: header.left - rect.left,
      scroll: el.scrollHeight - el.clientHeight, bottom: rect.bottom };
  });
  const inset = bounds.width <= 760 ? 16 : bounds.width <= 1024 ? 20 : 24;
  assert.deepEqual(bounds.padding, Array(4).fill(`${inset}px`), `${label}: 主体四边间距`);
  assert.equal(bounds.rootPadding, "0px", `${label}: 页面重复添加间距`);
  assert.equal(bounds.x, 0, `${label}: 页面横向溢出`);
  assert(Math.abs(bounds.top - inset) < 1 && Math.abs(bounds.left - inset) < 1, `${label}: 标题未与主体对齐`);
  if (table) {
    assert(bounds.scroll <= 1, `${label}: 表格外层出现滚动`);
    const scroll = page.locator(".data-scroll:visible").first();
    await scroll.waitFor();
    const box = await scroll.boundingBox();
    assert(box.height >= 100 && box.y + box.height <= bounds.bottom - inset + 1, `${label}: 表格越界`);
    if (bounds.width > 900) {
      const fonts = await scroll.locator("th").evaluateAll(elements => elements.map(el => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight })));
      for (const font of fonts) assert.deepEqual(font, { size: "12px", weight: "500" }, `${label}: 表头字级不一致`);
      const cells = await scroll.locator("tbody tr:first-child > td").evaluateAll(elements => elements.map(el => ({ size: getComputedStyle(el).fontSize, height: el.getBoundingClientRect().height })));
      for (const cell of cells) assert(["13px", "14px"].includes(cell.size) && cell.height >= 52, `${label}: 数据行字级/行高不一致`);
    }
    if (bounds.width <= 720 && await scroll.locator('.audit-table').count()) {
      const record = await scroll.locator('tbody tr').first().evaluate(row => {
        const cells = [...row.children];
        return {
          contentFits: cells.every(cell => [...cell.children].every(child => child.getBoundingClientRect().bottom <= cell.getBoundingClientRect().bottom + 1)),
          actionLabel: getComputedStyle(cells.at(-1), '::before').display,
          actionTop: cells.at(-1).getBoundingClientRect().top,
          timeTop: cells.at(-2).getBoundingClientRect().top,
        };
      });
      assert(record.contentFits, `${label}: 手机审计记录内容越出单元格`);
      assert.equal(record.actionLabel, 'none', `${label}: 详情标签重复`);
      assert(Math.abs(record.actionTop - record.timeTop) < 1, `${label}: 时间与详情未在同一行`);
    }
  }
  checks.push(label);
}

try {
  await page.goto(BASE + "/login");
  await page.getByLabel("用户名", { exact: false }).fill("demo");
  await page.getByLabel("密码", { exact: false }).fill("demo-password-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(url => !url.pathname.endsWith("/login"));
  const project = (await (await context.request.get(BASE + "/api/v1/projects")).json()).items[0];
  assert(project);
  const pages = [
    ["workbench", "/workbench"], ["project-cards", "/projects", async p => p.getByRole("button", { name: "卡片视图", exact: true }).click()], ["project-overview", `/projects/${project.id}`],
    ["personal", "/settings/personal"], ["integrations", "/settings/integrations"], ["instance", "/settings/instance"],
    ["system", "/system"], ["focus", "/focus"], ["announcements", "/announcements"],
    ["notifications", "/notifications"], ["changelog", "/changelog"], ["roles", "/admin/roles"],
    ...["board", "calendar", "timeline", "wiki", "intake", "workflow", "automation", "insights", "import"].map(name => [name, `/projects/${project.id}/${name}`]),
  ];
  const variants = [["desktop-light", "light", 1440, 950], ["desktop-dark", "dark", 1440, 950],
    ["mobile-light", "light", 390, 844], ["mobile-dark", "dark", 390, 844]];
  for (const [variant, theme, width, height] of variants) {
    await page.setViewportSize({ width, height });
    await context.addCookies([{ name: "feronavi_theme", value: theme, url: BASE }]);
    for (const [name, path, setup] of pages) {
      await visit(path, setup);
      await inspect(`${variant}/${name}`);
      await page.screenshot({ path: `${directory}/${variant}-${name}.png` });
    }
    console.log(`${variant}: ${pages.length} 个主页面间距通过`);
  }

  const state = await installTableFixtures(page, project);
  for (const [variant, theme, width, height] of variants) {
    await page.setViewportSize({ width, height });
    await context.addCookies([{ name: "feronavi_theme", value: theme, url: BASE }]);
    for (const [name, path, setup] of tableRoutes(project.id)) {
      await visit(path, setup);
      await inspect(`${variant}/${name}/table`, true);
      await page.screenshot({ path: `${directory}/${variant}-table-${name}.png` });
    }
    console.log(`${variant}: 16 个列表的间距、字级、行高通过`);
  }

  for (const [width, height] of [[1440, 950], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await visit(`/projects/${project.id}/table`);
    const row = page.locator(".table-view-table tbody tr").first();
    const checkbox = row.getByRole("checkbox");
    await checkbox.click();
    assert.equal(await checkbox.getAttribute("aria-checked"), "true");
    const selectedColor = await row.locator("td").first().evaluate(el => getComputedStyle(el).backgroundColor);
    await page.screenshot({ path: `${directory}/selected-${width}.png` });
    await checkbox.press("Space");
    assert.equal(await checkbox.getAttribute("aria-checked"), "false");
    assert.notEqual(await row.locator("td").first().evaluate(el => getComputedStyle(el).backgroundColor), selectedColor);
    await page.getByRole("button", { name: "按优先级排序", exact: true }).click();
    await page.locator("th[aria-sort=ascending]").waitFor();
    assert.equal(await page.locator("th[aria-sort=ascending]").count(), 1);
    await inspect(`${width}/勾选与键盘取消及排序`, true);
    if (width === 390) {
      assert(await page.locator(".table-select-all-label").isVisible());
      await page.getByRole("checkbox", { name: "全选", exact: true }).click();
      assert.equal(await page.locator("tbody [role=checkbox][aria-checked=false]").count(), 0);
      await page.getByRole("checkbox", { name: "全选", exact: true }).click();
    }
    await visit("/members");
    await page.getByPlaceholder("搜索姓名/工号/邮箱").fill("member1@example.invalid");
    await page.waitForTimeout(150);
    assert.equal(await page.locator(".members-table tbody tr").count(), 1);
    await page.getByRole("button", { name: "归属", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${directory}/member-drawer-${width}.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    checks.push(`${width}/成员搜索与抽屉`);
  }
  state.count = 0;
  for (const path of ["/members", "/admin/audit", `/projects/${project.id}/table`, `/projects/${project.id}/import`]) {
    await visit(path);
    if (path.endsWith("/import")) await page.getByRole("tab", { name: "导入记录", exact: true }).click();
    await inspect(`空态/${path}`);
  }
  assert.deepEqual(errors, [], "浏览器运行错误");
  writeFileSync(`${directory}/results.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(`表格视觉与主体间距：${checks.length} 项通过`);
} finally {
  await context.close();
  await browser.close();
}
