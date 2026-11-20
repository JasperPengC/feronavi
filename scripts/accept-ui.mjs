import "./_env.ts";
/**
 * 真实视觉验收脚手架（前端统一化长任务 Round 7）
 *
 * 为什么要有它：前几轮我**每轮灵感式写一次性脚本**，两次因为"猜按钮文案"超时失败
 * （Workflow 的「添加状态」、Focus 的「加时间块」），验收成本高且不可重复。
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
const FAILURE = "服务端故障（验收用）";

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
    formErrors: [...document.querySelectorAll('.field-error[role="alert"]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.textContent?.trim()),
    输入: [...document.querySelectorAll("input, textarea")].map((e) => e.value || "").filter(Boolean),
  }));
}

/** 单个用例：打开当前表单 → 填输入 → 注入真实提交失败 → 验证反馈与草稿保留。 */
async function runCase(page, c) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const writes = [];
  await page.route("**/api/v1/**", async (route) => {
    const m = route.request().method();
    if (["POST", "PATCH", "PUT", "DELETE"].includes(m)) {
      writes.push({ method: m, path: new URL(route.request().url()).pathname });
      // 与真实服务端契约一致：扁平 { code, message, details }（嵌套 error 是**错的假体**，
      // 会让自定义 fetch 的页面解析不到 message，产生"空 toast"这种假象 —— Round 14 实测踩到）
      await route.fulfill({ status: 500, contentType: "application/json",
        body: JSON.stringify({ code: "INTERNAL", message: FAILURE, details: null }) });
    } else { await route.continue(); }
  });
  await page.goto(HOST + c.path, { waitUntil: "domcontentloaded" });
  if (c.redirect) {
    await page.waitForURL(`**${c.redirect}`);
    await page.locator(".workbench-page").waitFor();
    const shot = `/tmp/accept-${c.name}.png`;
    await page.screenshot({ path: shot });
    return { name: c.name, pass: new URL(page.url()).pathname === c.redirect, expect: "redirect", state: await readState(page), shot };
  }
  await page.waitForTimeout(c.wait ?? 2600);
  if (c.prepare) await c.prepare(page);
  const drafts = [];
  for (const [label, value] of Object.entries(c.fields ?? {})) {
    const box = page.getByLabel(label, { exact: true });
    await box.fill(value);
    drafts.push({ box, value });
  }
  for (const [i, v] of Object.entries(c.fill ?? {})) {
    const box = page.locator("input:visible, textarea:visible").nth(Number(i));
    await box.fill(v);
    drafts.push({ box, value: v });
  }
  if (c.file) await page.locator('input[type="file"]').setInputFiles(c.file);
  if (c.do) await c.do(page);
  if (c.click) await clickExact(page, c.click);
  const expect = c.expect ?? "toast";
  await page.locator(expect === "inline" ? '.field-error[role="alert"]' : ".ui-toast").filter({ hasText: FAILURE }).first().waitFor();
  const st = await readState(page);
  const retained = (await Promise.all(drafts.map(async ({ box, value }) => await box.isVisible() && await box.inputValue() === value))).every(Boolean);
  const retainedFile = !c.file || await page.locator('input[type="file"]').evaluate((el, name) => el.files?.length === 1 && el.files[0].name === name, c.file.split("/").at(-1));
  const submitted = writes.some((request) => !c.endpoint || c.endpoint.test(request.path));
  const feedback = expect === "inline"
    ? st.formErrors.includes(FAILURE) && st.toast.length === 0 && !st.页面级alert
    : st.toast.some((text) => text.includes(FAILURE)) && !st.页面级alert;
  const pass = submitted && feedback && retained && retainedFile && (drafts.length > 0 || !!c.file);
  const shot = `/tmp/accept-${c.name}.png`;
  await page.screenshot({ path: shot });
  return { name: c.name, pass, expect, state: st, shot, submitted, retained: retained && retainedFile, writes };
}

const SUITE = [
  { name: "tokens", path: "/tokens", prepare: (page) => clickExact(page, "新建令牌"), fields: { "令牌用途": "验收令牌" }, click: "创建", endpoint: /\/tokens$/ },
  { name: "ideas", path: "__ideas", fields: { "想法标题": "验收想法" }, click: "提交", endpoint: /\/ideas$/ },
  { name: "workflow", path: "__workflow", fields: { "KEY（如 IN_REVIEW）": "ACC_KEY", "名称": "验收状态" }, click: "添加状态", endpoint: /\/states$/ },
  { name: "insights", path: "__insights", prepare: async (page) => {
    await page.getByRole("tab", { name: "仪表盘", exact: true }).click();
    await clickExact(page, "新建仪表盘");
  }, fields: { "仪表盘名称": "验收仪表盘" }, click: "创建", endpoint: /\/dashboards$/ },
  { name: "intake", path: "__intake", prepare: (page) => page.getByRole("tab", { name: "收集表单", exact: true }).click(), fields: { "表单名称": "验收表单" }, click: "新建表单", endpoint: /\/intake-forms$/ },
  { name: "focus-redirect", path: "/focus", redirect: "/workbench" },
  { name: "fields", path: "__fields", prepare: (page) => clickExact(page, "新建字段"), fields: { "字段 key": "acceptance_key", "字段名称": "验收字段" }, click: "创建", expect: "inline", endpoint: /\/custom-fields$/ },
  // 导入失败贴近文件字段显示，且已选择的真实文件仍可重试。
  { name: "import", path: "__import", file: "/tmp/accept-import.csv", click: "上传并解析", expect: "inline", endpoint: /\/imports$/ },
  { name: "workbench", path: "/workbench", fields: { "要做的事": "验收待办" }, click: "添加", endpoint: /\/todos$/ },
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
      catch (e) {
        await page.screenshot({ path: `/tmp/accept-${cc.name}.png` }).catch(() => {});
        results.push({ name: cc.name, pass: false, error: String(e).slice(0, 300) });
      }
    }
  } else {
    const [path, click, ...fills] = args;
    const fill = {}; fills.forEach((kv, i) => { const [k, ...v] = kv.split("="); fill[k ?? i] = v.join("="); });
    results.push(await runCase(page, { name: "single", path, click, fill }));
  }

  console.log("\n══ 验收结果 ══");
  for (const r of results) {
    if (r.error) { console.log(`  ✗ ${r.name}: ${r.error}`); continue; }
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name.padEnd(10)} 期望=${(r.expect ?? "toast").padEnd(6)} toast=${JSON.stringify(r.state.toast)} 表单错误=${JSON.stringify(r.state.formErrors)} 提交=${r.submitted ?? "—"} 输入保留=${r.retained ?? "—"} ｜ ${r.shot}`);
  }
  const ok = results.filter((r) => r.pass).length;
  console.log(`  ── ${ok}/${results.length} 通过`);
  await b.close();
  process.exit(ok === results.length ? 0 : 1);
}
main();
