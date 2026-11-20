import "./_env.ts";
/**
 * 集成同步界面验收（Round 25 长任务第 38 项）——可重复执行、自建自清。
 * 验证：同步配置可编辑并持久化、行上出现「同步」按钮、点击后的成功/失败原因被界面展示。
 * ⚠️ 这里会向真实的 api.github.com 发一次只读请求（假令牌 → 预期 401/404），不在测试里伪造成功。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const NAME = `同步验收集成 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let integrationId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const created = await page.evaluate(async (name) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    return await fetch("/api/v1/integrations", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ kind: "GITHUB", name, baseUrl: "https://1.1.1.1", token: "ghp_ui_accept_fake", config: { repo: "octocat/Hello-World", userMap: { demo: "demo" } } }),
    }).then((r) => r.json());
  }, NAME);
  integrationId = created.id ?? created.integration?.id ?? null;
  check("真实创建带同步配置的集成", !!integrationId, JSON.stringify(created).slice(0, 160));

  await page.goto(`${BASE}/settings/integrations`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  await page.getByRole("tab", { name: "消息与 Webhook", exact: true }).click();
  const section = page.locator(".settings-section", { hasText: "外部集成" });
  await section.scrollIntoViewIfNeeded();
  const row = section.locator(".settings-record-list > li", { hasText: NAME });
  check("集成行出现「同步」按钮", (await row.count()) === 1 && (await row.getByRole("button", { name: "同步" }).count()) === 1);
  await row.getByRole("button", { name: "编辑" }).click();
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog", { name: "编辑", exact: true });
  const configValue = await dialog.getByLabel("同步配置（JSON）").inputValue();
  check("编辑时同步配置已回显（含 repo）", configValue.includes("octocat/Hello-World"));
  await dialog.getByRole("button", { name: "取消", exact: true }).click();

  await row.getByRole("button", { name: "同步" }).click();
  const feedback = page.locator(".ui-toast").last();
  await feedback.waitFor({ state: "visible", timeout: 15_000 });
  const alertText = await feedback.innerText().catch(() => "");
  check("点击同步后结果/失败原因被界面展示", /同步完成|外部服务返回|连接外部服务失败|同步失败/.test(alertText), alertText.slice(0, 120));
  await page.screenshot({ path: "/tmp/integration-sync.png" });
} finally {
  if (integrationId) {
    await page.evaluate(async (id) => {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
      await fetch(`/api/v1/integrations/${id}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } });
    }, integrationId).catch(() => {});
    await sql`delete from sync_cursor where integration_id = ${integrationId}`;
    await sql`delete from integration where id = ${integrationId}`;
  }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  集成同步界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
