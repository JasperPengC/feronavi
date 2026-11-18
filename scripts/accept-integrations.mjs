import "./_env.ts";
/**
 * 外部集成设置界面验收（Round 25 长任务第 20 项）——可重复执行、自建自删。
 *
 * 覆盖：新建（令牌只显示"已配置"、页面不出现明文）、SSRF 失败原因展示、编辑改名、
 * 停用/启用、两步确认删除。前置：本地 3000 服务 + 本机 Chrome + demo 管理员。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const stamp = Date.now().toString(36).slice(-5);
const NAME = `验收集成 ${stamp}`;
const SECRET = `glpat-accept-${stamp}-secret`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const section = page.locator(".settings-section", { hasText: "外部集成" });
  await section.scrollIntoViewIfNeeded();
  check("设置页出现「外部集成」区块", (await section.count()) === 1);

  // ① 新建
  await section.getByLabel("名称").fill(NAME);
  await section.getByLabel("服务地址（https）").fill("https://gitlab.com");
  await section.getByLabel("访问令牌").fill(SECRET);
  await section.getByRole("button", { name: "新建集成" }).click();
  await page.waitForTimeout(1400);
  const row = section.locator(".settings-record-list li", { hasText: NAME });
  check("新建后列表出现该集成", (await row.count()) === 1);
  check("令牌只显示「已配置」且页面无明文", (await row.innerText()).includes("令牌已配置") && !(await page.locator("body").innerText()).includes(SECRET));

  // ② SSRF：不安全地址的失败原因原样展示，且不新增行
  await section.getByLabel("名称").fill(`SSRF ${stamp}`);
  await section.getByLabel("服务地址（https）").fill("http://127.0.0.1:8080");
  await section.getByLabel("访问令牌").fill("glpat-ssrf");
  await section.getByRole("button", { name: "新建集成" }).click();
  await page.waitForTimeout(1100);
  const alert = page.locator(".alert-error").last();
  check("不安全地址显示后端拒绝原因", (await alert.count()) > 0 && /不允许|地址|协议|http/i.test(await alert.innerText()), await alert.innerText().catch(() => ""));
  check("SSRF 失败不产生新行", (await section.locator(".settings-record-list li", { hasText: `SSRF ${stamp}` }).count()) === 0);

  // ③ 编辑改名
  await row.getByRole("button", { name: "编辑" }).click();
  await section.getByLabel("名称").fill(`${NAME}（改）`);
  await section.getByRole("button", { name: "保存修改" }).click();
  await page.waitForTimeout(1200);
  check("编辑后名称已更新", (await section.locator(".settings-record-list li", { hasText: `${NAME}（改）` }).count()) === 1);

  // ④ 停用 / 启用
  const row2 = section.locator(".settings-record-list li", { hasText: `${NAME}（改）` });
  await row2.getByRole("button", { name: "停用" }).click();
  await page.waitForTimeout(1000);
  check("停用后显示「已停用」", (await row2.innerText()).includes("已停用"));
  await row2.getByRole("button", { name: "启用" }).click();
  await page.waitForTimeout(1000);
  check("可再次启用", !(await row2.innerText()).includes("已停用"));
  await page.screenshot({ path: "/tmp/integration-settings.png" });

  // ⑤ 两步确认删除
  await row2.getByRole("button", { name: "删除" }).click();
  await page.waitForTimeout(300);
  check("删除需要二次确认", (await row2.getByRole("button", { name: "确认删除" }).count()) === 1);
  await row2.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(1200);
  check("确认后列表行消失", (await section.locator(".settings-record-list li", { hasText: `${NAME}（改）` }).count()) === 0);
} finally {
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  外部集成设置验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
