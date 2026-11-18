/** 原型对照工具：PROTOTYPE_URL 显式提供可访问的原型 URL。
 * 通过 pnpm verify:visual -- <页面名> <应用路径> [--dark] 运行。
 * 应用使用一次性演示库；结果保存到 .cache/visual-compare-*。
 */
import "./_env.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRoot } from "../tests/support/isolated-database.ts";
import { chromium } from "playwright";

const PROTO = process.env.PROTOTYPE_URL;
if (!PROTO || !["http:", "https:", "file:"].includes(new URL(PROTO).protocol)) {
  throw new Error("请通过 PROTOTYPE_URL 提供原型的 http、https 或 file URL");
}
const output = process.env.VISUAL_OUTPUT_DIR || join(repositoryRoot, ".cache", `visual-compare-${Date.now()}`);
mkdirSync(output, { recursive: true });
const MINE = process.env.BASE;
const VIEW = { width: 1440, height: 900 };

/** 需要对比的度量：全部来自**渲染后的计算样式/几何**，不是读源码猜的 */
const PROBE = () => {
  const cs = getComputedStyle(document.documentElement);
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      pad: s.padding, radius: s.borderRadius, font: s.fontSize, weight: s.fontWeight,
      bg: s.backgroundColor, color: s.color, border: s.borderColor,
    };
  };
  return {
    tokens: Object.fromEntries(["--bg","--surface","--line","--text","--text-soft","--text-faint","--blue"]
      .map((k) => [k, cs.getPropertyValue(k).trim()])),
    body: { bg: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color,
      font: getComputedStyle(document.body).fontFamily.slice(0, 60) },
    contentShell: box(".content-shell, .shell-content"),
    pageHeader: box(".page-header"),
    h1: box("h1"),
    // Members uses `.summary-block` in the prototype and `.metric-card` in the app;
    // probe the corresponding rendered element instead of reporting a missing-class false diff.
    metricCard: box(".metric-card, .summary-block"),
    panel: box(".panel"),
    metricGrid: box(".metric-grid, .member-summary"),
    dashGrid: box(".dashboard-grid"),
    table: box("table"),
    navItem: box(".main-nav a, .shell-nav-item"),
    sidebar: box("aside"),
    topbar: box("header"),
    counts: {
      metricCards: document.querySelectorAll(".metric-card, .summary-block").length,
      panels: document.querySelectorAll(".panel").length,
      tableRows: document.querySelectorAll("tbody tr").length,
      navItems: document.querySelectorAll(".main-nav a, .shell-nav-item").length,
    },
  };
};

// ── --all：一次跑完 5 个对照页，输出「样式 / 内容量」分类汇总（视觉验收的一键入口）──
if (process.argv.includes("--all")) {
  const { execFileSync } = await import("node:child_process");
  const pid = process.env.PROJECT_ID;
  if (!pid) throw new Error("缺少隔离演示项目");
  const pairs = [["overview", "/workbench"], ["projects", "/projects"],
    ["planning", `/projects/${pid}/timeline`], ["knowledge", `/projects/${pid}/wiki`], ["members", "/members"]];
  const themeArg = process.argv.includes("--light") ? "--light" : "--dark";
  const rows = [];
  for (const [n, p2] of pairs) {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), n, p2, themeArg],
      { encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, VISUAL_OUTPUT_DIR: output } });
    const m = /度量差异 (\d+) 项 = 样式 (\d+) \+ 内容量 (\d+)/.exec(out);
    rows.push({ 页: n, 差异: m ? +m[1] : -1, 样式: m ? +m[2] : -1, 内容量: m ? +m[3] : -1 });
  }
  console.log("\n══ 视觉验收汇总（原型 vs 我的，5 个有对应物的页面）══");
  for (const r of rows) console.log(`  ${r.页.padEnd(11)} 差异 ${String(r.差异).padStart(3)} = 样式 ${String(r.样式).padStart(2)} + 内容量 ${String(r.内容量).padStart(2)}`);
  console.log(`  ── 合计 ${rows.reduce((n, r) => n + r.差异, 0)} 项（workItems 无原型对应物，已判定不纳入）`);
  process.exit(0);
}
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const theme = process.argv.includes("--dark") ? "dark" : "light";
const name = args[0] ?? "overview";
if (!["overview", "projects", "workItems", "planning", "knowledge", "members"].includes(name)) throw new Error("未知原型页面");
const minePath = args[1] ?? "/workbench";

