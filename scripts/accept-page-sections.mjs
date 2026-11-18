import "./_env.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// 真实浏览器验收；写操作只发生在 run-isolated-test 创建的随机数据库。
const BASE = process.env.BASE;
const directory = ".cache/page-tabs-2026-11-09/acceptance";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "zh-CN", reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => void dialog.accept());
const tab = name => page.locator(".page-tabs").getByRole("tab", { name, exact: true });
async function visit(path) {
  await page.goto(BASE + path);
  await page.locator(".page-header h1").waitFor();
  await page.waitForTimeout(300);
}
async function fit(label) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: 页面横向溢出`);
  const overflow = await page.locator(".page-tab-panel:visible").evaluateAll(panels => panels.filter(el => {
    const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1;
  }).length);
  assert.equal(overflow, 0, `${label}: 分区越界`);
}
try {
  await page.goto(BASE + "/login");
  await page.getByLabel("用户名", { exact: false }).fill("demo");
  await page.getByLabel("密码", { exact: false }).fill("demo-password-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(url => !url.pathname.endsWith("/login"));
  const pid = process.env.PROJECT_ID;
  assert(pid);
  const routes = [
    ["personal", "/settings/personal"], ["instance", "/settings/instance"], ["integrations", "/settings/integrations"],
    ["insights", `/projects/${pid}/insights`], ["import", `/projects/${pid}/import`], ["intake", `/projects/${pid}/intake`],
    ["planning", `/projects/${pid}/milestones`], ["members", "/members"], ["tokens", "/tokens"],
    ["system", "/system"], ["automation", `/projects/${pid}/automation`],
  ];
  for (const [variant, theme, width, height] of [
    ["light-desktop", "light", 1440, 950], ["dark-desktop", "dark", 1440, 950],
    ["light-mobile", "light", 390, 844], ["dark-mobile", "dark", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await context.addCookies([{ name: "feronavi_theme", value: theme, url: BASE }]);
    for (const [name, path] of routes) {
      await visit(path);
      const tabs = page.locator(".page-tabs [role=tab]");
      const count = await tabs.count();
      assert(count > 1, `${name}: 缺少页面分区`);
      for (let index = 0; index < count; index++) {
        await tabs.nth(index).click();
        await page.waitForTimeout(200);
        assert.equal(await page.locator(".page-tab-panel:visible").count(), 1);
        assert.equal(await tabs.nth(index).getAttribute("aria-selected"), "true");
        const panel = page.locator(".page-tab-panel:visible");
        assert.equal(await panel.getAttribute("aria-labelledby"), await tabs.nth(index).getAttribute("id"));
        assert.equal(await tabs.nth(index).getAttribute("aria-controls"), await panel.getAttribute("id"));
        await fit(`${variant}/${name}/${index}`);
        await page.screenshot({ path: `${directory}/${variant}-${name}-${index}.png` });
        checks.push(`${variant}/${name}/${await tabs.nth(index).innerText()}`);
      }
      await tabs.last().press("Home");
      assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
      await tabs.first().press("ArrowRight");
      assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
      await tabs.nth(1).press("End");
      assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
      assert.equal(await tabs.evaluateAll(items => items.filter(el => el.tabIndex === 0).length), 1);
      await tabs.last().press("Tab");
      assert.equal(await page.locator(".page-tab-panel:visible").evaluate(el => el === document.activeElement), true);
    }
    console.log(`${variant}: 33 个分区及键盘操作通过`);
  }

  await page.setViewportSize({ width: 1440, height: 950 });
  await visit("/settings/instance");
  const orgName = page.getByLabel("组织名称", { exact: true });
  await orgName.fill("未保存的组织草稿");
  await tab("邮件").click();
  await tab("组织信息").click();
  assert.equal(await orgName.inputValue(), "未保存的组织草稿");
  checks.push("组织设置跨分区保留草稿");

  await visit(`/projects/${pid}/intake`);
  await tab("收集表单").click();
  await page.getByLabel("表单名称", { exact: true }).fill("未保存的收集表单");
  await tab("提交队列").click();
  assert.equal(await page.getByLabel("表单名称", { exact: true }).isVisible(), false);
  await tab("收集表单").click();
  assert.equal(await page.getByLabel("表单名称", { exact: true }).inputValue(), "未保存的收集表单");
  checks.push("需求收集草稿和操作归属");

  await visit(`/projects/${pid}/automation`);
  await page.getByRole("button", { name: "新建规则", exact: true }).click();
  await page.getByLabel("规则名称", { exact: true }).fill("自动化草稿");
  await tab("SLA 策略").click();
  await tab("自动化规则").click();
  assert.equal(await page.getByLabel("规则名称", { exact: true }).inputValue(), "自动化草稿");
  checks.push("自动化规则切换后保留草稿");

  await visit(`/projects/${pid}/fields`);
  assert.equal(await page.locator("#custom-field-create").isVisible(), false);
  await page.getByRole("button", { name: "新建字段", exact: true }).click();
  await page.locator("#custom-field-create input").first().fill("draft_key");
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.getByRole("button", { name: "新建字段", exact: true }).click();
  assert.equal(await page.locator("#custom-field-create input").first().inputValue(), "draft_key");
  checks.push("自定义字段按需展开与草稿保留");

  await visit(`/projects/${pid}/import`);
  const picker = page.getByLabel("选择 CSV 或 Excel 文件");
  await picker.setInputFiles({ name: "tabs-acceptance.csv", mimeType: "text/csv", buffer: Buffer.from("标题,备注\n分区验收工作项,保留映射\n") });
  await tab("导入记录").click();
  await tab("导入工作项").click();
  assert.equal(await picker.evaluate(el => el.files[0]?.name), "tabs-acceptance.csv");
  await page.getByRole("button", { name: "上传并解析", exact: true }).click();
  await page.getByRole("heading", { name: "字段映射", exact: true }).waitFor();
  await page.getByLabel("标题 映射到").click();
  await page.getByRole("option", { name: "标题", exact: true }).click();
  await page.getByLabel("备注 映射到").click();
  await page.getByRole("option", { name: "描述", exact: true }).click();
  await tab("导入记录").click();
  await tab("导入工作项").click();
  assert.match(await page.getByLabel("备注 映射到").innerText(), /描述/u);
  await page.getByRole("button", { name: "保存映射", exact: true }).click();
  await page.getByRole("button", { name: "校验数据", exact: true }).click();
  await page.getByRole("button", { name: "导入 1 条工作项", exact: true }).waitFor();
  await tab("导入记录").click();
  await tab("导入工作项").click();
  await page.getByRole("button", { name: "导入 1 条工作项", exact: true }).click();
  await page.getByRole("heading", { name: "导入完成", exact: true }).waitFor();
  await tab("导入记录").click();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  assert.equal(await tab("导入工作项").getAttribute("aria-selected"), "true");
  await page.screenshot({ path: `${directory}/import-complete.png` });
  checks.push("导入选文件、上传、映射、校验、写入、历史返回；跨分区保留进度");

  await visit("/system?tab=data");
  assert.equal(await tab("数据").getAttribute("aria-selected"), "true");
  await tab("安全").click();
  await page.reload();
  assert.equal(await tab("安全").getAttribute("aria-selected"), "true");
  checks.push("系统分区深链接与刷新恢复");
  assert.deepEqual(errors, [], "浏览器运行时异常");
  writeFileSync(`${directory}/results.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(`页面分区验收通过：${checks.length} 项；无浏览器运行时异常。`);
} finally {
  await context.close();
  await browser.close();
}
