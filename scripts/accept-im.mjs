import "./_env.ts";
/**
 * IM 集成界面验收（Round 76）——真实浏览器 + 本地模拟 webhook，自建自清。
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const NAME = `验收飞书群${STAMP}`;
const APP_NAME = `验收钉钉应用${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const received = [];
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    try { received.push(JSON.parse(raw)); } catch { received.push(raw); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: 0, msg: "ok" }));
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", () => r()));
const hookUrl = `http://127.0.0.1:${mock.address().port}/hook/${STAMP}`;
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
  await page.getByText("IM 集成（钉钉 / 企微 / 飞书）", { exact: true }).waitFor({ timeout: 15_000 });
  check("设置页显示 IM 集成区块", true);

  const section = page.locator(".settings-section", { hasText: "IM 集成（钉钉 / 企微 / 飞书）" }).first();
  await section.locator('[aria-label="提供方"]').click();
  await page.getByRole("option", { name: "飞书", exact: true }).click();
  await section.getByLabel("渠道名称", { exact: true }).fill(NAME);
  await section.getByLabel("Webhook 地址", { exact: true }).fill(hookUrl);
  await section.getByRole("button", { name: "添加 IM 渠道", exact: true }).click();
  await page.waitForTimeout(1500);
  check("UI 创建渠道后列表出现", (await section.innerText()).includes(NAME));
  const [row] = await sql`select id, webhook_url_encrypted from im_channel where name = ${NAME}`;
  check("Webhook 真实入库且为密文", !!row?.id && !!row?.webhook_url_encrypted && !String(row.webhook_url_encrypted).includes(hookUrl));

  await section.locator("li", { hasText: NAME }).getByRole("button", { name: "测试", exact: true }).click();
  await page.waitForTimeout(1500);
  check("点击测试后 mock webhook 收到请求", received.length === 1 && JSON.stringify(received[0]).includes("Feronavi IM 集成测试"));
  check("UI 显示最近测试成功", (await section.innerText()).includes("最近测试") && (await section.innerText()).includes("✓"));
  // 应用模式（钉钉自建应用）：UI 保存 AppKey/AppSecret/AgentId/接收人，列表显示应用消息，不发起真实厂商请求
  await section.locator('[aria-label="提供方"]').click();
  await page.getByRole("option", { name: "钉钉", exact: true }).click();
  await section.getByLabel("渠道名称", { exact: true }).fill(APP_NAME);
  await section.getByLabel("AppKey（可选）", { exact: true }).fill(`ak-${STAMP}`);
  await section.getByLabel("AppSecret（可选）", { exact: true }).fill(`as-${STAMP}`);
  await section.getByLabel("AgentId（可选）", { exact: true }).fill("1001");
  await section.getByLabel("应用消息接收人", { exact: true }).fill("u1,u2");
  await section.getByRole("button", { name: "添加 IM 渠道", exact: true }).click();
  await page.waitForTimeout(1400);
  const appText = await section.innerText();
  check("UI 创建应用模式渠道并显示接收人数", appText.includes(APP_NAME) && appText.includes("应用消息") && appText.includes("2"), appText.slice(0, 120));
  const [appRow] = await sql`select recipients, webhook_url_encrypted from im_channel where name = ${APP_NAME}`;
  check("应用模式仅存接收人、未伪造 Webhook", appRow?.recipients === "u1,u2" && !appRow?.webhook_url_encrypted, JSON.stringify(appRow));
  await page.screenshot({ path: "/tmp/im-app-settings.png" });
} finally {
  try { await sql`delete from im_channel where name in (${NAME}, ${APP_NAME})`; await sql`delete from job where kind = 'im.send'`; } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close(); mock.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  IM 集成验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
