import "./_env.ts";
/**
 * 元素度量探针（前端统一化 Round 12）
 *
 * 用途：迁移前/后各跑一次，把「页面上真实渲染成什么元素、什么尺寸」落成 JSON 再逐项比对。
 * 为什么不用截图哈希：Workbench 有相对时间（"3 分钟前"），两次截图不可能一致；
 * 而**元素标签 + 尺寸 + href** 是稳定的，正好用来证明「只换语义、没改视觉」。
 *
 * 用法：
 *   node scripts/probe-elements.mjs --out /tmp/before.json [--pages workbench,calendar,roles]
 *
 * 页面清单在 PAGES 里；需要项目上下文的页面写 "__" 前缀，脚本自动补真实 projectId。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const HOST = process.env.BASE;

/** 需要项目上下文的路由：__ 前缀 → 真实路径 */
const PROJECT_PAGES = {
  milestones: "milestones", fields: "fields", calendar: "calendar", board: "board", table: "table", timeline: "timeline",
  wiki: "wiki", ideas: "ideas", insights: "insights", import: "import",
  workflow: "workflow", intake: "intake",
};

const PAGES = {
  workbench: "/workbench",
  milestones: "__milestones", fields: "__fields", ideas: "__ideas", insights: "__insights", import: "__import",
  announcements: "/announcements",
  login: "/login", reset: "/reset", "change-password": "/change-password",
  workflow: "__workflow", intake: "__intake", portfolios: "/portfolios", wiki: "__wiki",
  calendar: "__calendar", board: "__board", table: "__table", timeline: "__timeline",
  system: "/system", settings: "/settings", notifications: "/notifications",
  roles: "/admin/roles", members: "/members", tokens: "/tokens",
  focus: "/focus", projects: "/projects",
};

/** 在页面里收集元素度量（纯结构信息，不含时间等易变文本） */
function collect() {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  const style = (el) => {
    const cs = getComputedStyle(el);
    return {
      display: cs.display, radius: cs.borderRadius, height: cs.height,
      fontSize: cs.fontSize, padding: cs.padding,
    };
  };
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    text: norm(el.textContent),
    cls: [...el.classList].sort().join(" "),
    href: el.getAttribute("href"),
    role: el.getAttribute("role"),
    ariaCurrent: el.getAttribute("aria-current"),
    label: el.getAttribute("aria-label"),
    rect: rect(el),
    style: style(el),
  });
  return {
    url: location.pathname,
    // 所有"长得像按钮"的元素：<a> / <button> / <span>（含 .btn 或 ui-button）
    buttonLike: [...document.querySelectorAll(".btn, .ui-button")].map(describe),
    // 树 / 左树右内容（用于证明共享控件真的渲染了）
    tree: [...document.querySelectorAll(".ui-tree, .ui-tree-layout")].map((el) => ({
      cls: [...el.classList].join(" "), ...rect(el),
      items: el.querySelectorAll('[role="treeitem"]').length,
      firstAriaLevel: el.querySelector('[role="treeitem"]')?.getAttribute("aria-level") ?? null,
    })),
    // 表单控件高度（表单统一的度量证据）
    controls: [...document.querySelectorAll("input, textarea, select, .select-trigger, .datepicker-trigger")].map((el) => {
      const byId = el.getAttribute("aria-labelledby");
      const byIdEl = byId ? document.getElementById(byId) : null;
      const byDesc = el.getAttribute("aria-describedby");
      const byDescEl = byDesc ? document.getElementById(byDesc) : null;
      return {
        tag: el.tagName.toLowerCase(), type: el.type || "",
        cls: el.classList.contains("select-trigger") ? "select" : el.classList.contains("datepicker-trigger") ? "datepicker" : "",
        h: Math.round(el.getBoundingClientRect().height),
        label: (el.labels && el.labels[0] ? norm(el.labels[0].textContent) : ""),
        ariaLabel: el.getAttribute("aria-label"),
        labelledBy: byIdEl ? norm(byIdEl.textContent) : el.getAttribute("aria-labelledby"),
        describedBy: byDescEl ? norm(byDescEl.textContent) : el.getAttribute("aria-describedby"),
      };
    }),
    brokenLabels: [...document.querySelectorAll("label[for]")].filter((l) => !document.getElementById(l.getAttribute("for"))).map((l) => l.getAttribute("for")),
    headings: [...document.querySelectorAll("h1, h2")].map((el) => norm(el.textContent)),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : "/tmp/probe.json";
  const pagesIdx = args.indexOf("--pages");
  const wanted = pagesIdx >= 0 ? args[pagesIdx + 1].split(",") : Object.keys(PAGES);

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(HOST + "/login");
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);

  const result = { projectId: pid, pages: {} };
  for (const name of wanted) {
    const raw = PAGES[name];
    if (!raw) { result.pages[name] = { error: "unknown page" }; continue; }
    const path = raw.startsWith("__") ? `/projects/${pid}/${PROJECT_PAGES[raw.slice(2)]}` : raw;
    try {
      await page.goto(HOST + path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2800);
      result.pages[name] = await page.evaluate(collect);
      // 同时留一张图：度量是证据，图也要自己看（长任务纪律）
      await page.screenshot({ path: `/tmp/probe-${name}.png` });
    } catch (e) {
      result.pages[name] = { error: String(e).slice(0, 200) };
    }
  }
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`已写入 ${out}`);
  for (const [name, data] of Object.entries(result.pages)) {
    if (data.error) { console.log(`  ✗ ${name}: ${data.error}`); continue; }
    console.log(`  ✓ ${name.padEnd(12)} 按钮类元素=${data.buttonLike.length} 树=${data.tree.length} 控件=${data.controls.length} 标题=${JSON.stringify(data.headings.slice(0, 3))}`);
  }
  await b.close();
}
main();
