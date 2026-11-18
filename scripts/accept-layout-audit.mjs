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
    "/workbench", "/projects", `/projects/${projectId}`, "/issues", "/members", "/settings", "/system",
    "/portfolios", "/focus", "/announcements", "/notifications", "/changelog", "/tokens",
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

  // 问题追踪：两行结构化筛选，导出右对齐
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const filter = await page.evaluate(() => {
    const bar = document.querySelector(".issues-filterbar");
    const rows = document.querySelectorAll(".issues-filterbar .issues-filter-row");
    const exp = [...document.querySelectorAll(".issues-filterbar button")].find((b) => b.textContent?.includes("导出全部筛选结果"));
    const br = bar?.getBoundingClientRect(); const er = exp?.getBoundingClientRect();
    return { rows: rows.length, rightGap: br && er ? Math.round(br.right - er.right) : null, exportInRow: exp?.closest(".issues-filter-row") ? true : false };
  });
  check("问题追踪筛选区为两行结构化布局", filter.rows === 2, JSON.stringify(filter));
  check("导出按钮在筛选行内且右对齐（不再单独换行）", filter.exportInRow && filter.rightGap !== null && filter.rightGap >= 0 && filter.rightGap <= 20, JSON.stringify(filter));
  const rowHeights = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".issues-filter-row .ui-segmented-item, .issues-filter-row .select-trigger, .issues-filter-row .input")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    return [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))].sort((a, b) => a - b);
  });
  check("问题筛选行控件高度一致（32px）", rowHeights.length === 1 && rowHeights[0] === 32, JSON.stringify(rowHeights));

  // 成员：目录前置到团队负载之前
  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const members = await page.evaluate(() => {
    const dir = document.querySelector(".members-directory")?.getBoundingClientRect();
    const load = document.querySelector(".members-load-panel")?.getBoundingClientRect();
    return { dirY: dir ? Math.round(dir.y) : null, loadY: load ? Math.round(load.y) : null };
  });
  check("成员目录前置到团队负载之前", members.dirY !== null && members.loadY !== null && members.dirY < members.loadY, JSON.stringify(members));
  check("成员目录表头在首屏可见", members.dirY !== null && members.dirY < 900, JSON.stringify(members));
  // 设置页：按个人/集成/组织三组分区，组标题存在
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1600);
  const groups = await page.evaluate(() => ({
    count: document.querySelectorAll(".settings-group").length,
    titles: [...document.querySelectorAll(".settings-group-head h2")].map((x) => x.textContent),
  }));
  check("设置页按三组分区（个人/集成/组织）", groups.count === 3 && groups.titles.length === 3, JSON.stringify(groups));
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
  check("问题空态提供下一步动作（换筛选/登记）", (await empty.count()) === 1 && (await empty.innerText()).includes("登记问题"), (await empty.innerText()).slice(0, 80));

  await page.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/layout-audit-members.png" });
  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/layout-audit-issues.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  页面布局审计 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
