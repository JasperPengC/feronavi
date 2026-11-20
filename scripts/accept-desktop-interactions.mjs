import "./_env.ts";
/**
 * PC 桌面交互验收（Round 104）
 * 侧栏收起/展开、命令面板、工作项抽屉、看板拖拽（新拖拽手柄）、表格排序。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const stamp = Date.now().toString(36);
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
let projectId;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  const created = await page.evaluate(async (stamp) => {
    await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) });
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const p = await (await fetch("/api/v1/projects", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ key: `I${stamp.slice(-6).toUpperCase()}`, name: `桌面交互验收 ${stamp}` }) })).json();
    if (!p.id) throw new Error(JSON.stringify(p));
    const items = [];
    // 表格每页 20 条；建立 25 条独立数据，确保下一页确实存在。
    for (let i = 0; i < 25; i++) {
      const response = await fetch(`/api/v1/projects/${p.id}/work-items`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ title: i === 0 ? "拖拽验收工作项" : `分页验收工作项 ${i}`, type: i === 0 ? "DEFECT" : "TASK" }) });
      const item = await response.json();
      if (response.status !== 201 || !item.id) throw new Error(`工作项 fixture 创建失败：${response.status} ${JSON.stringify(item)}`);
      items.push(item);
    }
    return { project: p, item: items[0], itemCount: items.length };
  }, stamp);
  projectId = created.project.id;
  const itemKey = created.item.key;
  check("桌面交互 fixture 创建成功（25 条覆盖分页）", created.itemCount === 25, itemKey);

  // 1) 侧栏收起/展开
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  const width0 = await page.locator(".shell-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click(); await page.waitForTimeout(400);
  const width1 = await page.locator(".shell-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click(); await page.waitForTimeout(400);
  const width2 = await page.locator(".shell-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  check("PC 侧栏可收起/展开，宽度变化正确", width0 >= 200 && width1 <= 90 && width2 >= 200, `initial=${width0} collapsed=${width1} restored=${width2}`);

  // 2) 命令面板 Cmd+K
  await page.keyboard.press("Meta+K"); await page.waitForTimeout(400);
  const paletteVisible = await page.locator(".palette-overlay [role='dialog']").isVisible().catch(() => false);
  const activeIsInput = await page.evaluate(() => document.activeElement?.tagName === "INPUT" || document.activeElement?.getAttribute("role") === "combobox");
  check("Cmd+K 打开命令面板且焦点在输入框", paletteVisible && activeIsInput, JSON.stringify({ paletteVisible, activeIsInput }));
  if (paletteVisible) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
  check("Esc 关闭命令面板", !(await page.locator(".palette-overlay [role='dialog']").isVisible().catch(() => false)));

  // 3) 工作项抽屉
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByRole("searchbox", { name: "搜索标题或编号" }).fill(itemKey);
  await page.locator(".issues-item-open").filter({ hasText: "拖拽验收工作项" }).click(); await page.waitForTimeout(600);
  const drawer = page.locator(".ui-drawer[role='dialog'], [role='dialog'].ui-drawer").first();
  const drawerVisible = await drawer.isVisible().catch(() => false);
  const drawerWidth = drawerVisible ? await drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width)) : 0;
  check("点击问题标题打开工作项抽屉（宽度适合 PC）", drawerVisible && drawerWidth > 350 && drawerWidth <= 720, String(drawerWidth));
  if (drawerVisible) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
  check("Esc 关闭工作项抽屉", !(await drawer.isVisible().catch(() => false)));

  // 4) 看板拖拽：独立拖拽手柄能启动 DnD（跨列成功/拒绝由工作流规则决定，另有服务端测试）
  await page.goto(`${BASE}/projects/${projectId}/board`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const handle = page.locator(".board-drag-handle").first();
  const hb = await handle.boundingBox({ timeout: 10000 }).catch(() => null);
  let dragActive = false;
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.move(hb.x + 140, hb.y + 60, { steps: 12 });
    await page.waitForTimeout(250);
    dragActive = await page.evaluate(() => {
      const card = document.querySelector(".board-column .card");
      const overlay = document.querySelector(".board-columns .card[style*='width: 240px'], [class*='DragOverlay']");
      return (card ? getComputedStyle(card).opacity === "0.4" : false) || !!overlay;
    });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const stateCols = await page.locator(".board-column[data-state-key]").count();
  check("看板每列带稳定 stateKey（PC 自动化/键盘可寻址）", stateCols >= 3, String(stateCols));
  check("看板独立拖拽手柄能启动拖拽（不依赖整卡 role=button）", dragActive, JSON.stringify({ hb, dragActive }));

  // 5) 表格排序 + 分页（独立 fixture 保证超过一页）
  await page.goto(`${BASE}/projects/${projectId}/table`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1400);
  const sortPill = page.locator('button[aria-label^="按"]').first();
  const beforeSort = { active: await sortPill.getAttribute("data-active"), text: (await sortPill.innerText()).trim() };
  await sortPill.click(); await page.waitForTimeout(900);
  const afterSort = { active: await sortPill.getAttribute("data-active"), text: (await sortPill.innerText()).trim() };
  check("表格排序按钮可切换方向且保持激活", (await sortPill.count()) > 0 && afterSort.active === "true" && afterSort.text !== beforeSort.text, JSON.stringify({ beforeSort, afterSort }));
  const firstPageFirst = (await page.locator(".table-view-table tbody tr").first().innerText().catch(() => "")).slice(0, 80);
  check("表格首页按 20 条分页", await page.locator(".table-view-table tbody tr").count() === 20);
  const next = page.getByRole("button", { name: /下一页|下一頁/ }).first();
  if (await next.count()) {
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll(".table-view-pagination button")];
      const b = buttons.find((x) => (x.textContent || "").includes("下一页"));
      return !!b && !b.disabled;
    }, null, { timeout: 10_000 }).catch(() => {});
    await next.click(); await page.waitForTimeout(1000);
    const secondPageFirst = (await page.locator(".table-view-table tbody tr").first().innerText().catch(() => "")).slice(0, 80);
    check("表格分页「下一页」刷新数据", secondPageFirst.length > 0 && secondPageFirst !== firstPageFirst, JSON.stringify({ firstPageFirst, secondPageFirst }));
    check("表格第二页显示剩余 5 条", await page.locator(".table-view-table tbody tr").count() === 5);
  } else {
    check("表格分页控件存在", false, "未找到下一页按钮");
  }
} finally {
  await browser.close();
  if (projectId) {
    await sql`delete from audit_entry where target_id = ${projectId}`.catch(() => {});
    await sql`delete from project where id = ${projectId}`.catch(() => {});
  }
  await sql.end();
}
const ok = results.filter(Boolean).length;
console.log(`\n  PC 桌面交互验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
