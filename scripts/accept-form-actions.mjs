import "./_env.ts";
/**
 * 表单操作按钮位置验收（Round 106）
 * 规范：表单提交统一放在表单底部右侧（主按钮贴内容右边缘）；页头操作仍在右上；行内操作在行尾。
 * 覆盖设置页全部区块 + 项目新建抽屉 + 弹窗操作栏。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const settings = { tabs: 0, primary: 0, modalOpeners: 0, bad: [], rows: [], inline: [] };
  for (const area of ["personal", "integrations", "instance"]) {
    await page.goto(`${BASE}/settings/${area}`, { waitUntil: "domcontentloaded" });
    const tabs = page.getByRole("tab");
    await tabs.first().waitFor();
    const tabCount = await tabs.count();
    for (let index = 0; index < tabCount; index++) {
      await tabs.nth(index).click();
      const panel = page.getByRole("tabpanel");
      await panel.locator(".settings-section").first().waitFor();
      await page.waitForFunction(() => {
        const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
        return panel && ![...panel.querySelectorAll(".settings-list-state, .settings-inline-state")]
          .some((el) => el.getBoundingClientRect().height > 0 && /加载中/.test(el.textContent ?? ""));
      });
      const openers = panel.locator(".settings-section__head .btn-primary");
      const openerCount = await openers.count();
      for (let opener = 0; opener < openerCount; opener++) {
        await openers.nth(opener).click();
        const dialog = page.getByRole("dialog");
        const submit = dialog.locator(".ui-modal-foot .btn-primary");
        await submit.waitFor();
        const layout = await submit.evaluate((btn) => {
          const r = btn.getBoundingClientRect(), dialog = btn.closest(".ui-modal");
          const d = dialog.getBoundingClientRect();
          const fields = [...dialog.querySelectorAll("input, textarea, [role='combobox']")].filter((el) => el.getBoundingClientRect().height > 0);
          return { width: r.width, rightGap: Math.round(d.right - r.right), below: fields.length > 0 && fields.every((field) => r.top >= field.getBoundingClientRect().bottom - 2) };
        });
        check("设置标题栏入口打开表单，提交位于弹窗底部右侧", layout.width > 0 && layout.rightGap >= 0 && layout.rightGap <= 24 && layout.below, JSON.stringify(layout));
        settings.modalOpeners++;
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const state = await panel.evaluate((root) => {
        const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        const sections = [...root.querySelectorAll(".settings-section")].filter(visible);
        const bad = [], rows = [], inline = [];
        let primary = 0;
        for (const section of sections) {
          const sr = section.getBoundingClientRect();
          const bodyFields = [...section.querySelectorAll(":scope > .settings-section__body input, :scope > .settings-section__body [role='combobox'], :scope > .settings-section__body textarea")].filter(visible);
          for (const btn of [...section.querySelectorAll(":scope > .settings-section__footer .btn-primary")].filter(visible)) {
            // 没有输入字段的安全状态卡片含“打开2FA设置”和导出动作，整体动作组在下面测量。
            if (!bodyFields.length) continue;
            primary++;
            const r = btn.getBoundingClientRect();
            const rightGap = Math.round(sr.right - r.right);
            if (rightGap < 0 || rightGap > 24 || r.width > sr.width * 0.5) bad.push({ title: section.querySelector("h2")?.textContent, text: btn.textContent?.trim(), rightGap, width: Math.round(r.width) });
          }
          for (const row of [...section.querySelectorAll(".settings-section__footer, .settings-actions-row")].filter(visible)) {
            const actions = [...row.children].filter(visible);
            if (!actions.length) continue;
            const last = actions.at(-1), rr = row.getBoundingClientRect(), lr = last.getBoundingClientRect();
            rows.push({ rightGap: Math.round(rr.right - lr.right), width: Math.round(lr.width) });
          }
          for (const form of [...section.querySelectorAll(".settings-form-inline")].filter(visible)) {
            const btn = form.querySelector(".btn-primary") ?? section.querySelector(".settings-section__footer .btn-primary");
            const fields = [...form.querySelectorAll("input, [role='combobox'], textarea")].filter(visible);
            if (!btn || !visible(btn) || !fields.length) continue;
            const br = btn.getBoundingClientRect();
            inline.push({ below: br.top >= Math.max(...fields.map(field => field.getBoundingClientRect().bottom)) - 2, rightGap: Math.round(sr.right - br.right) });
          }
        }
        return { primary, bad, rows, inline };
      });
      settings.tabs++;
      settings.primary += state.primary;
      for (const key of ["bad", "rows", "inline"]) settings[key].push(...state[key]);
    }
  }
  check("设置三类页面的全部十个标签页均已打开验收", settings.tabs === 10 && settings.primary > 0, `tabs=${settings.tabs} primary=${settings.primary}`);
  check("四个设置卡片标题栏入口均已验证弹窗提交操作", settings.modalOpeners === 4, String(settings.modalOpeners));
  check("设置页表单提交按钮均贴内容右边缘（≤24px）且不是整行大按钮", settings.primary > 0 && settings.bad.length === 0, JSON.stringify(settings.bad.slice(0, 3)));
  check("设置页操作行统一右对齐", settings.rows.length > 0 && settings.rows.every((x) => x.rightGap >= 0 && x.rightGap <= 2 && x.width > 0), JSON.stringify(settings.rows));
  check("设置页内联表单按钮在字段下方且右对齐", settings.inline.length > 0 && settings.inline.every((x) => x.below && x.rightGap >= 0 && x.rightGap <= 24), JSON.stringify(settings.inline));
  await page.screenshot({ path: "/tmp/form-actions-settings.png", fullPage: false });

  // 其他页表单：先打开表单，再验证底部操作栏与真实几何位置。
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);
  const formCases = [
    ["公告", "/announcements", "发公告", "发送给全员…", ".ui-modal"],
    ["API 令牌", "/tokens", "新建令牌", "创建", ".ui-modal"],
    ["自定义字段", `/projects/${pid}/fields`, "新建字段", "创建", ".ui-modal"],
  ];
  const formResults = [];
  for (const [name, path, opener, label, root] of formCases) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: opener, exact: true }).click();
    const button = page.locator(root).getByRole("button", { name: label, exact: true });
    await button.waitFor();
    const info = await button.evaluate((btn) => {
      const actions = btn.closest(".form-actions, .ui-modal-foot");
      const card = btn.closest(".card, .ui-modal");
      if (!actions || !card) return { inActions: false };
      const br = btn.getBoundingClientRect(); const cr = card.getBoundingClientRect();
      const fields = [...card.querySelectorAll("input, textarea, [role='combobox']")].filter(el => el.getBoundingClientRect().height > 0);
      return { inActions: true, below: fields.length > 0 && br.top >= Math.max(...fields.map(field => field.getBoundingClientRect().bottom)) - 2, rightGap: Math.round(cr.right - br.right), width: Math.round(br.width), cardWidth: Math.round(cr.width) };
    });
    formResults.push({ name, ...info });
  }
  check("公告/令牌/字段表单主按钮均在底部右侧操作行", formResults.every((x) => x.inActions && x.below && x.width > 0 && x.width < x.cardWidth / 2 && x.rightGap >= 0 && x.rightGap <= 80), JSON.stringify(formResults));

  // 专注功能已移除，旧地址的现行契约是重定向到工作台。
  await page.goto(`${BASE}/focus`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/workbench");
  check("今日聚焦旧链接转到工作台", new URL(page.url()).pathname === "/workbench");

  // 项目新建弹窗：底部右侧
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  await page.getByRole("button", { name: "新建项目", exact: true }).click(); await page.waitForTimeout(500);
  const drawer = page.getByRole("dialog", { name: "新建项目", exact: true });
  const drawerActions = drawer.locator(".ui-modal-foot .task-form-actions");
  const drawerState = await drawerActions.evaluate((el) => {
    const r = el.getBoundingClientRect(); const d = el.closest(".ui-modal").getBoundingClientRect();
    const button = el.querySelector(".btn-primary").getBoundingClientRect();
    const body = el.closest(".ui-modal").querySelector(".ui-modal-body").getBoundingClientRect();
    return { aligned: Math.abs(r.right - button.right) <= 2, below: button.top >= body.bottom, width: button.width, rightGap: Math.round(d.right - button.right), bottomGap: Math.round(d.bottom - r.bottom) };
  });
  check("新建项目弹窗按钮在底部右侧", drawerState.aligned && drawerState.below && drawerState.width > 0 && drawerState.rightGap >= 0 && drawerState.rightGap <= 80 && drawerState.bottomGap >= 0, JSON.stringify(drawerState));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("弹窗已关闭", !(await drawer.isVisible().catch(() => false)));
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  表单操作按钮位置验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
