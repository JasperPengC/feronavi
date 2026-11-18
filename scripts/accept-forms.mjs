import "./_env.ts";
/**
 * 表单语义真实验收（前端统一化 Round 13）
 *
 * 守的是一条**用户要求**：「很多页面中的表单组件各种不一致」。
 * 这里不看代码，只看真实页面渲染出来的东西：
 *   ① `label[for]` 指向的控件必须真的存在（断链 = 点了标签没反应 = 不一致的典型症状）；
 *   ② 每个表单控件都要有**可访问名称**（可见 label / aria-labelledby / aria-label 三者之一）；
 *   ③ 控件高度按同一套 token 渲染，并把度量打印出来备查（不做隐式断言）。
 *
 * 用法：node scripts/accept-forms.mjs [--strict]
 *   默认对全部页面断言 ①②；某页确实存在「紧凑工具栏/筛选器无可见标签」时用 `expectUnlabeled`
 *   精确登记数量（**不静默放行**，数字变了就失败）。
 */
import { chromium } from "playwright";

const HOST = process.env.BASE;
const results = [];

const PAGES = [
  { name: "announcements", path: "/announcements", expectUnlabeled: 0 },
  { name: "tokens", path: "/tokens", expectUnlabeled: 0 },
  { name: "roles", path: "/admin/roles", expectUnlabeled: 0 },
  // 里程碑的表单在弹窗里：先点空态 CTA 打开
  { name: "milestones-dialog", path: "__milestones", open: "新建里程碑", expectUnlabeled: 0 },
  { name: "workbench", path: "/workbench", expectUnlabeled: 0 },
  { name: "login", path: "/login", expectUnlabeled: 0 },
  { name: "reset", path: "/reset", expectUnlabeled: 0 },
  { name: "change-password", path: "/change-password", expectUnlabeled: 0 },
  // 紧凑工具栏型表单：控件无可见 label，但有 aria-label（可访问名称齐备）
  { name: "focus", path: "/focus", expectUnlabeled: 0 },
  { name: "workflow", path: "__workflow", expectUnlabeled: 0 },
  // 设置页走 SettingsField（可见标签 + 控件 aria-label），一并守
  { name: "settings", path: "/settings", expectUnlabeled: 0 },
  { name: "projects", path: "/projects", expectUnlabeled: 0 },
  // 项目新建表单在抽屉里：点「新建项目」打开后检查（含 key 规则的 hint/error 富文本）
  { name: "projects-drawer", path: "/projects", open: "新建项目", expectUnlabeled: 0 },
  { name: "ideas", path: "__ideas", expectUnlabeled: 0 },
  { name: "wiki", path: "__wiki", expectUnlabeled: 0 },
  { name: "timeline", path: "__timeline", expectUnlabeled: 0 },
  { name: "fields", path: "__fields", expectUnlabeled: 0 },
];

const PROJECT_PAGES = { milestones: "milestones", workflow: "workflow", ideas: "ideas", wiki: "wiki", timeline: "timeline", fields: "fields" };

function audit() {
  const text = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) : "");
  const byIds = (el, attr) => {
    const raw = el.getAttribute(attr);
    if (!raw) return "";
    return raw.split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(" ");
  };
  const accName = (el) => {
    const labelled = byIds(el, "aria-labelledby");
    if (labelled) return labelled;
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.labels && el.labels.length) return text(el.labels[0]);
    return text(el);
  };
  const controls = [...document.querySelectorAll(
    "input:not([type=hidden]), textarea, select, .select-trigger, .datepicker-trigger, [role=checkbox]",
  )].map((el) => ({
    tag: el.tagName.toLowerCase(),
    kind: el.classList.contains("select-trigger") ? "select"
      : el.classList.contains("datepicker-trigger") ? "datepicker"
      : el.getAttribute("role") === "checkbox" ? "checkbox" : (el.type || ""),
    name: accName(el),
    h: Math.round(el.getBoundingClientRect().height),
    describedBy: byIds(el, "aria-describedby"),
  }));
  return {
    brokenLabels: [...document.querySelectorAll("label[for]")]
      .filter((l) => !document.getElementById(l.getAttribute("for")))
      .map((l) => l.getAttribute("for")),
    controls,
    fields: [...document.querySelectorAll(".field")].map((f) => ({
      label: text(f.querySelector(":scope > label")),
      hint: text(f.querySelector(":scope > .hint")),
      error: text(f.querySelector(":scope > .error")),
    })),
  };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const b = await chromium.launch({ channel: "chrome" });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(HOST + "/login");
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
    });
  });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);

  for (const c of PAGES) {
    const path = c.path.startsWith("__") ? `/projects/${pid}/${PROJECT_PAGES[c.path.slice(2)]}` : c.path;
    await page.goto(HOST + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    if (c.open) {
      const btn = page.getByRole("button", { name: c.open, exact: true });
      if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(900); }
      else { results.push({ name: c.name, pass: false, error: `找不到打开按钮「${c.open}」` }); continue; }
    }
    const a = await page.evaluate(audit);
    const unlabeled = a.controls.filter((x) => !x.name);
    await page.screenshot({ path: `/tmp/accept-forms-${c.name}.png` });
    const ok = a.brokenLabels.length === 0 && unlabeled.length <= c.expectUnlabeled;
    results.push({ name: c.name, pass: ok, brokenLabels: a.brokenLabels, unlabeled, controls: a.controls.length, fields: a.fields.length });
    console.log(`  ${ok ? "✓" : "✗"} ${c.name.padEnd(20)} 控件=${a.controls.length} 字段=${a.fields.length} 断链标签=${JSON.stringify(a.brokenLabels)} 无名称控件=${JSON.stringify(unlabeled.map((x) => `${x.kind}:${x.h}px`))}`);
    if (strict) {
      for (const ctl of a.controls) console.log(`       ${ctl.kind.padEnd(10)} h=${ctl.h}  名称=${ctl.name || "（空）"}  描述=${ctl.describedBy || "-"}`);
    }
  }
  const ok = results.filter((r) => r.pass).length;
  console.log(`\n  表单语义验收 ${ok}/${results.length} 通过`);
  await b.close();
  process.exit(ok === results.length ? 0 : 1);
}
main();
