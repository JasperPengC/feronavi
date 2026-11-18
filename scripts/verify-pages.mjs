import "./_env.ts";
/**
 * Read-only browser audit for every registered UI route.
 * Usage: node scripts/run-isolated-test.ts --browser scripts/verify-pages.mjs
 * Screenshots and a JSON report are written under /tmp/feronavi-visual-audit/pages.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE;
const OUT = "/tmp/feronavi-visual-audit/pages";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 900, height: 800 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-mobile", width: 320, height: 740 },
];
mkdirSync(join(OUT, "desktop"), { recursive: true });
mkdirSync(join(OUT, "mobile"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = { base: BASE, routes: [], interactions: [], startedAt: new Date().toISOString() };
const issues = [];
const routeName = (path) => path.replaceAll(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const loginErrors = [];
    page.on("pageerror", (error) => loginErrors.push(`pageerror: ${error.message}`));
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator(".page-title").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const loginView = await page.evaluate(() => ({ path: location.pathname, title: document.querySelector(".page-title")?.textContent?.trim() ?? null,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    const loginScreenshot = join(OUT, viewport.name, "00-login.png");
    await page.screenshot({ path: loginScreenshot, animations: "disabled" });
    report.routes.push({ viewport: viewport.name, name: "login", ...loginView, screenshot: loginScreenshot });
    if (loginView.path !== "/login" || !loginView.title || loginView.documentOverflow) issues.push({ route: "login", viewport: viewport.name, issue: "login page did not render correctly", loginView });
    const login = await page.evaluate(async () => {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    });
    if (login.status < 200 || login.status >= 300) throw new Error(`Demo login failed: HTTP ${login.status}`);
    const projects = await page.evaluate(async () => {
      const response = await fetch("/api/v1/projects");
      return response.ok ? response.json() : { items: [] };
    });
    const projectId = projects.items?.[0]?.id;
    if (!projectId) throw new Error("No readable project is available for project-scoped routes");
    const routes = [
      ["workbench", "/workbench"], ["projects", "/projects"], ["board", `/projects/${projectId}/board`],
      ["milestones", `/projects/${projectId}/milestones`], ["calendar", `/projects/${projectId}/calendar`],
      ["timeline", `/projects/${projectId}/timeline`], ["table", `/projects/${projectId}/table`],
      ["workflow", `/projects/${projectId}/workflow`], ["wiki", `/projects/${projectId}/wiki`],
      ["ideas", `/projects/${projectId}/ideas`], ["insights", `/projects/${projectId}/insights`],
      ["import", `/projects/${projectId}/import`], ["fields", `/projects/${projectId}/fields`],
      ["intake", `/projects/${projectId}/intake`], ["members", "/members"], ["tokens", "/tokens"],
      ["settings", "/settings"], ["roles", "/admin/roles"], ["system", "/system"], ["portfolios", "/portfolios"],
      ["focus", "/focus"], ["announcements", "/announcements"], ["notifications", "/notifications"],
    ];

    for (const [name, path] of routes) {
      const errors = [];
      const badApiResponses = [];
      const onPageError = (error) => errors.push(`pageerror: ${error.message}`);
      const onConsole = (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      };
      const onResponse = (response) => {
        if (response.url().startsWith(`${BASE}/api/`) && response.status() >= 400) {
          badApiResponses.push({ status: response.status(), url: response.url() });
        }
      };
      page.on("pageerror", onPageError);
      page.on("console", onConsole);
      page.on("response", onResponse);
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.locator(".page-title").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(350);
      if (name === "workbench") {
        await page.locator(
          ".workbench-top-grid > article:nth-child(2) .empty-panel, .workbench-top-grid > article:nth-child(2) li, .workbench-top-grid > article:nth-child(2) [role='alert']",
        ).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      }
      const measurement = await page.evaluate(() => {
        const content = document.querySelector(".shell-content");
        const title = document.querySelector(".page-title");
        const frame = document.querySelector(".shell.app-frame");
        return {
          path: location.pathname,
          title: title?.textContent?.trim() ?? null,
          shell: !!frame,
          innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          contentWidth: content?.clientWidth ?? null,
          contentScrollWidth: content?.scrollWidth ?? null,
          contentOverflow: content ? content.scrollWidth > content.clientWidth + 1 : false,
          errorView: /渲染出错|Something went wrong/i.test(document.body.innerText),
          focusState: location.pathname === "/workbench" ? (() => {
            const panel = document.querySelector(".workbench-top-grid > article:nth-child(2)");
            return {
              blockCount: panel?.querySelectorAll(".workbench-attention-list li").length ?? panel?.querySelectorAll("li").length ?? 0,
              emptyState: !!panel?.querySelector(".workbench-focus-empty"),
              errorState: !!panel?.querySelector(".error-panel, .alert[role='alert']"),
            };
          })() : null,
          emptyBoard: location.pathname.endsWith("/board") ? (() => {
            const empty = document.querySelector(".board-column-body.is-empty");
            const label = empty?.querySelector(".board-empty-state");
            return { exists: !!empty, labelVisible: !!label && getComputedStyle(label).display !== "none" && label.getBoundingClientRect().height > 0,
              backgroundImage: empty ? getComputedStyle(empty, "::before").backgroundImage : "none" };
          })() : null,
          compactMemberPanelHeight: location.pathname === "/members"
            ? document.querySelector(".members-load-panel--compact")?.getBoundingClientRect().height ?? null
            : null,
          accountTriggerVisible: location.pathname === "/workbench"
            ? (() => { const trigger = document.querySelector(".profile-trigger"); return !!trigger && getComputedStyle(trigger).display !== "none" && trigger.getBoundingClientRect().width > 0; })()
            : null,
          accountTriggerSize: location.pathname === "/workbench"
            ? (() => { const rect = document.querySelector(".profile-trigger")?.getBoundingClientRect(); return rect ? { width: rect.width, height: rect.height } : null; })()
            : null,
        };
      });
      if (viewport.name === "tablet" && name === "workbench") {
        const shellCheck = await page.evaluate(() => {
          const menu = document.querySelector(".shell-menu-button");
          const sidebar = document.querySelector(".shell-sidebar");
          const breadcrumb = document.querySelector(".shell-breadcrumb");
          const search = document.querySelector(".shell-search");
          const sidebarRect = sidebar?.getBoundingClientRect();
          return {
            menuVisible: !!menu && getComputedStyle(menu).display !== "none",
            sidebarPosition: sidebar ? getComputedStyle(sidebar).position : "missing",
            sidebarClosedOffscreen: !!sidebarRect && sidebarRect.right <= 1,
            breadcrumbHidden: !!breadcrumb && getComputedStyle(breadcrumb).display === "none",
            searchVisible: !!search && getComputedStyle(search).display !== "none",
          };
        });
        report.interactions.push({ name: "tablet shell breakpoint", ...shellCheck });
        if (!shellCheck.menuVisible || shellCheck.sidebarPosition !== "fixed" ||
          !shellCheck.sidebarClosedOffscreen || !shellCheck.breadcrumbHidden || !shellCheck.searchVisible) {
          issues.push({ route: name, viewport: viewport.name, issue: "tablet shell breakpoint is inconsistent", shellCheck });
        }
      }
      const screenshot = join(OUT, viewport.name, `${String(routes.findIndex(([n]) => n === name) + 1).padStart(2, "0")}-${routeName(name)}.png`);
      await page.screenshot({ path: screenshot, animations: "disabled" });
      const row = { viewport: viewport.name, name, expectedPath: path, ...measurement, screenshot, errors, badApiResponses };
      report.routes.push(row);
      if (!measurement.shell || !measurement.title || measurement.errorView) issues.push({ route: name, viewport: viewport.name, issue: "page did not render a titled app view" });
      if (measurement.documentOverflow || measurement.contentOverflow) issues.push({ route: name, viewport: viewport.name, issue: "horizontal overflow", measurement });
      if (errors.length) issues.push({ route: name, viewport: viewport.name, issue: "browser error", errors });
      if (name === "workbench" && measurement.focusState?.blockCount === 0 &&
        !measurement.focusState.emptyState && !measurement.focusState.errorState) {
        issues.push({ route: name, viewport: viewport.name, issue: "today focus panel is blank with no scheduled blocks", focusState: measurement.focusState });
      }
      if (name === "workbench" && !measurement.accountTriggerVisible) {
        issues.push({ route: name, viewport: viewport.name, issue: "account menu trigger is hidden", measurement });
      }
      if (name === "board" && measurement.emptyBoard?.exists &&
        (!measurement.emptyBoard.labelVisible || measurement.emptyBoard.backgroundImage !== "none")) {
        issues.push({ route: name, viewport: viewport.name, issue: "empty board column lacks visible guidance or uses decorative placeholder texture", emptyBoard: measurement.emptyBoard });
      }
      if (name === "members" && viewport.width >= 700 && measurement.compactMemberPanelHeight !== null && measurement.compactMemberPanelHeight > 180) {
        issues.push({ route: name, viewport: viewport.name, issue: "sparse member load panel is vertically oversized", height: measurement.compactMemberPanelHeight });
      }
      if (name === "workbench" && viewport.width < 700 && measurement.accountTriggerSize &&
        (measurement.accountTriggerSize.width < 44 || measurement.accountTriggerSize.height < 44)) {
        issues.push({ route: name, viewport: viewport.name, issue: "account menu trigger is smaller than the 44px touch target", measurement });
      }
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      page.off("response", onResponse);
    }

    // Public account screens: ensure their forms render and remain within the viewport.
    for (const [name, path] of [["reset", "/reset"], ["change-password", "/change-password"]]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.locator(".page-title").first().waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
      const measurement = await page.evaluate(() => ({
        path: location.pathname,
        title: document.querySelector(".page-title")?.textContent?.trim() ?? null,
        documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      const screenshot = join(OUT, viewport.name, `public-${routeName(name)}.png`);
      await page.screenshot({ path: screenshot, animations: "disabled" });
      report.routes.push({ viewport: viewport.name, name, ...measurement, screenshot });
      if (!measurement.title || measurement.documentOverflow) issues.push({ route: name, viewport: viewport.name, issue: "public form did not render correctly", measurement });
    }

    // Setup is gated after initialization. Mock only its read endpoints so the onboarding UI can be
    // inspected without resetting or writing to the real instance database.
    await page.route("**/api/v1/setup/state", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ initialized: false, currentStep: 1, passwordResetEnabled: false }),
    }));
    await page.route("**/api/v1/setup/precheck", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ items: [
        { key: "database", ok: true, message: "数据库连接正常" },
        { key: "dataDir", ok: true, message: "数据目录可写" },
        { key: "timezone", ok: true, message: "时区 Asia/Shanghai" },
      ], ok: true }),
    }));
    // The server intentionally redirects /setup to /login on an initialized instance. Enter through
    // the already-loaded SPA and push the client route so its protected API loader can use the mocks.
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      history.pushState({}, "", "/setup");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.locator(".page-title").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const setupView = await page.evaluate(() => ({ path: location.pathname, title: document.querySelector(".page-title")?.textContent?.trim() ?? null,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1, contentOverflow: (() => {
        const card = document.querySelector(".auth-card--wide"); return card ? card.scrollWidth > card.clientWidth + 1 : false;
      })() }));
    const setupScreenshot = join(OUT, viewport.name, "public-setup.png");
    await page.screenshot({ path: setupScreenshot, animations: "disabled" });
    report.routes.push({ viewport: viewport.name, name: "setup-preview", ...setupView, screenshot: setupScreenshot });
    if (setupView.path !== "/setup" || !setupView.title || setupView.documentOverflow || setupView.contentOverflow) {
      issues.push({ route: "setup-preview", viewport: viewport.name, issue: "setup UI did not render correctly", setupView });
    }
    const setupNext = page.getByRole("button", { name: /下一步|Next/i });
    const setupNextEnabled = await setupNext.isEnabled().catch(() => false);
    if (setupNextEnabled) await setupNext.click();
    const setupAdvanced = await page.locator(".page-title").innerText().catch(() => "");
    const setupInteraction = { name: "setup step navigation", viewport: viewport.name, nextEnabled: setupNextEnabled,
      advancedToStepTwo: /^2\./.test(setupAdvanced) };
    report.interactions.push(setupInteraction);
    if (!setupInteraction.nextEnabled || !setupInteraction.advancedToStepTwo) issues.push({ route: "setup-preview", issue: "setup step navigation failed", setupInteraction });
    await page.unrouteAll({ behavior: "ignoreErrors" });

    if (viewport.name === "desktop") {
      await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" });
      await page.locator(".profile-trigger").waitFor({ state: "visible" });
      const avatar = await page.locator(".profile-trigger").boundingBox();
      await page.locator(".profile-trigger").click();
      const menu = await page.locator(".shell-user-menu").boundingBox();
      const shellSidebar = await page.locator(".shell-sidebar").boundingBox();
      const menuContents = await page.locator(".shell-user-menu").evaluate((element) => {
        const actions = [...element.querySelectorAll("[role='menuitem']")].map((item) => item.textContent?.trim() ?? "");
        const text = element.textContent ?? "";
        return {
          identityVisible: !!element.querySelector(".shell-user-menu-profile strong")?.textContent?.trim(),
          actions,
          hasSettings: actions.some((item) => /设置|settings/i.test(item)),
          hasSignOut: actions.some((item) => /退出|sign out/i.test(item)),
          includesNavigationOrSearch: /打开导航|open navigation|搜索或跳转|search or jump/i.test(text),
        };
      });
      const accountScreenshot = join(OUT, viewport.name, "account-menu.png");
      await page.screenshot({ path: accountScreenshot, animations: "disabled" });
      const menuCheck = {
        opened: !!menu,
        menuRight: menu?.x + menu?.width,
        avatarRight: avatar?.x + avatar?.width,
        rightDelta: menu && avatar ? Math.round(Math.abs(menu.x + menu.width - avatar.x - avatar.width)) : null,
        verticalGap: menu && avatar ? Math.round(menu.y - avatar.y - avatar.height) : null,
        menuLeftOfSidebar: !!menu && !!shellSidebar && menu.x >= shellSidebar.x + shellSidebar.width,
        menuInsideViewport: !!menu && menu.x >= 0 && menu.x + menu.width <= viewport.width,
        menuContents,
        screenshot: accountScreenshot,
      };
      report.interactions.push({ name: "account menu anchoring", ...menuCheck });
      if (!menuCheck.opened || !menuCheck.menuInsideViewport || !menuCheck.menuLeftOfSidebar || menuCheck.rightDelta > 18 ||
        menuCheck.verticalGap < 0 || menuCheck.verticalGap > 16 ||
        !menuContents.identityVisible || menuContents.actions.length !== 2 || !menuContents.hasSettings ||
        !menuContents.hasSignOut || menuContents.includesNavigationOrSearch) {
        issues.push({ route: "workbench", issue: "account menu position or content is incorrect", menuCheck });
      }
      await page.keyboard.press("Escape");

      const toggle = page.locator(".sidebar-collapse-toggle");
      const before = await page.locator(".shell-sidebar").boundingBox();
      const icon = await toggle.locator("svg").boundingBox();
      await toggle.click();
      await page.waitForTimeout(240);
      const collapsed = await page.locator(".shell-sidebar").boundingBox();
      await toggle.click();
      await page.waitForTimeout(240);
      const collapseCheck = { buttonVisible: await toggle.isVisible(), iconVisible: !!icon && icon.width > 0 && icon.height > 0,
        beforeWidth: Math.round(before?.width ?? 0), collapsedWidth: Math.round(collapsed?.width ?? 0) };
      report.interactions.push({ name: "sidebar collapse and restore", ...collapseCheck });
      if (!collapseCheck.buttonVisible || !collapseCheck.iconVisible || collapseCheck.collapsedWidth >= collapseCheck.beforeWidth - 40) {
        issues.push({ route: "workbench", issue: "sidebar collapse control failed", collapseCheck });
      }

      await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
      await page.locator(".shell-content").waitFor({ state: "visible" });
      const scrollCheck = await page.evaluate(async () => {
        const el = document.querySelector(".shell-content");
        if (!el) return { found: false };
        const beforeWidth = el.clientWidth;
        const beforeLeft = Math.round(el.getBoundingClientRect().left);
        const nativeScrollbar = getComputedStyle(el).scrollbarWidth;
        const rect = el.getBoundingClientRect();
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        // The hook attaches after React commits the app shell. Wait for its fixed overlay thumb
        // instead of racing the passive effect immediately after the route becomes visible.
        let thumb;
        for (let attempt = 0; attempt < 20 && !thumb; attempt += 1) {
          const candidates = [...document.querySelectorAll(".custom-scrollbar-thumb-y")];
          thumb = candidates.find((node) => Math.abs(parseFloat(node.style.left) - (rect.right - 7)) < 2);
          if (!thumb) await wait(100);
        }
        if (!thumb) return { found: false, reason: "content scrollbar thumb missing" };
        const opacity = () => Number(getComputedStyle(thumb).opacity);
        await wait(250);
        const idleOpacity = opacity();
        el.scrollTop = Math.min(220, el.scrollHeight - el.clientHeight);
        await wait(240);
        const scrollingOpacity = opacity();
        const widthDuringScroll = el.clientWidth;
        await wait(800);
        const settledOpacity = opacity();
        const afterRect = el.getBoundingClientRect();
        return { found: true, beforeWidth, afterWidth: el.clientWidth, widthDuringScroll, beforeLeft, afterLeft: Math.round(afterRect.left),
          nativeScrollbar, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          idleOpacity, scrollingOpacity, settledOpacity,
          customThumbFixed: getComputedStyle(thumb).position === "fixed" };
      });
      report.interactions.push({ name: "overlay scrollbar width stability", ...scrollCheck });
      if (!scrollCheck.found || scrollCheck.beforeWidth !== scrollCheck.afterWidth || scrollCheck.beforeLeft !== scrollCheck.afterLeft ||
        scrollCheck.nativeScrollbar !== "none" || scrollCheck.scrollHeight <= scrollCheck.clientHeight ||
        scrollCheck.widthDuringScroll !== scrollCheck.beforeWidth || scrollCheck.idleOpacity > 0.01 ||
        scrollCheck.scrollingOpacity < 0.3 || scrollCheck.settledOpacity > 0.01 || !scrollCheck.customThumbFixed) {
        issues.push({ route: "settings", issue: "overlay scrollbar did not meet width/visibility behavior", scrollCheck });
      }

      await page.goto(`${BASE}/projects/${projectId}/table`, { waitUntil: "domcontentloaded" });
      const sort = page.locator('.table-view-table button[aria-label^="按"]').first();
      await sort.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      if (await sort.count()) {
        const beforeText = await sort.innerText();
        await sort.click();
        const afterText = await sort.innerText();
        const filterCount = await page.locator(".table-view-filters button").count();
        const tableCheck = { sortBefore: beforeText, sortAfter: afterText, filterCount };
        report.interactions.push({ name: "table sort and filter controls", ...tableCheck });
        if (beforeText === afterText || filterCount < 1) issues.push({ route: "table", issue: "table controls are not interactive", tableCheck });
      } else {
        issues.push({ route: "table", issue: "table sort control is missing" });
      }
    } else {
      await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" });
      const accountTrigger = page.locator(".profile-trigger");
      await accountTrigger.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      if (await accountTrigger.isVisible()) {
        const avatar = await accountTrigger.boundingBox();
        await accountTrigger.click();
        const menu = await page.locator(".shell-user-menu").boundingBox();
        const accountCheck = {
          opened: !!menu,
          triggerSize: avatar ? { width: avatar.width, height: avatar.height } : null,
          rightDelta: menu && avatar ? Math.round(Math.abs(menu.x + menu.width - avatar.x - avatar.width)) : null,
          verticalGap: menu && avatar ? Math.round(menu.y - avatar.y - avatar.height) : null,
          insideViewport: !!menu && menu.x >= 0 && menu.x + menu.width <= viewport.width && menu.y + menu.height <= viewport.height,
        };
        report.interactions.push({ name: "responsive account menu anchoring", viewport: viewport.name, ...accountCheck });
        if (!accountCheck.opened || accountCheck.triggerSize.width < 44 || accountCheck.triggerSize.height < 44 ||
          accountCheck.rightDelta > 18 || accountCheck.verticalGap < 0 || accountCheck.verticalGap > 16 || !accountCheck.insideViewport) {
          issues.push({ route: "workbench", viewport: viewport.name, issue: "responsive account menu position is incorrect", accountCheck });
        }
        await page.keyboard.press("Escape");
      } else {
        issues.push({ route: "workbench", viewport: viewport.name, issue: "responsive account menu trigger did not become visible" });
      }
      const open = page.locator(".shell-menu-button");
      await open.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      await open.click();
      const drawerOpen = await page.locator('.shell-sidebar[data-open="true"]').count();
      const scrimOpen = await page.locator('.shell-scrim[data-open="true"]').count();
      const check = { menuButtonVisible: await open.isVisible(), drawerOpen: drawerOpen === 1, scrimOpen: scrimOpen === 1 };
      report.interactions.push({ name: "mobile navigation drawer", ...check });
      if (!check.menuButtonVisible || !check.drawerOpen || !check.scrimOpen) issues.push({ route: "workbench", viewport: "mobile", issue: "navigation drawer failed", check });
      const scrim = page.locator('.shell-scrim[data-open="true"]');
      if (await scrim.isVisible()) await scrim.click({ position: { x: viewport.width - 24, y: Math.min(400, viewport.height - 24) } });
      else await page.keyboard.press("Escape");
    }
    await context.close();
  }

  report.issues = issues;
  report.completedAt = new Date().toISOString();
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // Contact sheets keep full route coverage reviewable without changing the captured page images.
  for (const viewport of VIEWPORTS) {
    const tiles = report.routes.filter((r) => r.viewport === viewport.name && r.screenshot);
    const cards = tiles.map((tile) => `<figure><figcaption>${tile.name} · ${tile.path ?? tile.expectedPath ?? ""}</figcaption><img src="data:image/png;base64,${readFileSync(tile.screenshot).toString("base64")}"></figure>`).join("");
    const sheet = await browser.newPage({ viewport: { width: viewport.name === "desktop" ? 1440 : 1100, height: 1200 } });
    await sheet.setContent(`<html><style>body{margin:0;padding:12px;background:#111;color:#eee;font:12px system-ui}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}figure{margin:0;background:#222;overflow:hidden;border-radius:8px}figcaption{height:30px;padding:6px;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}img{display:block;width:100%;height:auto}</style><main>${cards}</main></html>`);
    await sheet.screenshot({ path: join(OUT, `${viewport.name}-contact.jpg`), fullPage: true, type: "jpeg", quality: 80 });
    await sheet.close();
  }
  console.log(JSON.stringify({ routeCount: report.routes.length, interactionCount: report.interactions.length, issueCount: issues.length,
    routes: report.routes.map(({ viewport, name, title, documentOverflow, contentOverflow, errors, badApiResponses }) => ({ viewport, name, title, documentOverflow, contentOverflow, errors, badApiResponses })),
    interactions: report.interactions, issues, output: OUT }, null, 2));
} finally {
  await browser.close();
}
process.exit(issues.length === 0 ? 0 : 1);
