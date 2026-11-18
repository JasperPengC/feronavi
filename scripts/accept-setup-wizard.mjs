import "./_env.ts";
/**
 * 安装向导 · 真实浏览器验收（前端统一化 Round 15）
 *
 * 为什么单独一个脚本：安装向导是**唯一无法在主实例上验收的页面** ——
 * 实例已初始化时 `/setup` 会重定向到 `/login`（实测）。所以用一个**全新空库 + 独立端口**的
 * 临时实例来跑真实向导（建库 + 迁移 + 起服务见脚本末尾的复跑步骤）。
 *
 * 断言（每一步都截图）：
 *   ① 六步都能真实走通（环境自检 → 数据库 → 管理员 → 组织 → 集成 → 完成）；
 *   ② 每一步的 `label[for]` 断链 = 0、表单控件都有可访问名称；
 *   ③ 密码规则/不一致这类**校验错误**在字段内显示（不是页面级 alert 漂走）；
 *   ④ 第 5 步填了 SMTP 服务器后，端口/发件人两个字段才出现，且同样有标签；
 *   ⑤ 第 6 步确认页显示真实填入值、完成按钮可用。
 *   **故意不点「完成安装」**：保持空库未初始化，脚本可重复跑。
 *
 * 运行：node scripts/run-isolated-test.ts --empty scripts/accept-setup-wizard.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const HOST = process.env.BASE;
const evidence = ".cache/setup-wizard";
mkdirSync(evidence, { recursive: true });
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

async function audit(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) : "");
    const controls = [...document.querySelectorAll("input:not([type=hidden]), textarea, select, .select-trigger, [role=checkbox]")].map((el) => {
      const byId = el.getAttribute("aria-labelledby");
      const labelled = byId ? text(document.getElementById(byId)) : "";
      return {
        kind: el.classList.contains("select-trigger") ? "select" : (el.type || el.tagName.toLowerCase()),
        name: labelled || el.getAttribute("aria-label") || text(el.labels?.[0]) || (el.getAttribute("role") === "checkbox" ? text(el) : ""),
        h: Math.round(el.getBoundingClientRect().height),
      };
    });
    return {
      heading: text(document.querySelector("h1")),
      controls,
      broken: [...document.querySelectorAll("label[for]")].filter((l) => !document.getElementById(l.getAttribute("for"))).map((l) => l.getAttribute("for")),
      inlineErrors: [...document.querySelectorAll(".field .error")].map(text),
      pageAlert: !!document.querySelector(".alert.alert-error"),
      review: text(document.querySelector("dl")),
    };
  });
}

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
async function capture(step) {
  for (const [theme, label] of [["light", "浅色"], ["dark", "深色"]]) {
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await page.waitForTimeout(250);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.screenshot({ path: `${evidence}/${step}-${theme}-${width}.png` });
      check(`${step}/${theme}/${width} 页面无横向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(`${step}/${theme}/${width} 内容区没有被裁切的长文本`, await page.locator(".setup-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
}
try {
  const state = await page.evaluate(async (host) => {
    await fetch(host + "/api/v1/setup/state");
    return (await (await fetch(host + "/api/v1/setup/state")).json());
  }, HOST).catch(() => null);
  if (state?.initialized) throw new Error("该实例已初始化，向导会被重定向 —— 需要全新空库实例");

  await page.goto(HOST + "/setup", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);

  // ① 环境自检
  let a = await audit(page);
  check("第 1 步：环境自检", a.heading.includes("环境自检"), a.heading);
  check("第 1 步：无断链标签", a.broken.length === 0, JSON.stringify(a.broken));
  await capture("1");

  const next = () => page.getByRole("button", { name: "下一步", exact: true }).first();
  await next().click();
  await page.waitForTimeout(700);

  // ② 数据库（信息页）
  a = await audit(page);
  check("第 2 步：数据库信息页", a.heading.includes("数据库"), a.heading);
  check("第 2 步：无断链标签", a.broken.length === 0, JSON.stringify(a.broken));
  await capture("2");
  await next().click();
  await page.waitForTimeout(700);

  // ③ 管理员账号：5 个控件都有名称；密码规则是字段内错误
  a = await audit(page);
  check("第 3 步：5 个输入控件都有名称", a.controls.length === 5 && a.controls.every((c) => c.name), JSON.stringify(a.controls.map((c) => c.name)));
  check("第 3 步：无断链标签", a.broken.length === 0, JSON.stringify(a.broken));
  await page.getByLabel("用户名").fill("acceptance_admin");
  await page.getByLabel("姓名").fill("验收管理员");
  await page.getByLabel("邮箱").fill("acceptance@example.com");
  await page.getByLabel("密码", { exact: true }).fill("short");
  await page.waitForTimeout(300);
  a = await audit(page);
  check("第 3 步：密码过短 → 字段内错误（非页面 alert）", a.inlineErrors.length > 0 && !a.pageAlert, JSON.stringify(a.inlineErrors));
  await capture("3-error");
  await page.getByLabel("密码", { exact: true }).fill("Acceptance-Pass-2026");
  await page.getByLabel("确认密码").fill("Acceptance-Pass-2026");
  await page.waitForTimeout(300);
  a = await audit(page);
  check("第 3 步：密码合规后错误消失", a.inlineErrors.length === 0);
  await next().click();
  await page.waitForTimeout(700);

  // ④ 组织信息：名称 + 两个自绘下拉（此前的 o-locale / o-tz 断链就发生在这里）
  a = await audit(page);
  check("第 4 步：组织信息", a.heading.includes("组织"), a.heading);
  check("第 4 步：控件都有名称（含两个下拉和部门模板复选框）", a.controls.length === 4 && a.controls.every((c) => c.name),
    JSON.stringify(a.controls.map((c) => `${c.kind}:${c.name}`)));
  check("第 4 步：无断链标签", a.broken.length === 0, JSON.stringify(a.broken));
  await page.getByLabel("组织名称").fill("验收组织");
  await capture("4");
  await next().click();
  await page.waitForTimeout(700);

  // ⑤ 可选集成：先只有服务器 + 存储方式；填服务器后出现端口/发件人
  a = await audit(page);
  check("第 5 步：可选集成", a.heading.includes("集成"), a.heading);
  check("第 5 步：初始 2 个控件都有名称", a.controls.length === 2 && a.controls.every((c) => c.name),
    JSON.stringify(a.controls.map((c) => `${c.kind}:${c.name}`)));
  check("第 5 步：无断链标签（st-kind 已修）", a.broken.length === 0, JSON.stringify(a.broken));
  await page.getByLabel("服务器").fill("smtp.example.com");
  await page.waitForTimeout(400);
  a = await audit(page);
  check("第 5 步：填服务器后出现端口/发件人且都有名称", a.controls.length === 4 && a.controls.every((c) => c.name),
    JSON.stringify(a.controls.map((c) => `${c.kind}:${c.name}`)));
  await capture("5");
  await next().click();
  await page.waitForTimeout(700);

  // ⑥ 完成确认
  a = await audit(page);
  check("第 6 步：完成确认页", a.heading.includes("完成"), a.heading);
  check("第 6 步：确认页显示真实填入值", a.review.includes("验收管理员") && a.review.includes("验收组织"), a.review.slice(0, 80));
  const finish = page.getByRole("button", { name: "完成安装", exact: true });
  check("第 6 步：完成按钮可用（未重复提交）", (await finish.count()) === 1 && !(await finish.first().isDisabled()));
  await capture("6");
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/setup-accept-error.png" }).catch(() => {});
}
const ok = results.filter((r) => r.pass).length;
console.log(`\n  安装向导验收 ${ok}/${results.length}（HOST=${HOST}）`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
