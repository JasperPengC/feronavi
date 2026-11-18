import "./_env.ts";
/**
 * Webhook 投递记录界面验收（Round 25 长任务第 21 项）——可重复执行、自建自删。
 *
 * 用 UI 创建端点（真实接口，URL 过 SSRF 校验），再用数据库夹具插入一条 DEAD 投递
 * （模拟 worker 投递失败后的死信），验证设置页能看待投递状态/尝试次数/响应码并出现「重放」。
 * 重放本身需真实出站请求，由 e2e-webhooks（注入假接收端）覆盖；本脚本不触发出站。
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const NAME = `投递验收 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
let endpointId = null;
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const created = await page.evaluate(async (name) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const r = await fetch("/api/v1/webhooks", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ name, url: "https://example.com/hook", events: ["work_item.created"] }) });
    return { status: r.status, body: await r.json() };
  }, NAME);
  endpointId = created.body?.endpoint?.id ?? null;
  check("真实接口创建 Webhook 端点", created.status === 201 && !!endpointId, JSON.stringify(created.status));
  await sql`insert into webhook_delivery (endpoint_id, event, payload, status, attempts, response_code, error)
    values (${endpointId}, 'work_item.created', ${sql.json({ workItemKey: `ACC-${stamp}` })}, 'DEAD', 5, 500, 'connection refused')`;
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const section = page.locator(".settings-section", { hasText: "集成（Webhook 出站）" });
  await section.scrollIntoViewIfNeeded();
  const row = section.locator(".settings-record-list > li", { hasText: NAME });
  check("设置页列出该端点", (await row.count()) === 1);
  await row.getByRole("button", { name: "投递记录" }).click();
  await page.waitForTimeout(1000);
  const text = await row.innerText();
  check("投递记录显示「已死信」", text.includes("已死信"), text.replace(/\n/g, " | "));
  check("显示尝试次数 5", text.includes("尝试 5 次"));
  check("显示响应码 500", text.includes("响应 500"));
  check("死信记录出现「重放」按钮", (await row.getByRole("button", { name: "重放" }).count()) === 1);
  await page.screenshot({ path: "/tmp/webhook-deliveries.png" });
} finally {
  if (endpointId) await sql`delete from webhook_endpoint where id = ${endpointId}`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  Webhook 投递记录验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
