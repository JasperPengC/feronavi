import "./_env.ts";
/**
 * 页面布局/密度审计（Round 95）：筛选区结构化、成员目录前置、卡片无重叠、无横向溢出。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch();   // 用 Playwright 自带 Chromium：系统 Chrome 在长时间多页面遍历中偶发崩溃
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
let projectId;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  projectId = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0]?.id);

  const routes = [
    "/workbench", "/projects", `/projects/${projectId}`, "/issues", "/members", "/settings/personal", "/settings/integrations", "/settings/instance", "/system",
    "/portfolios", "/announcements", "/notifications", "/changelog", "/tokens",
    "/admin/organization", "/admin/roles", "/admin/audit",
    `/projects/${projectId}/board`, `/projects/${projectId}/table`, `/projects/${projectId}/milestones`,
    `/projects/${projectId}/calendar`, `/projects/${projectId}/timeline`, `/projects/${projectId}/wiki`,
    `/projects/${projectId}/ideas`, `/projects/${projectId}/insights`, `/projects/${projectId}/activity`,
    `/projects/${projectId}/fields`, `/projects/${projectId}/import`,
  ];
  const overflow = [];
  const overlaps = [];
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1300);
    const info = await page.evaluate(() => {
      const over = document.documentElement.scrollWidth > innerWidth + 1;
      const cards = [...document.querySelectorAll(".page .card, .page .panel, .page .sys-section")].filter((el) => {
        const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20;
      }).map((el) => {
        const r = el.getBoundingClientRect();
        return { el, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const bad = [];
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i], b = cards[j];
          // 忽略祖先/后代关系（卡片可以合法包含卡片）
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ix > 2 && iy > 2) bad.push({ a: a.el.className?.toString().slice(0, 40), b: b.el.className?.toString().slice(0, 40), ix: Math.round(ix), iy: Math.round(iy) });
        }
      }
      return { over, bad };
    });
    if (info.over) overflow.push(route);
    overlaps.push(...info.bad.map((b) => ({ route, ...b })));
  }
  check("所有页面无横向溢出", overflow.length === 0, JSON.stringify(overflow));
  check("所有页面卡片无相互重叠", overlaps.length === 0, JSON.stringify(overlaps.slice(0, 3)));

  // 问题追踪：状态与搜索分组，额外筛选按需打开；导出在列表标题行右侧。
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const filter = await page.evaluate(() => {
    const head = document.querySelector(".issues-list-head");
    const exp = [...head?.querySelectorAll("button") ?? []].find((b) => b.textContent?.includes("导出全部筛选结果"));
    const hr = head?.getBoundingClientRect(), er = exp?.getBoundingClientRect();
    return { status: document.querySelectorAll(".issues-filterbar .issues-filter-row").length,
      search: document.querySelectorAll(".issues-filterbar .issues-search-row").length,
      rightGap: hr && er ? Math.round(hr.right - er.right) : null,
      exportInHead: !!exp && !!hr && er.top >= hr.top && er.bottom <= hr.bottom };
  });
  check("问题追踪筛选区含状态与搜索分组", filter.status === 1 && filter.search === 1, JSON.stringify(filter));
  check("导出按钮在列表标题行内且右对齐", filter.exportInHead && filter.rightGap !== null && filter.rightGap >= 0 && filter.rightGap <= 20, JSON.stringify(filter));
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("button", { name: "严重度", exact: true }).waitFor();
  const rowHeights = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".issues-filterbar .ui-segmented-item, .issues-filterbar .select-trigger, .issues-filterbar .input")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    return { heights: [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))].sort((a, b) => a - b),
      expected: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-height")), count: els.length };
  });
  check("问题筛选控件高度遵循当前 control-height", rowHeights.count > 4 && rowHeights.heights.length === 1 && rowHeights.heights[0] === rowHeights.expected, JSON.stringify(rowHeights));

  // 成员：默认显示目录，负荷直接在成员行展示，邀请与团队各有独立标签页。
  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const members = await page.evaluate(() => {
    const dir = document.querySelector(".members-directory")?.getBoundingClientRect();
    const header = document.querySelector(".members-table thead")?.getBoundingClientRect();
    return { dirY: dir ? Math.round(dir.y) : null, headerBottom: header?.bottom,
      selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      tabs: [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent),
      loads: document.querySelectorAll(".members-table tbody .members-load-inline").length };
  });
  check("成员页默认目录并展示行内负荷，邀请与团队独立分区", members.selectedTab === "成员目录" && members.loads > 0 && members.tabs.join(",") === "成员目录,邀请,团队", JSON.stringify(members));
  check("成员目录表头在首屏可见", members.dirY !== null && members.dirY >= 0 && members.headerBottom <= 950, JSON.stringify(members));
  const groups = [];
  for (const area of ["personal", "integrations", "instance"]) {
    await page.goto(`${BASE}/settings/${area}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab").first().waitFor();
    groups.push({ area, title: await page.locator(".page h1").innerText(), tabs: await page.getByRole("tab").count(), panels: await page.getByRole("tabpanel").count() });
  }
  check("设置按三条路由分区且每页只显示选中标签内容", groups.length === 3 && new Set(groups.map((group) => group.title)).size === 3 && groups.every((group) => group.tabs >= 3 && group.panels === 1), JSON.stringify(groups));
  await page.screenshot({ path: "/tmp/layout-audit-settings.png" });

  // 项目列表整行可点进项目概览
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.locator(".data-table tbody tr").first().locator("td").nth(2).click();
  await page.waitForTimeout(900);
  check("项目列表整行可点击进入项目概览", /\/projects\/[0-9a-f-]{36}$/.test(page.url()), page.url());

  // 问题追踪空态给出下一步动作
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  await page.getByLabel("搜索标题或编号").fill("zzz-不存在-" + Date.now());
  await page.waitForTimeout(900);
  const empty = page.locator(".ui-state-empty");
  await empty.waitFor();
  check("筛选空态提供清除筛选动作", (await empty.count()) === 1 && await empty.getByRole("button", { name: "清除筛选", exact: true }).isVisible(), (await empty.innerText()).slice(0, 80));
  await empty.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.locator(".issues-table tbody tr").first().waitFor();
  check("清除筛选后恢复问题列表并清空搜索", await page.getByLabel("搜索标题或编号").inputValue() === "" && await page.locator(".issues-table tbody tr").count() > 0);

  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/layout-audit-members.png" });
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/layout-audit-issues.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  页面布局审计 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