const b = await chromium.launch({ channel: "chrome" });
const shots = [];
for (const [label, url, prep] of [
  ["proto", PROTO, async (p) => { await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await p.waitForTimeout(900);
    // ⚠️ workItems 不是导航页：原型导航只有 overview/projects/planning/knowledge/members，
// 工作项视图是**项目页里的 view-switcher** 切出来的（实测：用 data-page="workItems" 点不动，
// 结果拿"工作台 vs 我的表格页"比了 30 项假差异）。
if (name === "workItems") {
      await p.evaluate(() => { const el = document.querySelector('[data-page="projects"]'); if (el) el.click(); });
      await p.waitForTimeout(800);
      await p.evaluate(() => {
        const sw = [...document.querySelectorAll("[data-work], .view-switcher button, .view-switcher a")]
          .find((e) => /列表|表格|工作项/.test(e.textContent || ""));
        if (sw) sw.click();
      });
      await p.waitForTimeout(900);
    } else if (name !== "overview") {
      await p.evaluate((n) => { const el = document.querySelector(`[data-page="${n}"]`); if (el) el.click(); }, name);
      await p.waitForTimeout(900);
    }
    // ⚠️ 切页后**再设一次**主题：原型的 JS 在切页时会重设自己的主题，先前设的会被覆盖
    //（实测：projects 页在 --dark 下仍渲染成浅色 --bg #eef0f3，导致整批颜色差异都是假的）
    await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await p.waitForTimeout(400); }],
  ["mine", MINE + minePath, async (p) => {
    await p.goto(`${MINE}/login`, { waitUntil: "load" });
    await p.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
    await p.goto(MINE + minePath, { waitUntil: "load" });
    await p.waitForTimeout(2600);
  }],
]) {
  const ctx = await b.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  if (label === "mine") {
    // 本仓主题由 cookie `feronavi_theme` 决定（src/client/lib/theme.ts），
    // 直接改 html class 会被应用在加载时覆盖 —— 实测踩到，改为设 cookie。
    await ctx.addCookies([{ name: "feronavi_theme", value: theme, domain: "127.0.0.1", path: "/" }]);
  }
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "load" });
  await prep(p);
  const m = await p.evaluate(PROBE);
  const path = join(output, `cmp-${name}-${theme}-${label}.png`);
  await p.screenshot({ path });
  shots.push({ label, path, metrics: m });
  await p.close();
}
await b.close();

// 并排对比图：**base64 内嵌**（此前用 file:// 引图被拦，图是破的 —— 实测踩到）

const b64 = (f) => readFileSync(f).toString("base64");
const b2 = await chromium.launch({ channel: "chrome" });
const p2 = await b2.newPage({ viewport: { width: 1440, height: 920 } });
await p2.setContent(`<body style="margin:0;background:#111;font:13px system-ui;color:#fff">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
    <div><div style="padding:4px">原型 ${name}</div><img src="data:image/png;base64,${b64(shots[0].path)}" style="width:100%;display:block"></div>
    <div><div style="padding:4px">我的 ${minePath}</div><img src="data:image/png;base64,${b64(shots[1].path)}" style="width:100%;display:block"></div>
  </div></body>`, { waitUntil: "load" });
await p2.waitForTimeout(800);
await p2.screenshot({ path: join(output, `cmp-${name}-${theme}.png`) });
await b2.close();

// 度量差异（只列**不同**的项，避免噪音）
const [a, c] = shots.map((s) => s.metrics);
const diffs = [];
const walk = (x, y, path = "") => {
  if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
    return;
  }
  const sx = JSON.stringify(x), sy = JSON.stringify(y);
  if (sx !== sy) diffs.push({ key: path, proto: x, mine: y });
};
walk(a, c);
console.log(`并排图: ${join(output, `cmp-${name}-${theme}.png`)}`);
// 第 12 轮：把差异**分成「样式」与「内容量」两类** —— 否则总数会把两种性质完全不同的差距混在一起，
// 让我看不清"还剩多少样式工作"（这是我此前反复用总数自我安慰/自我打击的根源）。
//   内容量：由**内容多少**决定的度量（高度、元素计数），改样式改不动它；
//   样式：尺寸/间距/颜色/字号/圆角/位置等，属于可对齐的部分。
const isContent = (k) =>
  /^counts\./.test(k) ||
  // 由**内容多少**决定的高度
  /(contentShell|panel|table)\.h$/.test(k) ||
  (/\.h$/.test(k) && /(panel|card|table|contentShell)/.test(k)) ||
  // 第 14 轮补充：**文本宽度由文案长度决定**（如 h1.w —— 原型是「早上好，林墨」、我是「中午好，演示管理员」，
  // 宽度差 26px 不是样式问题）。把它归到内容量，避免我把文案差异当成样式缺陷去"修"。
  (/\.w$/.test(k) && /(^|\.)(h1|pageHeader)$/.test(k.replace(/\.w$/, "")));
const styleDiffs = diffs.filter((d) => !isContent(d.key));
const contentDiffs = diffs.filter((d) => isContent(d.key));
console.log(`  ▸ 度量差异 ${diffs.length} 项 = 样式 ${styleDiffs.length} + 内容量 ${contentDiffs.length}`);
console.log(`  ── 样式差异（可对齐，逐条修）──`);
for (const d of styleDiffs.slice(0, 24)) console.log(`     ${d.key}: 原型=${JSON.stringify(d.proto)} ｜ 我的=${JSON.stringify(d.mine)}`);
console.log(`  ── 内容量差异（改样式改不动，属数据/内容多少）──`);
for (const d of contentDiffs.slice(0, 10)) console.log(`     ${d.key}: 原型=${JSON.stringify(d.proto)} ｜ 我的=${JSON.stringify(d.mine)}`);

writeFileSync(join(output, `cmp-${name}-${theme}.json`), JSON.stringify({ reference: PROTO, path: minePath, theme, diffs }, null, 2));
