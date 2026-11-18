import "./_env.ts";
/**
 * 真实视觉验收脚手架（前端统一化长任务 Round 7）
 *
 * 为什么要有它：前几轮我**每轮灵感式写一次性脚本**，两次因为"猜按钮文案"超时失败
 * （Workflow 的「加状态」、Focus 的「加时间块」），验收成本高且不可重复。
 * 这个脚手架把四个环节固化下来：
 *   ① 登录 + 拦截所有写请求返回 500（走真实的 onError 分支）；
 *   ② **枚举页面所有可交互元素**，按**精确文案**点击；找不到时**打印候选**而不是超时；
 *   ③ 统一断言：toast 出现 / 无页面级 alert / 输入内容保留；
 *   ④ 断言失败也**截图存档**，便于我自己看。
 *
 * 用法：
 *   node scripts/accept-ui.mjs --suite            # 跑全部已迁移页面的验收
 *   node scripts/accept-ui.mjs <path> <按钮文案> [第几个输入框=值 ...]
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const HOST = process.env.BASE;

/** 枚举可交互元素（用于失败诊断：告诉调用者"页面上到底有哪些按钮"） */
async function listInteractive(page) {
  return page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button, [role="button"]')]
      .map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 24),
    inputs: [...document.querySelectorAll("input, textarea")].map((e) => ({
      type: e.tagName === "TEXTAREA" ? "textarea" : e.type, placeholder: e.placeholder || "", value: e.value || "",
    })).slice(0, 12),
  }));
}

async function clickExact(page, text) {
  const hit = page.getByRole("button", { name: text, exact: true });
  const n = await hit.count();
  if (n === 0) {
    const list = await listInteractive(page);
    throw new Error(`找不到按钮「${text}」。页面上的按钮: ${list.buttons.join(" | ")}`);
  }
  await hit.first().click({ timeout: 6000 });
}

async function readState(page) {
  return page.evaluate(() => ({
    toast: [...document.querySelectorAll(".ui-toast")].map((e) => (e.textContent || "").trim().slice(0, 48)),
    页面级alert: !!document.querySelector(".alert.alert-error"),
    输入: [...document.querySelectorAll("input, textarea")].map((e) => e.value || "").filter(Boolean),
  }));
}

/** 单个用例：导航 → 填输入 → 点按钮 → 断言 */

