import "./_env.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE;
const output = resolve(process.env.TOOLTIP_EVIDENCE_DIR ?? ".cache/tooltip-layout");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
const results = [];
const check = (name, condition) => { assert.ok(condition, name); results.push(name); };
const inside = async () => {
  const rect = await page.getByRole("tooltip").boundingBox();
  const viewport = page.viewportSize();
  check("提示完整保留在视口内", rect && rect.x >= 7 && rect.y >= 7 && rect.x + rect.width <= viewport.width - 7 && rect.y + rect.height <= viewport.height - 7);
  return rect;
};
const points = Array.from({ length: 28 }, (_, i) => ({ d: `2026-10-${String(i + 1).padStart(2, "0")}`, n: 0 }));
let dense = false;
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("用户名", { exact: false }).fill("demo");
  await page.getByLabel("密码", { exact: false }).fill("demo-password-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.route("**/activity-series?*", async (route) => {
    const activity = points.map((p, i) => ({ ...p, n: dense ? i % 7 : 0 }));
    const created = points.map((p, i) => ({ ...p, n: i === 7 || i === 27 ? 4 : 0 }));
    await route.fulfill({ json: { metric: "按项目内事件统计", points: activity, series: { activity, created } } });
  });
  for (const theme of ["light", "dark"]) {
    await context.addCookies([{ name: "feronavi_theme", value: theme, url: base }]);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`${base}/workbench`);
      const chart = page.locator(".workbench-sparse-trend");
      await chart.waitFor();
      await chart.scrollIntoViewIfNeeded();
      const heights = await chart.locator(".workbench-sparse-bar").evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
      const plotHeight = await chart.locator(".workbench-sparse-bars").first().evaluate((el) => el.getBoundingClientRect().height);
      check(`${theme}/${width} 数值 4 到达刻度 4，零值不绘制假柱`, heights.every((height) => height === 0 || Math.abs(height - plotHeight) < 1) && heights.filter((height) => height > 0).length === 2);
      for (const index of [0, 1, 3]) {
        const target = chart.locator(".workbench-sparse-week").nth(index);
        const box = await target.boundingBox();
        const mouse = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(mouse.x, mouse.y);
        await page.getByRole("tooltip").waitFor();
        const rect = await inside();
        check("提示在触发位置附近，而非卡片标题位置", Math.min(Math.abs(rect.x - mouse.x), Math.abs(rect.x + rect.width - mouse.x)) <= 24 && Math.min(Math.abs(rect.y - mouse.y), Math.abs(rect.y + rect.height - mouse.y)) <= 24);
        await page.mouse.click(mouse.x, mouse.y);
        const clicked = await inside();
        check("点击数据后不跳回整列顶部", Math.min(Math.abs(clicked.y - mouse.y), Math.abs(clicked.y + clicked.height - mouse.y)) <= 24);
        await page.screenshot({ path: `${output}/${theme}-${width}-week-${index}.png` });
        await page.keyboard.press("Escape");
        check("Escape 关闭提示", await page.getByRole("tooltip").count() === 0);
      }
      await page.keyboard.press("Tab");
      await chart.locator(".workbench-sparse-week").last().focus();
      await inside();
      await page.keyboard.press("Tab");
      check("离开焦点关闭提示", await page.getByRole("tooltip").count() === 0);
      await chart.locator(".workbench-sparse-week").first().hover();
      await chart.locator(".workbench-sparse-week").last().hover();
      check("跨数据点移动不叠加旧提示", await page.getByRole("tooltip").count() === 1);
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  dense = true;
  await page.reload();
  const point = page.locator(".workbench-trend svg rect").last();
  await point.hover();
  await inside();
  check("连续趋势提示显示所指日期", (await page.getByRole("tooltip").innerText()).includes("2026-10-28"));
  await page.keyboard.press("Escape");
  await page.locator(".workbench-chart-panel .info-tip-trigger").click();
  check("说明图标点击后提示保持显示", await page.getByRole("tooltip").count() === 1);
  await inside();
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(150);
  check("滚动后提示不留在旧位置", await page.getByRole("tooltip").count() === 0);

  await page.goto(`${base}/issues`);
  await page.getByRole("button", { name: "展开趋势与分布" }).click();
  await page.locator(".issues-trend-day").last().waitFor();
  const dateLabels = await page.locator(".issues-trend-dates span").allTextContents();
  check("问题趋势保留14个数据点与4个月日轴标签", await page.locator(".issues-trend-day").count() === 14
    && dateLabels.length === 4 && dateLabels.every((date) => /^\d{2}-\d{2}$/.test(date)));
  await page.locator(".issues-trend-day").last().hover();
  await inside();

  const projectId = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  const iteration = { id: "11111111-1111-4111-8111-111111111111", name: "图表定位验收", startDate: "2026-10-01", endDate: "2026-10-28" };
  // 仅替换当前浏览器的图表响应，用非空、多数据点覆盖演示数据不具备的状态。
  await page.route(`**/projects/${projectId}/iterations`, route => route.fulfill({ json: [iteration] }));
  await page.route(`**/iterations/${iteration.id}/burndown`, route => route.fulfill({ json: {
    iteration, metric: "剩余点数为本次迭代范围内尚未完成的故事点。".repeat(8),
    points: points.map((p, i) => ({ date: p.d, scope: 28, done: i, remaining: 28 - i, ideal: 28 - i, source: "snapshot" })),
  } }));
  await page.route(`**/iterations/${iteration.id}/cumulative-flow`, route => route.fulfill({ json: {
    iteration, metric: "按状态统计每日工作项数量", categories: ["NOT_STARTED", "IN_PROGRESS", "TERMINAL"],
    series: points.map((p, i) => ({ date: p.d, NOT_STARTED: 28 - i, IN_PROGRESS: 2, TERMINAL: i, total: 30 })),
  } }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${base}/projects/${projectId}/insights`);
    for (const chartIndex of [0, 1]) {
      const marks = page.locator(".insight-chart-card").nth(chartIndex).locator("svg rect");
      await marks.first().waitFor();
      const count = await marks.count();
      for (const index of [0, Math.floor(count / 2), count - 1]) {
        const mark = marks.nth(index);
        await mark.scrollIntoViewIfNeeded();
        const box = await mark.boundingBox();
        await mark.hover();
        const rect = await inside();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        check(`洞察 ${chartIndex}/${width} 提示贴近所指数据`, Math.min(Math.abs(rect.x - x), Math.abs(rect.x + rect.width - x)) <= 24 && Math.min(Math.abs(rect.y - y), Math.abs(rect.y + rect.height - y)) <= 24);
        await page.keyboard.press("Escape");
      }
    }
    await page.getByRole("button", { name: "燃尽图口径", exact: true }).click();
    await inside();
    await page.screenshot({ path: `${output}/insight-long-tip-${width}.png` });
    await page.keyboard.press("Escape");
    await page.goto(`${base}/admin/audit`);
    const dates = page.locator("input[type=date]");
    await dates.first().waitFor();
    check(`日期筛选 ${width} 保持单行输入框高度`, (await dates.first().boundingBox()).height <= 48);
  }

  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${base}/workbench`);
    for (const name of ["账户菜单", "主题"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.click();
      const rect = await page.getByRole("menu").boundingBox();
      check(`${width}/${name} 菜单在屏幕内`, rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= 950);
      await page.keyboard.press("Escape");
      check(`${width}/${name} 关闭后归还焦点`, await trigger.evaluate(el => el === document.activeElement));
    }
  }

  const touch = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const mobile = await touch.newPage();
    await mobile.goto(`${base}/settings/instance`);
    const info = mobile.locator(".info-tip-trigger").first();
    await info.tap();
    check("触摸第一次打开说明", await mobile.getByRole("tooltip").count() === 1);
    await info.tap();
    check("触摸再次关闭说明", await mobile.getByRole("tooltip").count() === 0);
  } finally { await touch.close(); }
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`悬浮提示与图表布局 ${results.length}/${results.length} 通过`);
} finally { await context.close(); await browser.close(); }
