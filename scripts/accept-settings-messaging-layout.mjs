import "./_env.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import postgres from "postgres";

// 真实页面、真实接口和随机隔离数据库；本脚本不发送测试消息、不触发投递重放。
const database = new URL(process.env.DATABASE_URL);
if (!/^\/feronavi_test_[a-f0-9]+$/.test(database.pathname)) throw new Error("仅允许一次性隔离数据库");
const base = process.env.BASE;
const directory = resolve("docs/evidence/fullwidth-os-remediation-2026-11-17/settings-interactions");
await mkdir(directory, { recursive: true });
const sql = postgres(database.href, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const results = [];
const areaSwitches = [];
const screenshot = async name => {
  // 等待真实淡入结束再截图；直接禁用动画会在部分嵌套设置区捕获淡入初帧。
  for (const selector of [".ui-modal-scrim", ".ui-modal"]) {
    const modal = page.locator(selector);
    if (await modal.count()) await expect(modal).toHaveCSS("opacity", "1");
  }
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
};
const api = (path, body) => page.evaluate(async ({ path, body }) => {
  const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
  const response = await fetch(path, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`偏好请求失败 ${response.status}`);
}, { path, body });
const open = async (width, theme, locale) => {
  await page.setViewportSize({ width, height: 1100 });
  await api("/api/v1/me/preferences", { theme, locale });
  await page.goto(`${base}/settings/integrations`);
  await page.getByRole("tab", { name: locale === "zh-CN" ? "消息与 Webhook" : "Messaging & webhooks", exact: true }).click();
  await expect(page.locator(`html.theme-${theme}`)).toBeVisible();
  await expect(page.locator(".settings-grid--messaging > .settings-section")).toHaveCount(3);
  await expect(page.locator(".settings-grid--messaging .settings-list-state").filter({ hasText: /加载|Loading/ })).toHaveCount(0);
};
const inspect = async (state, width, theme, locale) => {
  const geometry = await page.locator(".settings-grid--messaging").evaluate(grid => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
    const sections = [...grid.querySelectorAll(":scope > .settings-section")].map(rect);
    const controls = [...grid.querySelectorAll("button,input")].filter(element => element.getClientRects().length);
    const workspace = document.querySelector(".settings-page");
    const workspaceRect = workspace.getBoundingClientRect();
    const workspaceStyle = getComputedStyle(workspace);
    return { grid: rect(grid), sections, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      availableLeft: workspaceRect.left + workspace.clientLeft + parseFloat(workspaceStyle.paddingLeft),
      availableRight: workspaceRect.left + workspace.clientLeft + workspace.clientWidth - parseFloat(workspaceStyle.paddingRight),
      header: rect(document.querySelector(".settings-page > .page-header")),
      tabs: rect(document.querySelector(".settings-content > .page-tabs")),
      rowSurfaces: [...grid.children].map(element => ({ background: getComputedStyle(element).backgroundColor, shadow: getComputedStyle(element).boxShadow, radius: getComputedStyle(element).borderRadius })),
      actions: [...grid.querySelectorAll(".settings-section__actions button")].map(element => ({ text: element.textContent.trim(), label: element.getAttribute("aria-label"), primary: element.classList.contains("btn-primary") })),
      overflowingControls: controls.filter(element => { const r = element.getBoundingClientRect(); return r.x < -1 || r.right > innerWidth + 1; }).map(element => element.textContent),
      formWidth: grid.querySelector("form")?.getBoundingClientRect().width ?? null,
    };
  });
  await screenshot(`${state}-${width}-${theme}-${locale}`);
  expect(Math.abs(geometry.grid.x - geometry.availableLeft)).toBeLessThan(1);
  expect(Math.abs(geometry.grid.right - geometry.availableRight)).toBeLessThan(1);
  expect(Math.abs(geometry.grid.x - geometry.header.x)).toBeLessThan(1);
  expect(Math.abs(geometry.grid.x - geometry.tabs.x)).toBeLessThan(1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1);
  expect(geometry.overflowingControls).toEqual([]);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(geometry.sections[i].x - geometry.sections[0].x)).toBeLessThan(1);
    expect(Math.abs(geometry.sections[i].width - geometry.sections[0].width)).toBeLessThan(1);
    if (i) expect(Math.abs(geometry.sections[i].y - geometry.sections[i - 1].y - geometry.sections[i - 1].height)).toBeLessThan(1);
  }
  for (const surface of geometry.rowSurfaces) { expect(surface.background).toBe("rgba(0, 0, 0, 0)"); expect(surface.shadow).toBe("none"); expect(surface.radius).toBe("0px"); }
  expect(geometry.actions.every(action => !action.primary)).toBe(true);
  expect(new Set(geometry.actions.map(action => action.label)).size).toBe(3);
  if (state === "empty") expect(Math.max(...geometry.sections.map(section => section.height))).toBeLessThan(width < 560 ? 160 : 112);
  if (geometry.formWidth) expect(geometry.formWidth).toBeLessThanOrEqual(705);
  results.push({ state, width, theme, locale, geometry });
};
try {
  await page.goto(`${base}/login`);
  const login = await page.evaluate(async () => (await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) })).status);
  expect(login).toBe(200);
  for (const width of [390, 1024, 1440, 1920]) for (const theme of ["light", "dark"]) for (const locale of ["zh-CN", "en-US"]) {
    await open(width, theme, locale);
    await expect(page.locator(".ui-modal")).toHaveCount(0);
    await expect(page.locator(".settings-grid--messaging .settings-section__status")).toHaveCount(3);
    await expect(page.locator(".settings-grid--messaging .settings-list-state")).toHaveCount(0);
    for (const body of await page.locator(".settings-grid--messaging .settings-section__body").all()) await expect(body).toBeHidden();
    await inspect("empty", width, theme, locale);
  }

  for (const width of [390, 1440, 1920]) for (const theme of ["light", "dark"]) {
    const locale = width === 390 ? "en-US" : "zh-CN";
    await open(width, theme, locale);
    const areaTabs = page.locator(".settings-content > .page-tabs").getByRole("tab");
    const baseline = await page.locator(".settings-page > .page-header").boundingBox();
    for (const tab of await areaTabs.all()) {
      await tab.click();
      const header = await page.locator(".settings-page > .page-header").boundingBox();
      const tabs = await page.locator(".settings-content > .page-tabs").boundingBox();
      expect(Math.abs(header.x - baseline.x)).toBeLessThan(1);
      expect(Math.abs(tabs.x - baseline.x)).toBeLessThan(1);
      const overflow = await page.locator('.settings-content > [role="tabpanel"]:not([hidden])').evaluate(panel => [...panel.querySelectorAll("input,button")].filter(element => { const r = element.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).length);
      expect(overflow).toBe(0);
      const area = await tab.getAttribute("aria-controls");
      areaSwitches.push({ width, locale, area, headerX: header.x, tabsX: tabs.x });
      await screenshot(`area-${area}-${width}-${theme}-${locale}`);
      if (area.endsWith("-ai")) {
        await page.locator(".ai-provider-card").first().locator(".settings-section__actions button").click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(element => [...element.querySelectorAll("input,button")].filter(control => { const r = control.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).length)).toBe(0);
        await screenshot(`area-ai-form-${width}-${theme}-${locale}`);
        await dialog.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
      }
    }
  }

  const [{ id: tokenId }] = await sql`insert into api_token (member_id, name, token_hash, token_prefix, tier) select id, 'isolated-modal-fixture', 'isolated-modal-unusable-token', 'layout', 'READ_WRITE' from member where username = 'demo' returning id`;
  await sql`insert into mcp_client (token_id, client_name, call_count) values (${tokenId}, 'Modal fixture', 0)`;
  const [{ id: projectId }] = await sql`select id from project order by created_at limit 1`;
  const modalChecks = [];
  const checkModal = async (kind, width, theme, locale) => {
    const dialog = page.locator(".ui-modal");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1");
    await expect(page.locator(".ui-modal-scrim")).toHaveCSS("opacity", "1");
    const geometry = await dialog.evaluate(element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: element.scrollWidth > element.clientWidth + 1,
        badControls: [...element.querySelectorAll("input,button")].filter(control => { const r = control.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).length };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(width + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(1101);
    expect(geometry.overflow).toBe(false); expect(geometry.badControls).toBe(0);
    await screenshot(`modal-${kind}-${width}-${theme}-${locale}`);
    await dialog.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    modalChecks.push({ kind, width, theme, locale, geometry });
  };
  for (const width of [390, 1440]) for (const theme of ["light", "dark"]) for (const locale of ["zh-CN", "en-US"]) {
    await open(width, theme, locale);
    for (const [kind, label] of [["im", locale === "zh-CN" ? "添加 IM 渠道" : "Add IM channel"], ["webhook", locale === "zh-CN" ? "添加 Webhook" : "Add Webhook"], ["integration", locale === "zh-CN" ? "添加集成" : "Add integration"]]) {
      const trigger = page.getByRole("button", { name: label, exact: true });
      await trigger.click(); await checkModal(kind, width, theme, locale); await expect(trigger).toBeFocused();
    }
    await page.locator(".settings-content > .page-tabs").getByRole("tab").last().click();
    const idpAdd = page.getByRole("button", { name: locale === "zh-CN" ? "新建身份源" : "New identity provider", exact: true });
    await idpAdd.click(); await checkModal("sso", width, theme, locale); await expect(idpAdd).toBeFocused();
    const scimAdd = page.getByRole("button", { name: locale === "zh-CN" ? "创建 SCIM 令牌" : "Create SCIM token", exact: true });
    await scimAdd.click(); await checkModal("scim", width, theme, locale); await expect(scimAdd).toBeFocused();
    await page.goto(`${base}/tokens`);
    await page.getByRole("tab").last().click();
    const policyEdit = page.getByRole("button", { name: locale === "zh-CN" ? "编辑策略" : "Edit policies", exact: true });
    await policyEdit.click(); await checkModal("mcp", width, theme, locale); await expect(policyEdit).toBeFocused();
    await page.goto(`${base}/projects`);
    const projectAdd = page.getByRole("button", { name: locale === "zh-CN" ? "新建项目" : "New project", exact: true });
    await projectAdd.click(); await checkModal("project", width, theme, locale); await expect(projectAdd).toBeFocused();
    await page.goto(`${base}/projects/${projectId}/milestones`);
    for (const [kind, label] of [["iteration", locale === "zh-CN" ? "迭代" : "Iteration"], ["release", locale === "zh-CN" ? "版本" : "Release"], ["module", locale === "zh-CN" ? "模块" : "Module"]]) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      const planAdd = page.locator(".plan-entities-head").getByRole("button", { name: locale === "zh-CN" ? "新建" : "New", exact: true });
      await planAdd.click(); await checkModal(kind, width, theme, locale); await expect(planAdd).toBeFocused();
    }
    await page.goto(`${base}/members`);
    const memberAdd = page.getByRole("button", { name: locale === "zh-CN" ? "创建成员" : "Create member", exact: true });
    await memberAdd.click(); await checkModal("member", width, theme, locale); await expect(memberAdd).toBeFocused();
    for (const [kind, tab, label] of [["invite", "invites", locale === "zh-CN" ? "邀请成员" : "Invite member"], ["team", "teams", locale === "zh-CN" ? "新建团队" : "New team"]]) {
      await page.locator(`#members-tab-${tab}`).click();
      const trigger = page.getByRole("button", { name: label, exact: true });
      await trigger.click(); await checkModal(kind, width, theme, locale); await expect(trigger).toBeFocused();
    }
    await page.goto(`${base}/admin/organization`);
    const deptAdd = page.getByRole("button", { name: locale === "zh-CN" ? "新建部门" : "New department", exact: true });
    await deptAdd.click(); await checkModal("department", width, theme, locale); await expect(deptAdd).toBeFocused();
    await page.locator("#organization-tab-positions").click();
    const positionAdd = page.getByRole("button", { name: locale === "zh-CN" ? "新建职位" : "New position", exact: true });
    await positionAdd.click(); await checkModal("position", width, theme, locale); await expect(positionAdd).toBeFocused();
    await page.goto(`${base}/projects/${projectId}/fields`);
    const fieldAdd = page.getByRole("button", { name: locale === "zh-CN" ? "新建字段" : "New field", exact: true });
    await fieldAdd.click(); await checkModal("field", width, theme, locale); await expect(fieldAdd).toBeFocused();
    await page.goto(`${base}/projects/${projectId}/table`);
    const viewAdd = page.getByRole("button", { name: locale === "zh-CN" ? "保存当前视图" : "Save current view", exact: true });
    await viewAdd.click(); await checkModal("saved-view", width, theme, locale); await expect(viewAdd).toBeFocused();
    await page.goto(`${base}/portfolios`);
    const portfolioAdd = page.getByRole("button", { name: locale === "zh-CN" ? "新建项目集" : "New portfolio", exact: true });
    await portfolioAdd.click(); await checkModal("portfolio", width, theme, locale); await expect(portfolioAdd).toBeFocused();
  }

  const longName = "跨项目发布通知与构建流水线协作渠道 · VeryLongUnbrokenIntegrationIdentifier".repeat(3);
  const longUrl = `https://example.invalid/${"release-event-".repeat(40)}`;
  await sql`insert into webhook_endpoint (name, url, secret_encrypted, events, is_active) values (${longName}, ${longUrl}, 'isolated-layout-fixture', '["work_item.created","work_item.updated"]', false)`;
  await sql`insert into integration (kind, name, base_url, token_encrypted, is_active) values ('GITLAB', ${longName}, ${longUrl}, 'isolated-layout-fixture', false)`;
  await sql`insert into im_channel (provider, name, enabled) values ('FEISHU', ${longName}, false)`;
  for (const [width, theme, locale] of [[390, "dark", "zh-CN"], [1024, "light", "en-US"], [1440, "light", "zh-CN"], [1920, "dark", "en-US"]]) {
    await open(width, theme, locale);
    await expect(page.locator(".settings-grid--messaging .settings-record-list > li")).toHaveCount(3);
    await inspect("long-list", width, theme, locale);
  }

  for (const [width, theme, locale] of [[1440, "light", "zh-CN"], [390, "dark", "en-US"]]) {
    await open(width, theme, locale);
    for (const row of await page.locator(".settings-grid--messaging > .settings-section").all()) {
      await row.getByRole("button", { name: locale === "zh-CN" ? "删除" : "Delete", exact: true }).click();
      const confirmation = page.locator(".modal-scrim").getByRole("dialog");
      await expect(confirmation).toContainText(longName);
      await screenshot(`delete-${await row.locator("h2").textContent()}-${width}-${theme}-${locale}`);
      await confirmation.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
      await expect(confirmation).toHaveCount(0);
    }
    await expect(page.locator(".settings-grid--messaging .settings-record-list > li")).toHaveCount(3);
  }

  for (const [width, theme, locale] of [[1440, "light", "zh-CN"], [390, "dark", "en-US"]]) {
    await open(width, theme, locale);
    const add = page.getByRole("button", { name: locale === "zh-CN" ? "添加 Webhook" : "Add Webhook", exact: true });
    await add.click();
    const form = page.locator(".ui-modal");
    const name = form.getByRole("textbox").nth(0);
    const url = form.locator('input[type="url"]');
    await expect(form.getByRole("button", { name: locale === "zh-CN" ? "关闭" : "Close", exact: true })).toBeFocused();
    await name.fill(`布局验收 ${width}`);
    await url.fill("http://127.0.0.1/private");
    await form.getByRole("button", { name: locale === "zh-CN" ? "创建" : "Create", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(url).toHaveValue("http://127.0.0.1/private");
    await inspect("form-error", width, theme, locale);
    await form.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
    const discard = page.locator(".modal-scrim").getByRole("dialog");
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
    await expect(url).toHaveValue("http://127.0.0.1/private");
    await url.fill(`https://example.com/settings-layout-${width}`);
    await inspect("form", width, theme, locale);
    await form.getByRole("button", { name: locale === "zh-CN" ? "创建" : "Create", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator(".settings-secret")).toBeVisible();
    await expect(page.locator(".settings-secret")).not.toHaveText("");
    await inspect("secret", width, theme, locale);
    await add.click();
    await expect(page.locator(".settings-secret")).toBeVisible();
    await form.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(add).toBeFocused();
  }
  await writeFile(resolve(directory, "results.json"), JSON.stringify({ checks: results.length, states: results, areaSwitches, modalChecks, functional: ["真实认证与账号偏好", "三area切换对齐稳定", "AI新增表单与身份字段无溢出", "默认折叠", "展开焦点", "真实SSRF错误保留输入", "拒绝丢稿", "创建成功折叠", "一次性密钥持续显示", "干净取消与焦点归还"] }, null, 2));
  console.log(`设置全宽真实浏览器验收通过：${results.length} 个核心画面、${areaSwitches.length} 次area切换；亮暗、中英；证据 ${directory}`);
} finally {
  await sql.end();
  await context.close();
  await browser.close();
}