/** 真实点选 DateTimePicker：点日期触发器 → 选今天 → 选小时 → 选分钟 */
async function pickDateTime(page, prefix, hour, minute) {
  await page.locator(`.datepicker-trigger[aria-label^="${prefix}"]`).first().click();
  await page.waitForTimeout(300);
  await page.locator('.datepicker-day[aria-current="date"]').first().click();
  await page.waitForTimeout(300);
  const selects = page.locator(`.select-trigger[aria-label^="${prefix}"]`);
  await selects.nth(0).click();
  await page.waitForTimeout(250);
  await page.getByRole("option", { name: hour, exact: true }).first().click();
  await page.waitForTimeout(250);
  await selects.nth(1).click();
  await page.waitForTimeout(250);
  await page.getByRole("option", { name: minute, exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function runCase(page, c) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/v1/**", async (route) => {
    const m = route.request().method();
    if (["POST", "PATCH", "PUT", "DELETE"].includes(m)) {
      // 与真实服务端契约一致：扁平 { code, message, details }（嵌套 error 是**错的假体**，
      // 会让自定义 fetch 的页面解析不到 message，产生"空 toast"这种假象 —— Round 14 实测踩到）
      await route.fulfill({ status: 500, contentType: "application/json",
        body: JSON.stringify({ code: "INTERNAL", message: "服务端故障（验收用）", details: null }) });
    } else { await route.continue(); }
  });
  await page.goto(HOST + c.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(c.wait ?? 2600);
  for (const [i, v] of Object.entries(c.fill ?? {})) {
    const box = page.locator("input, textarea").nth(Number(i));
    await box.fill(v);
  }
  if (c.file) await page.locator('input[type="file"]').setInputFiles(c.file);
  if (c.do) await c.do(page);
  if (c.click) await clickExact(page, c.click);
  await page.waitForTimeout(1500);
  const st = await readState(page);
  // 期望可声明：默认 toast（页面级错误→浮动提示）；inline = 该错误本就该在页面/表单内显示（不漂走）
  const expect = c.expect ?? "toast";
  const pass = expect === "inline"
    ? (st.页面级alert && st.toast.length === 0)
    : (st.toast.length > 0 && !st.页面级alert);
  const shot = `/tmp/accept-${c.name}.png`;
  await page.screenshot({ path: shot });
  return { name: c.name, pass, expect, state: st, shot };
}

const SUITE = [
  { name: "tokens", path: "/tokens", fill: { 0: "验收令牌" }, click: "创建" },
  { name: "ideas", path: "__ideas", fill: { 0: "验收想法" }, click: "提交" },
  { name: "workflow", path: "__workflow", fill: { 0: "ACC_KEY", 1: "验收状态" }, click: "加状态" },
  // Round 8 新增：先用「发现模式」枚举出各页的真实按钮文案，再写成用例（不再猜）
  { name: "insights", path: "__insights", fill: { 0: "验收仪表盘" }, click: "新建仪表盘" },
  { name: "intake", path: "__intake", fill: { 0: "验收表单" }, click: "新建表单" },
  // focus：Round 19 起两个时间输入是**自绘 DateTimePicker**（日期 + 小时/分钟下拉），必须真实点选
  { name: "focus", path: "/focus", do: async (page) => {
      await page.locator("input").first().fill("验收时间块");
      await pickDateTime(page, "开始时间", "10", "00");
      await pickDateTime(page, "结束时间", "11", "00");
    }, click: "加时间块" },
  // Round 14 更正：自定义字段的创建表单是**页面内卡片**（不是弹窗）→ 与令牌/工作流等页一致走 toast。
  // 此前判成 inline 是把它当成弹窗了（判断错误，已改）。
  { name: "fields", path: "__fields", fill: { 0: "acceptance_key", 1: "验收字段" }, click: "创建" },
  // 导入页：先选一个真实 CSV 文件再点「上传并解析」（写请求被拦成 500 → 期望 toast）
  { name: "import", path: "__import", file: "/tmp/accept-import.csv", click: "上传并解析" },
  // 工作台快速添加待办：失败同样走 toast（与想法页快速提交一致）
  { name: "workbench", path: "/workbench", fill: { 0: "验收待办" }, click: "添加" },
];

async function main() {
  const args = process.argv.length > 2 ? process.argv.slice(2) : ["--suite"];
  // 导入页需要真实文件；脚本自建 fixture，避免依赖前一次运行留下的 /tmp 文件
  writeFileSync("/tmp/accept-import.csv", "title,type\n验收导入任务,TASK\n");
  const b = await chromium.launch({ channel: "chrome" });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(HOST + "/login"); await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) });
  });
  // 取第一个项目 id，供需要项目上下文的路由使用
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items[0].id);

  const results = [];
  if (args.includes("--suite")) {
    for (const c of SUITE) {
      const cc = { ...c };
      const MAP = { "__ideas": "ideas", "__workflow": "workflow", "__insights": "insights",
        "__intake": "intake", "__fields": "fields", "__import": "import" };
      if (cc.path.startsWith("__")) cc.path = `/projects/${pid}/${MAP[cc.path]}`;
      try { results.push(await runCase(page, cc)); }
      catch (e) { results.push({ name: cc.name, pass: false, error: String(e).slice(0, 300) }); }
    }
  } else {
    const [path, click, ...fills] = args;
    const fill = {}; fills.forEach((kv, i) => { const [k, ...v] = kv.split("="); fill[k ?? i] = v.join("="); });
    results.push(await runCase(page, { name: "single", path, click, fill }));
  }

  console.log("\n══ 验收结果 ══");
  for (const r of results) {
    if (r.error) { console.log(`  ✗ ${r.name}: ${r.error}`); continue; }
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name.padEnd(10)} 期望=${(r.expect ?? "toast").padEnd(6)} toast=${JSON.stringify(r.state.toast)} 页面alert=${r.state.页面级alert} 输入=${JSON.stringify(r.state.输入).slice(0, 40)} ｜ ${r.shot}`);
  }
  const ok = results.filter((r) => r.pass).length;
  console.log(`  ── ${ok}/${results.length} 通过`);
  await b.close();
  process.exit(ok === results.length ? 0 : 1);
}
main();
