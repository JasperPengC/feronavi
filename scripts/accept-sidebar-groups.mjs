import "./_env.ts";
/**
 * 侧栏一级菜单验收（Round 109，行业常见「一级 + 可展开子菜单」）
 * 5 个一级入口：概览 / 项目 / 协作 / 管理 / 平台；240px；默认项目+协作展开，
 * 管理/平台收起；折叠状态持久化；当前路由自动展开；项目内页面只在选中项目后出现。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items?.[0]?.id);
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);

  const initial = await page.evaluate(() => ({
    width: Math.round(document.querySelector(".shell-sidebar").getBoundingClientRect().width),
    groups: [...document.querySelectorAll(".nav-group-toggle")].map((b) => ({ text: b.querySelector(".nav-group-label")?.textContent, expanded: b.getAttribute("aria-expanded"), chevron: !!b.querySelector(".nav-group-chevron svg") })),
    direct: [...document.querySelectorAll(".shell-nav-item")].filter((a) => !a.closest(".nav-group-items")).map((a) => a.textContent?.trim()),
    guide: getComputedStyle(document.querySelector(".nav-group-items"), "::before").width,
    itemHeights: [...document.querySelectorAll(".shell-nav-item")].filter((x) => x.getBoundingClientRect().height > 0).map((x) => Math.round(x.getBoundingClientRect().height)),
    workspaceHeight: Math.round(document.querySelector(".workspace-switcher")?.getBoundingClientRect().height ?? 0),
  }));
  check("侧栏宽度 224px（YouQu 宽度）", initial.width === 224, String(initial.width));
  check("一级入口为「概览/今日聚焦/问题追踪 + 项目/管理/平台」", initial.direct.length === 3 && initial.groups.map((g) => g.text).join(",") === "项目,管理,平台", JSON.stringify({ direct: initial.direct, groups: initial.groups.map((g) => g.text) }));
  check("项目默认展开，管理/平台默认收起", initial.groups.find((g) => g.text === "项目")?.expanded === "true" && initial.groups.find((g) => g.text === "管理")?.expanded === "false" && initial.groups.find((g) => g.text === "平台")?.expanded === "false", JSON.stringify(initial.groups));
  check("一级项 36 / 子项 32、缩进+引导线", initial.itemHeights.every((h) => h === 36 || h === 32) && parseFloat(initial.guide) === 1, JSON.stringify({ heights: [...new Set(initial.itemHeights)], guide: initial.guide }));
  check("项目切换器压成紧凑一行（≤44px）", initial.workspaceHeight > 0 && initial.workspaceHeight <= 44, String(initial.workspaceHeight));

  // 折叠/展开 + 持久化（管理组）
  const manage = page.locator('.nav-group-toggle', { hasText: "管理" });
  await manage.click(); await page.waitForTimeout(250);
  const opened = await page.evaluate(() => {
    const g = document.querySelector('.nav-group[data-nav-group="manage"]');
    return { expanded: g?.querySelector(".nav-group-toggle")?.getAttribute("aria-expanded"), visible: !!g && getComputedStyle(g.querySelector(".nav-group-items")).display !== "none" };
  });
  check("点击「管理」可展开", opened.expanded === "true" && opened.visible, JSON.stringify(opened));
  await manage.click(); await page.waitForTimeout(250);
  check("再次点击可折叠", (await manage.getAttribute("aria-expanded")) === "false");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  check("折叠状态刷新后持久化", (await page.locator('.nav-group-toggle', { hasText: "管理" }).getAttribute("aria-expanded")) === "false");

  // 当前路由自动展开所在一级
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  check("进入 /settings 自动展开「管理」", (await page.locator('.nav-group-toggle', { hasText: "管理" }).getAttribute("aria-expanded")) === "true");

  // 项目内菜单只在选中项目后出现，且不会再出现“点计划突然冒组”
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(700);
  const projectGroup = page.locator('.nav-group[data-nav-group="project"]');
  const beforeItems = await projectGroup.locator(".shell-nav-item").count();
  const workbenchText = await page.locator(".shell-sidebar").innerText();
  check("未选项目时侧栏不含项目内「计划/时间线/知识库」", !workbenchText.includes("计划") && !workbenchText.includes("时间线") && !workbenchText.includes("知识库"), (await projectGroup.innerText()).slice(0, 80));
  check("未选项目时项目子菜单只有全局入口", beforeItems === 2, String(beforeItems));
  await page.goto(`${BASE}/projects/${pid}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  if (await projectGroup.locator(".nav-group-toggle").getAttribute("aria-expanded") === "false") {
    await projectGroup.locator(".nav-group-toggle").click(); await page.waitForTimeout(300);
  }
  const afterItems = await projectGroup.locator(".shell-nav-item").count();
  const projectMenuText = await projectGroup.innerText();
  check("选中项目后项目子菜单出现项目概览/看板/计划/知识库", afterItems >= 6 && projectMenuText.includes("项目概览") && projectMenuText.includes("计划") && projectMenuText.includes("知识库"), `${beforeItems}→${afterItems} ${projectMenuText.slice(0, 100)}`);
  await page.screenshot({ path: "/tmp/sidebar-v3-project.png" });

  // 桌面折叠态
  await page.locator(".shell-collapse-button").click(); await page.waitForTimeout(300);
  const collapsed = await page.evaluate(() => ({ sidebar: Math.round(document.querySelector(".shell-sidebar").getBoundingClientRect().width), labelVisible: getComputedStyle(document.querySelector(".nav-group-label")).display !== "none" }));
  check("桌面折叠态隐藏文字且仅图标可读", collapsed.sidebar <= 90 && !collapsed.labelVisible, JSON.stringify(collapsed));
  await page.locator('.nav-group-toggle', { hasText: "平台" }).click(); await page.waitForTimeout(300);
  check("折叠态点一级入口会恢复侧栏并展开", (await page.locator(".shell-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width))) >= 200, "");

  // 参考截图（workbench 默认态）
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/sidebar-v3-default.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  侧栏一级菜单验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
