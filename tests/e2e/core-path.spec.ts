import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("登录改密、项目工作项、缺陷、Wiki 与 CSV 导入持久化", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) throw new Error("必须由 Playwright globalSetup 启动隔离应用");
  await page.goto(`${baseURL}/login`);
  await test.step("登录表单在高窗口、桌面和平板手机上保持清晰可用", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "登录", exact: true })).toHaveCount(1);
    for (const [width, height] of [[1920, 1312], [2560, 1440], [1158, 1181], [1440, 900], [768, 1024], [390, 844], [320, 640], [844, 390]]) {
      await page.setViewportSize({ width: width!, height: height! });
      const layout = await page.locator(".login-main").evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const panel = element.querySelector(".login-panel")!.getBoundingClientRect();
        const controls = [...element.querySelectorAll(".auth-form input, .auth-form button[type=submit]")].map((control) => control.getBoundingClientRect());
        return {
          centered: Math.abs(frame.left - (innerWidth - frame.right)) < 2,
          overflow: document.documentElement.scrollWidth > innerWidth,
          verticallyCentered: document.documentElement.scrollHeight > innerHeight + 1 || Math.abs((frame.top + frame.bottom) / 2 - innerHeight / 2) < 2,
          width: frame.width,
          panelWidth: panel.width,
          controlsFit: controls.every((box) => box.left >= panel.left && box.right <= panel.right + 1 && box.height >= 44),
        };
      });
      expect(layout.centered).toBe(true);
      expect(layout.overflow).toBe(false);
      if (width! > 900) expect(layout.width).toBeGreaterThan(width! * .85);
      expect(layout.panelWidth).toBeLessThanOrEqual(480);
      expect(layout.verticallyCentered).toBe(true);
      expect(layout.controlsFit).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`login-${width}x${height}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "语言 / Language", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
    await expect(page.getByLabel("Username", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Username", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Language / 语言", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "简体中文", exact: true }).click();
  });
  await test.step("登录页主题选择、刷新保留和实时跟随系统", async () => {
    const preferenceWrites: string[] = [];
    page.on("request", (request) => { if (request.url().endsWith("/api/v1/me/preferences") && request.method() !== "GET") preferenceWrites.push(request.url()); });
    const trigger = page.getByRole("button", { name: "主题", exact: true });
    const themes = page.getByRole("menu", { name: "主题", exact: true });
    await trigger.click();
    await themes.getByRole("menuitemradio", { name: "浅色", exact: true }).click();
    await expect(themes).toBeHidden();
    await expect(page.locator("html")).toHaveClass("theme-light");
    const lightBackground = await page.locator(".login-page").evaluate((element) => getComputedStyle(element).backgroundColor);
    await trigger.click();
    await themes.getByRole("menuitemradio", { name: "深色", exact: true }).click();
    await expect(page.locator("html")).toHaveClass("theme-dark");
    expect(await page.locator(".login-page").evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground);
    await page.reload();
    await trigger.click();
    await expect(themes.getByRole("menuitemradio", { name: "深色", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass("theme-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass("theme-dark");
    await themes.getByRole("menuitemradio", { name: "跟随系统", exact: true }).click();
    await expect(page.locator("html")).toHaveClass("theme-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass("theme-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass("theme-light");
    await trigger.click();
    await expect(themes.getByRole("menuitemradio", { name: "跟随系统", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(themes).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(preferenceWrites).toEqual([]);
  });
  await page.locator("#username").fill("browser-admin");
  await page.locator("#password").fill("browser-initial-password");
  const [initialLogin] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST"),
    page.locator('form button[type="submit"]').click(),
  ]);
  expect(initialLogin.status()).toBe(200);
  await expect(page).toHaveURL(/\/change-password\?returnTo=%2Fprojects$/u);

  await page.locator("#cur").fill("browser-initial-password");
  await page.locator("#new").fill("browser-changed-password");
  await page.locator("#cfm").fill("browser-changed-password");
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/u);
  await page.locator("#username").fill("browser-admin");
  await page.locator("#password").fill("browser-changed-password");
  const [changedPasswordLogin] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST"),
    page.locator('form button[type="submit"]').click(),
  ]);
  expect(changedPasswordLogin.status()).toBe(200);
  await expect(page).toHaveURL(/\/projects$/u);

  await test.step("创建弹窗居中显示并隔离背景，关闭后恢复焦点", async () => {
    const trigger = page.getByRole("button", { name: "新建项目", exact: true }).first();
    await trigger.click();
    const modal = page.getByRole("dialog", { name: "新建项目", exact: true });
    await expect(modal).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    await expect.poll(() => modal.evaluate(element => {
      const box=element.getBoundingClientRect();
      return Math.abs(box.left - (innerWidth - box.right)) < 2 && box.top >= 0 && box.bottom <= innerHeight;
    })).toBe(true);
    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert");
    await expect(trigger).toBeFocused();
  });
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  await page.locator("#p-key").fill("BROWSER");
  await page.locator("#p-name").fill("浏览器关键路径项目");
  const createdProject = page.waitForResponse((response) => response.url().endsWith("/api/v1/projects") && response.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "创建", exact: true }).click();
  const projectResponse = await createdProject;
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json() as { id: string };
  await expect(page.getByRole("link", { name: /浏览器关键路径项目/u }).first()).toBeVisible();

  await page.goto(`${baseURL}/projects/${project.id}/board`);
  await page.locator(".page-header").getByRole("button", { name: "新建工作项", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "标题", exact: true }).fill("验证真实浏览器写入");
  const createdItem = page.waitForResponse((response) => response.url().endsWith(`/api/v1/projects/${project.id}/work-items`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  expect((await createdItem).status()).toBe(201);
  await expect(page.getByText("验证真实浏览器写入", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("验证真实浏览器写入", { exact: true }).first()).toBeVisible();

  await test.step("鼠标拖拽改变工作项状态，刷新后仍保留", async () => {
    const card = page.locator(".board-column[data-state-key='TODO']").filter({ hasText: "验证真实浏览器写入" });
    const handle = card.locator(".board-drag-handle").first();
    const target = page.locator(".board-columns > .board-column[data-state-key='IN_PROGRESS']");
    await expect(handle).toBeVisible();
    await handle.scrollIntoViewIfNeeded();
    const from = (await handle.boundingBox())!;
    const transition = page.waitForResponse((response) => response.url().endsWith("/transition") && response.request().method() === "POST");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
    await expect(page.locator(".board-root")).toHaveClass(/is-dragging/u);
    await target.scrollIntoViewIfNeeded();
    // 拖拽期间自动滚动会改变列的位置。每次校准真实指针，并在渲染后检查该指针下的列。
    await expect.poll(async () => {
      const to = (await target.locator(".board-column-body").boundingBox())!;
      const point = { x: to.x + to.width / 2, y: to.y + 70 };
      await page.mouse.move(point.x, point.y);
      return page.evaluate(async ({ x, y }) => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return document.elementsFromPoint(x, y).find(node => node.matches(".board-column"))?.getAttribute("data-state-key");
      }, point);
    }).toBe("IN_PROGRESS");
    await page.mouse.up();
    const transitionResponse = await transition;
    expect(transitionResponse.request().postDataJSON().toStateKey).toBe("IN_PROGRESS");
    expect(transitionResponse.status(), await transitionResponse.text()).toBe(200);
    await page.reload();
    await expect(target.getByRole("button", { name: "验证真实浏览器写入", exact: true })).toBeVisible();
  });

  await test.step("问题筛选区在窄屏和桌面保留分组间距", async () => {
    await page.goto(`${baseURL}/projects/${project.id}/issues`);
    const filters = page.locator(".issues-filterbar");
    const toggle = filters.getByRole("button", { name: "筛选", exact: true });
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(filters).toBeVisible();
      const status = await filters.locator(".issues-filter-row").boundingBox();
      const search = await filters.locator(".issues-search-row").boundingBox();
      expect(status).not.toBeNull();
      expect(search).not.toBeNull();
      const horizontalGap = search!.x - status!.x - status!.width;
      const verticalGap = search!.y - status!.y - status!.height;
      expect(Math.max(horizontalGap, verticalGap), `${width}px：状态与搜索区不得重叠或贴合`).toBeGreaterThanOrEqual(8);
      await toggle.click();
      const extra = page.locator("#issues-extra-filters");
      await expect(extra).toBeVisible();
      const expanded = await extra.boundingBox();
      expect(expanded!.y - search!.y - search!.height).toBeGreaterThanOrEqual(8);
      await expect.poll(() => filters.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await toggle.click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await test.step("登记缺陷并刷新列表", async () => {
    await page.goto(`${baseURL}/projects/${project.id}/issues`);
    await page.getByRole("button", { name: "登记问题", exact: true }).first().click();
    const issueDialog = page.getByRole("dialog", { name: "登记问题", exact: true });
    await issueDialog.getByRole("textbox", { name: "标题", exact: true }).fill("浏览器登记的验收缺陷");
    await issueDialog.getByRole("textbox", { name: /描述/u }).fill("验证缺陷登记从表单写入真实数据库。");
    const createdIssue = page.waitForResponse((response) => response.url().endsWith(`/api/v1/projects/${project.id}/work-items`) && response.request().method() === "POST");
    await issueDialog.getByRole("button", { name: "创建", exact: true }).click();
    const response = await createdIssue;
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ type: "DEFECT", title: "浏览器登记的验收缺陷" });
    await expect(issueDialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: /浏览器登记的验收缺陷/u })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("issues-persisted.png"), fullPage: true });
  });

  await test.step("详情折叠区键盘可达，焦点与滚动条停留在最上层抽屉", async () => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.locator(".custom-scrollbar-thumb").evaluateAll((thumbs) => thumbs.forEach((thumb) => thumb.setAttribute("data-check-background", "true")));
      await page.getByRole("button", { name: /浏览器登记的验收缺陷/u }).click();
      const drawer = page.locator(".work-item-detail");
      const lastSummary = drawer.locator(".wi-detail-fold > summary").last();
      const close = drawer.getByRole("button", { name: "关闭", exact: true });
      await expect(lastSummary).toBeVisible();
      await expect.poll(() => page.locator('[data-check-background="true"]').evaluateAll((thumbs) => thumbs.every((thumb) => getComputedStyle(thumb).display === "none"))).toBe(true);
      await lastSummary.focus();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(lastSummary).toBeFocused();
      for (const summary of await drawer.locator(".wi-detail-fold > summary").all()) {
        await summary.focus();
        await page.keyboard.press("Space");
        await expect(summary.locator("..")).toHaveAttribute("open", "");
        await page.keyboard.press("Space");
      }
      await close.focus();
      for (let index = 0; index < 16; index++) {
        await page.keyboard.press("Tab");
        expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`drawer-keyboard-${width}.png`), animations: "disabled" });
      await close.click();
      await expect(drawer).toBeHidden();
      await page.locator('[data-check-background="true"]').evaluateAll((thumbs) => thumbs.forEach((thumb) => thumb.removeAttribute("data-check-background")));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await test.step("Wiki 新建、修改、保存并重新打开", async () => {
    await page.goto(`${baseURL}/projects/${project.id}/wiki`);
    const createdPage = page.waitForResponse((response) => response.url().endsWith(`/api/v1/projects/${project.id}/pages`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    const createResponse = await createdPage;
    expect(createResponse.status()).toBe(201);
    const document = await createResponse.json() as { id: string };
    await page.getByRole("textbox", { name: "文档标题", exact: true }).fill("浏览器验收文档");
    await expect(page.getByText("协作已连接", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("textbox", { name: "文档正文", exact: true }).fill("# 首次保存\n\n来自真实浏览器的文档内容。");
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/v1/collaboration/rooms/PAGE/${document.id}/publish`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    const firstPublish = await saved;
    expect(firstPublish.status(), await firstPublish.text()).toBe(200);
    const firstBody = await firstPublish.json() as { page: { id: string; revisionNo: number } };
    expect(firstBody.page.id).toBe(document.id);
    await expect(page.getByText("来自真实浏览器的文档内容。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const secondEditor = page.getByRole("textbox", { name: "文档正文", exact: true });
    await expect(secondEditor).toBeEnabled({ timeout: 30_000 });
    await secondEditor.fill("# 再次编辑\n\n编辑后重开仍保留这段正文。");
    await expect.poll(() => secondEditor.inputValue()).toContain("编辑后重开仍保留这段正文。");
    const edited = page.waitForResponse((response) => response.url().endsWith(`/api/v1/collaboration/rooms/PAGE/${document.id}/publish`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    const secondPublish = await edited;
    expect(secondPublish.status(), await secondPublish.text()).toBe(200);
    const secondBody = await secondPublish.json() as { page: { id: string; revisionNo: number } };
    expect(secondBody.page.id).toBe(document.id);
    const persisted = await page.request.get(`${baseURL}/api/v1/pages/${document.id}`);
    expect(persisted.status()).toBe(200);
    expect((await persisted.json() as { content: string }).content).toContain("编辑后重开仍保留这段正文。");
    await page.goto(`${baseURL}/projects/${project.id}/board`);
    await page.goto(`${baseURL}/projects/${project.id}/wiki`);
    await page.getByRole("treeitem", { name: "浏览器验收文档", exact: true }).click();
    await expect(page.getByText("编辑后重开仍保留这段正文。", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("wiki-persisted.png"), fullPage: true });
  });

  await test.step("正文图片粘贴、撤销、拖入与上传失败恢复", async () => {
    await page.goto(`${baseURL}/projects/${project.id}/issues`);
    const picture = await page.screenshot({ clip: { x: 260, y: 110, width: 640, height: 360 } });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "登记问题", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "登记问题", exact: true });
    await dialog.getByRole("textbox", { name: "标题", exact: true }).fill("带截图的验收问题");
    const description = dialog.getByRole("textbox", { name: /描述/u });
    await description.fill("截图前的复现步骤\n\n");
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    }, picture.toString("base64"));
    await description.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    await expect(description).toHaveValue(/draft-image:/u);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
    await expect(description).not.toHaveValue(/draft-image:/u);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z");
    await expect(description).toHaveValue(/draft-image:/u);
    const transfer = await page.evaluateHandle((base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], "拖入截图.png", { type: "image/png" }));
      return data;
    }, picture.toString("base64"));
    await description.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(dialog.locator(".md-editor-images li")).toHaveCount(2);
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.locator(".md-editor-preview img")).toHaveCount(2);
    await expect(dialog.getByRole("button", { name: "插入图片", exact: true })).toHaveCount(0);
    const previewSource = dialog.locator(".md-editor-input");
    await expect(previewSource).toBeDisabled();
    const beforePreviewDrop = await previewSource.inputValue();
    await dialog.locator(".md-editor-preview").dispatchEvent("drop", { dataTransfer: transfer });
    await expect(previewSource).toHaveValue(beforePreviewDrop);
    await expect(dialog.locator(".md-editor-images li")).toHaveCount(2);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => { document.documentElement.classList.remove("theme-light", "theme-dark"); document.documentElement.classList.add(`theme-${theme}`); }, theme);
        await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`inline-images-${width}-${theme}.png`) });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    let creations = 0;
    const countCreations = (request: import("@playwright/test").Request) => {
      if (request.url().endsWith(`/projects/${project.id}/work-items`) && request.method() === "POST") creations++;
    };
    page.on("request", countCreations);
    await page.route("**/api/v1/uploads", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "验收模拟网络中断" }) }), { times: 1 });
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(dialog.getByText(/记录已创建，图片或附件尚未全部保存/u)).toBeVisible();
    await expect(dialog.locator(".md-editor-images li")).toHaveCount(2);
    await dialog.getByRole("button", { name: "继续保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(creations).toBe(1);
    page.off("request", countCreations);
    await page.reload();
    await page.getByRole("button", { name: /带截图的验收问题/u }).click();
    const images = page.locator(".work-item-detail .markdown-body img");
    await expect(images).toHaveCount(2);
    await expect.poll(() => images.evaluateAll((elements) => elements.every((element) => (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
    const imageURL = await images.first().getAttribute("src");
    expect(imageURL).toMatch(/^\/api\/v1\/attachments\/.+\/preview$/u);
    const privateBrowser = await page.context().browser()!.newContext();
    try { expect((await privateBrowser.request.get(`${baseURL}${imageURL}`)).status()).toBe(403); }
    finally { await privateBrowser.close(); }
    await page.screenshot({ path: testInfo.outputPath("inline-images-persisted.png") });
    await page.locator(".work-item-detail").getByRole("button", { name: "编辑工作项", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑工作项", exact: true });
    await expect(page.locator(".work-item-detail").locator("..")).toHaveAttribute("inert", "");
    await editor.getByRole("button", { name: "开始日期", exact: true }).click();
    const calendar = page.locator(".datepicker-panel");
    await expect(calendar).toBeVisible();
    expect(await calendar.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);
    await calendar.locator('[aria-current="date"]').click();
    await expect(calendar).toHaveCount(0);
    await editor.getByRole("button", { name: "开始日期", exact: true }).click();
    await calendar.locator('[aria-pressed="true"]').focus();
    await page.keyboard.press("Escape");
    await expect(calendar).toHaveCount(0);
    await expect(editor).toBeVisible();
    await editor.getByLabel("选择正文图片").setInputFiles({ name: "编辑补充.png", mimeType: "image/png", buffer: picture });
    await editor.getByRole("button", { name: "预览", exact: true }).click();
    await expect(editor.getByRole("button", { name: "插入图片", exact: true })).toHaveCount(0);
    await expect(editor.locator(".md-editor-preview img")).toHaveCount(3);
    await editor.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(editor.getByLabel("选择正文图片")).toBeEnabled();
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.locator(".work-item-detail .markdown-body img")).toHaveCount(3);
    await page.locator(".work-item-detail").getByRole("button", { name: "关闭", exact: true }).click();

    await page.goto(`${baseURL}/projects/${project.id}/wiki`);
    await page.getByRole("treeitem", { name: "浏览器验收文档", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("选择正文图片")).toBeEnabled();
    await page.getByLabel("选择正文图片").setInputFiles({ name: "文档截图.png", mimeType: "image/png", buffer: picture });
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.getByRole("button", { name: "插入图片", exact: true })).toHaveCount(0);
    await expect(page.locator(".md-editor-preview img")).toHaveCount(1);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("选择正文图片")).toBeEnabled();
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator(".wiki-reading-body img")).toHaveCount(1);
    await page.reload();
    await page.getByRole("treeitem", { name: "浏览器验收文档", exact: true }).click();
    await expect.poll(() => page.locator(".wiki-reading-body img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(640);
  });

  await test.step("表格筛选覆盖其他页的数据，并保持正确总数和排序", async () => {
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")!.value;
    for (let index = 0; index < 21; index++) {
      const response = await page.request.post(`${baseURL}/api/v1/projects/${project.id}/work-items`, {
        headers: { "x-csrf-token": decodeURIComponent(csrf) }, data: { type: "TASK", title: `用于跨页筛选的任务 ${index}`, priority: "LOW" },
      });
      expect(response.status()).toBe(201);
    }
    expect((await page.request.post(`${baseURL}/api/v1/projects/${project.id}/work-items`, {
      headers: { "x-csrf-token": decodeURIComponent(csrf) }, data: { type: "DEFECT", title: "第二页的高优先级缺陷", priority: "HIGH" },
    })).status()).toBe(201);
    await page.goto(`${baseURL}/projects/${project.id}/table`);
    await page.getByRole("button", { name: "类型", exact: true }).click();
    await page.getByRole("option", { name: "缺陷", exact: true }).click();
    const filtered = page.waitForResponse((response) => response.url().includes("view=table") && response.url().includes("priority=HIGH"));
    await page.getByRole("button", { name: "优先级", exact: true }).first().click();
    await page.getByRole("option", { name: "高", exact: true }).click();
    expect(await (await filtered).json()).toMatchObject({ total: 1, rows: [{ title: "第二页的高优先级缺陷" }] });
    await expect(page.getByRole("button", { name: /第二页的高优先级缺陷/u })).toBeVisible();
    const rowCheckbox = page.getByRole("table").getByRole("checkbox").nth(1);
    await rowCheckbox.focus(); await page.keyboard.press("Space");
    await expect(rowCheckbox).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".work-item-detail")).toBeHidden();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const batch = page.getByRole("region", { name: "批量操作", exact: true });
      await expect(batch).toBeVisible();
      const collisions = await batch.evaluate((element) => {
        // 窄屏下批量栏是单行横向滚动，控件可以超出可视边界；断言的是控件之间不重叠。
        const buttons = [...element.querySelectorAll('button:not(.table-batch-delete), .select-trigger')].map((button) => button.getBoundingClientRect());
        return buttons.some((a, index) => buttons.slice(index + 1).some((b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
      });
      expect(collisions).toBe(false);
      const scrollable = await batch.evaluate((element) => element.scrollWidth <= element.clientWidth + 1
        || ["auto", "scroll"].includes(getComputedStyle(element).overflowX));
      expect(scrollable).toBe(true);
      const pillHeights = await batch.evaluate((element) => [...element.querySelectorAll('button:not(.table-batch-delete), .select-trigger')]
        .map((pill) => Math.round(pill.getBoundingClientRect().height)));
      expect(new Set(pillHeights).size).toBe(1);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const sorted = await page.request.get(`${baseURL}/api/v1/projects/${project.id}/work-items?view=table&type=TASK&priority=LOW&sortBy=number&sortDir=desc&pageSize=2`);
    const result = await sorted.json() as { total: number; rows: { number: number }[] };
    expect(result.total).toBe(21); expect(result.rows[0]!.number).toBeGreaterThan(result.rows[1]!.number);
  });

  await test.step("CSV 上传、映射、试运行和确认后持久化", async () => {
    const checkImportLayout = async (stage: string, widths = [2028, 390]) => {
      for (const width of widths) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        const workspace = page.locator(".import-workspace");
        await expect(workspace.locator(".import-flow-panel")).toBeVisible();
        const layout = await workspace.evaluate((element) => {
          const outer = element.parentElement!;
          const parent = outer.getBoundingClientRect();
          const style = getComputedStyle(outer);
          const bounds = element.getBoundingClientRect();
          const panel = element.querySelector(".import-flow-panel")!.getBoundingClientRect();
          const steps = element.querySelector(".import-flow-steps")?.getBoundingClientRect();
          const controlsFit = [...element.querySelectorAll(".import-flow-panel button")].every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left >= panel.left - 1 && rect.right <= panel.right + 1;
          });
          const pageOverflow = (() => {
            const page = element.parentElement!;
            const pageStyle = getComputedStyle(page);
            return page.scrollWidth > page.clientWidth + 1 && !["auto", "scroll"].includes(pageStyle.overflowX);
          })();
          return {
            width: bounds.width,
            leftGap: bounds.left - parent.left - parseFloat(style.paddingLeft),
            rightGap: parent.right - parseFloat(style.paddingRight) - bounds.right,
            panelAligned: steps ? Math.abs(panel.left - steps.left) < 1 && Math.abs(panel.right - steps.right) < 1 : true,
            panelFits: panel.left >= bounds.left - 1 && panel.right <= bounds.right + 1,
            controlsFit,
            pageOverflow,
            overflow: element.scrollWidth > element.clientWidth + 1,
          };
        });
        expect(layout.overflow).toBe(false);
        expect(layout.pageOverflow).toBe(false);
        expect(layout.controlsFit).toBe(true);
        expect(layout.panelAligned).toBe(true);
        expect(layout.panelFits).toBe(true);
        expect(Math.abs(layout.leftGap - layout.rightGap)).toBeLessThan(2);
        if (width >= 1440) expect(layout.width).toBeGreaterThan(600);
        await page.screenshot({ path: testInfo.outputPath(`import-${stage}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    };
    await page.goto(`${baseURL}/projects/${project.id}/import`);
    await checkImportLayout("upload", [2028, 1440, 1024, 768, 390]);
    await page.getByRole("tab", { name: "导入记录", exact: true }).click();
    await expect(page.locator(".import-history")).toBeVisible();
    const historyOverflow = await page.locator(".import-history").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(historyOverflow).toBe(false);
    await page.getByRole("tab", { name: "导入工作项", exact: true }).click();
    await expect(page.locator(".import-flow-panel")).toBeVisible();
    await page.getByLabel(/选择 CSV/u).setInputFiles({
      name: "browser-import.csv", mimeType: "text/csv",
      buffer: Buffer.from("标题,描述\n浏览器CSV导入的任务,通过真实上传和CSRF校验\n", "utf8"),
    });
    const uploaded = page.waitForResponse((response) => response.url().endsWith(`/api/v1/projects/${project.id}/imports`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "上传并解析", exact: true }).click();
    const uploadResponse = await uploaded;
    expect(uploadResponse.status()).toBe(201);
    const batch = await uploadResponse.json() as { batchId: string };
    await expect(page.getByRole("heading", { name: "字段映射", exact: true })).toBeVisible();
    await checkImportLayout("mapping");
    await page.getByRole("button", { name: "标题 映射到", exact: true }).click();
    await page.getByRole("option", { name: "标题", exact: true }).click();
    await page.getByRole("button", { name: "描述 映射到", exact: true }).click();
    await page.getByRole("option", { name: "描述", exact: true }).click();
    const mapped = page.waitForResponse((response) => response.url().endsWith(`/api/v1/imports/${batch.batchId}/mapping`) && response.request().method() === "PUT");
    await page.getByRole("button", { name: "保存映射", exact: true }).click();
    expect((await mapped).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "校验数据", exact: true })).toBeVisible();
    await checkImportLayout("validation");
    const previewed = page.waitForResponse((response) => response.url().endsWith(`/api/v1/imports/${batch.batchId}/dry-run`));
    await page.getByRole("button", { name: "校验数据", exact: true }).click();
    const preview = await previewed;
    expect(preview.status()).toBe(200);
    expect(await preview.json()).toMatchObject({ willCreate: 1, failed: 0 });
    await checkImportLayout("confirmation");
    const confirmed = page.waitForResponse((response) => response.url().endsWith(`/api/v1/imports/${batch.batchId}/confirm`));
    await page.getByRole("button", { name: "导入 1 条工作项", exact: true }).click();
    const confirmation = await confirmed;
    expect(confirmation.status()).toBe(200);
    expect(await confirmation.json()).toMatchObject({ created: 1, failed: 0 });
    await expect(page.getByText("新建 1 · 失败 0 / 共 1", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "导入 1 条工作项", exact: true })).toHaveCount(0);
    await checkImportLayout("result");
    await page.screenshot({ path: testInfo.outputPath("import-confirmed.png"), fullPage: true });
    await page.reload();
    await page.getByRole("tab", { name: "导入记录", exact: true }).click();
    const batchRow = page.getByRole("row").filter({ hasText: "browser-import.csv" });
    await expect(batchRow).toContainText("已完成");
    await page.goto(`${baseURL}/projects/${project.id}/table`);
    const numberColumn = page.getByRole("columnheader").filter({ has: page.getByRole("button", { name: "按编号排序", exact: true }) });
    await expect(numberColumn).toHaveAttribute("aria-sort", "ascending");
    await page.getByRole("button", { name: "按编号排序", exact: true }).click();
    await expect(numberColumn).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByText("浏览器CSV导入的任务", { exact: true })).toBeVisible();
    await page.reload();
    await expect(numberColumn).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByText("浏览器CSV导入的任务", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("import-persisted.png"), fullPage: true });
  });

  await test.step("侧栏菜单、工作项视图、命令面板与手机导航可实际操作", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    while (await page.locator('.nav-group-toggle[aria-expanded="false"]').count()) {
      await page.locator('.nav-group-toggle[aria-expanded="false"]').first().click();
    }
    const navigation = await page.locator(".shell-main-nav a").evaluateAll((elements) => elements.map((element) => ({
      name: element.getAttribute("aria-label")!, path: element.getAttribute("href")!,
    })));
    navigation.sort((a, b) => Number(b.path.startsWith("/projects/")) - Number(a.path.startsWith("/projects/")));
    expect(navigation.length).toBeGreaterThanOrEqual(27);
    for (const entry of navigation) {
      const link = page.locator(".shell-main-nav").getByRole("link", { name: entry.name, exact: true });
      if (!await link.isVisible()) {
        const group = page.locator(".shell-main-nav a").filter({ hasText: entry.name }).locator("xpath=ancestor::div[@data-nav-group]");
        await group.locator(".nav-group-toggle").click();
      }
      await link.click();
      await expect(page).toHaveURL(`${baseURL}${entry.path}`);
      await expect(page.getByRole("main").locator(".page-header").getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (entry.path === `/projects/${project.id}`) {
        const panels = page.locator(".project-overview-page .dashboard-grid > div > .panel");
        await expect(panels).toHaveCount(4);
        expect(await panels.evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).borderTopLeftRadius === "0px"),
        )).toBe(true);
      }
      if (entry.path === "/settings/personal") {
        await page.getByRole("tab", { name: "通知", exact: true }).click();
        const labels = page.locator(".settings-channel-name");
        await expect(labels).toHaveCount(5);
        expect(await labels.evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight))).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("notification-labels.png"), animations: "disabled" });
      }
    }
    await page.goto(`${baseURL}/projects/${project.id}/board`);
    for (const name of ["表格", "时间线", "日历", "看板"]) {
      await page.getByRole("main").getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("INPUT");
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "主导航", exact: true })).toBeVisible();
    expect(await page.getByRole("main").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(true);
    await page.locator(".shell-main-nav").getByRole("link", { name: "文档", exact: true }).click();
    await expect(page.locator(".shell-sidebar")).toHaveAttribute("data-open", "false");
    await expect(page.getByRole("main").getByRole("heading", { name: "文档", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-navigation-wiki.png") });
  });
  await test.step("网页创建令牌可连接 MCP，网页吊销后立即拒绝访问", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${baseURL}/tokens`);
    await page.getByRole("button", { name: "新建令牌", exact: true }).click();
    await page.locator("#token-name").fill("浏览器 MCP 链路验收");
    await page.getByRole("dialog").getByRole("button", { name: "创建", exact: true }).click();
    const secret = await page.getByRole("main").locator("pre").first().innerText();
    expect(secret.startsWith("fero_")).toBe(true);
    const rpc = (method: string, params: Record<string, unknown>) => page.request.post(`${baseURL}/api/v1/mcp`, {
      headers: { authorization: `Bearer ${secret}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
    const initialize = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "browser-e2e", version: "1" } });
    expect(initialize.status()).toBe(200);
    expect((await initialize.json()).result.serverInfo.name).toBe("feronavi");
    const listing = await rpc("tools/list", {});
    const tools = (await listing.json()).result.tools as { name: string; inputSchema: { type: string } }[];
    const baseline = JSON.parse(readFileSync(new URL("../fixtures/mcp-capability-baseline.json", import.meta.url), "utf8")) as { names: string[] };
    const names = tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining([...baseline.names, "collab.inspect", "collab.publishPage", "project.context"]));
    expect(new Set(names).size).toBe(names.length);
    expect(tools.every(tool => tool.inputSchema.type === "object")).toBe(true);
    expect(names.some(name => /^(im|webhook|integration)\./u.test(name))).toBe(false);
    const ping = await rpc("tools/call", { name: "ping", arguments: {} });
    expect(JSON.parse((await ping.json()).result.content[0].text).ok).toBe(true);
    await page.getByRole("button", { name: "我已保存", exact: true }).click();
    await expect(page.getByRole("main").locator("pre")).toHaveCount(0);
    const tokenRow = page.getByRole("row").filter({ hasText: "浏览器 MCP 链路验收" });
    await tokenRow.getByRole("button", { name: "吊销", exact: true }).click();
    await page.getByRole("dialog", { name: "确认撤销？", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
    await expect(tokenRow).toHaveCount(0);
    expect((await rpc("tools/call", { name: "ping", arguments: {} })).status()).toBe(401);
    await page.getByRole("tab", { name: "MCP 客户端", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("browser-e2e");
  });
  await test.step("直接创建成员、重复提示、普通成员权限与首次登录改密", async () => {
    await page.goto(`${baseURL}/members`);
    await page.getByRole("button", { name: "创建成员", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "创建成员", exact: true });
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 640]]) {
      await page.setViewportSize({ width: width!, height: height! });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => { document.documentElement.classList.remove("theme-light", "theme-dark"); document.documentElement.classList.add(`theme-${theme}`); }, theme);
        const geometry = await drawer.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return { overflow: element.scrollWidth > element.clientWidth + 1, width: bounds.width, viewport: innerWidth,
            fieldsFit: [...element.querySelectorAll(".member-create-form .input")].every(input => { const r = input.getBoundingClientRect(); return r.width > 200 && r.right <= bounds.right && r.left >= bounds.left; }) };
        });
        expect(geometry.overflow).toBe(false);
        expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.fieldsFit).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`create-member-${width}-${theme}.png`), animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await drawer.getByLabel("姓名", { exact: false }).fill("浏览器新成员");
    await drawer.getByLabel("用户名", { exact: false }).fill("Browser.Member");
    await drawer.getByLabel("邮箱", { exact: false }).fill("Browser.Member@Example.invalid");
    await drawer.getByLabel("初始密码", { exact: false }).fill("member-initial-password");
    await drawer.getByLabel("显示密码", { exact: true }).check();
    await expect(drawer.getByLabel("初始密码", { exact: false })).toHaveAttribute("type", "text");
    await drawer.getByLabel("显示密码", { exact: true }).uncheck();
    const createdResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/members") && response.request().method() === "POST");
    await drawer.getByRole("button", { name: "创建成员", exact: true }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    expect(Object.keys(await response.json()).sort()).toEqual(["id", "username"]);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: "browser.member@example.invalid" })).toContainText("浏览器新成员");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: "browser.member@example.invalid" })).toBeVisible();
    await page.getByRole("button", { name: "创建成员", exact: true }).click();
    await expect(drawer.getByLabel("初始密码", { exact: false })).toHaveValue("");
    await drawer.getByLabel("姓名", { exact: false }).fill("重复账号");
    await drawer.getByLabel("用户名", { exact: false }).fill("browser.member");
    await drawer.getByLabel("邮箱", { exact: false }).fill("duplicate@example.invalid");
    await drawer.getByLabel("初始密码", { exact: false }).fill("member-initial-password");
    await drawer.getByRole("button", { name: "创建成员", exact: true }).click();
    await expect(drawer.getByRole("alert")).toHaveText("用户名已被占用");
    await drawer.getByLabel("用户名", { exact: false }).fill("another.member");
    await drawer.getByLabel("邮箱", { exact: false }).fill("browser.member@example.invalid");
    await drawer.getByRole("button", { name: "创建成员", exact: true }).click();
    await expect(drawer.getByRole("alert")).toHaveText("该邮箱已是组织成员");
    await drawer.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("dialog", { name: "有未保存的修改。确认放弃修改并关闭？", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
    await expect(drawer).toBeHidden();

    const memberContext = await page.context().browser()!.newContext({ locale: "zh-CN" });
    try {
      const memberPage = await memberContext.newPage();
      memberPage.on("pageerror", error => browserErrors.push(error.message));
      await memberPage.goto(`${baseURL}/login`);
      await memberPage.locator("#username").fill("browser.member");
      await memberPage.locator("#password").fill("member-initial-password");
      await memberPage.locator('form button[type="submit"]').click();
      await expect(memberPage).toHaveURL(/\/change-password/u);
      await memberPage.locator("#cur").fill("member-initial-password");
      await memberPage.locator("#new").fill("member-changed-password");
      await memberPage.locator("#cfm").fill("member-changed-password");
      await memberPage.locator('form button[type="submit"]').click();
      await expect(memberPage).toHaveURL(/\/login(?:\?.*)?$/u);
      await memberPage.locator("#username").fill("browser.member");
      await memberPage.locator("#password").fill("member-changed-password");
      await memberPage.locator('form button[type="submit"]').click();
      await expect(memberPage).toHaveURL(/\/projects$/u);
      await memberPage.goto(`${baseURL}/members`);
      await expect(memberPage.getByRole("heading", { name: "成员", exact: true })).toBeVisible();
      await expect(memberPage.getByRole("button", { name: "创建成员", exact: true })).toHaveCount(0);
      const csrf = (await memberContext.cookies()).find(cookie => cookie.name === "csrf_token")!.value;
      const forbidden = await memberPage.request.post(`${baseURL}/api/v1/members`, { headers: { "x-csrf-token": decodeURIComponent(csrf) }, data: { username: "forbidden-member", name: "不应创建", email: "forbidden@example.invalid", password: "member-initial-password" } });
      expect(forbidden.status()).toBe(403);
    } finally { await memberContext.close(); }
  });
  // 视图过渡被打断时 Chrome 会记录 "Transition was skipped"，这是跳转重叠的浏览器提示，不是页面异常。
  expect(browserErrors.filter((message) => !message.includes("Transition was skipped"))).toEqual([]);
});
