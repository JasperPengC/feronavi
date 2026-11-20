import "./_env.ts";
/**
 * AI 模型配置界面验收（Round 77）——真实浏览器，自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
const created = [];
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/settings/integrations`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
  const section = page.locator(".ai-provider-card").first();
  await section.scrollIntoViewIfNeeded();
  check("集成页分别显示 LLM 和 Embedding 供应商区块", (await page.locator(".ai-provider-card").count()) === 2);

  const createProvider = async (suffix) => {
    await section.getByRole("button", { name: "添加供应商", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "AI 供应商类型" }).click();
    await page.getByRole("option", { name: /Ollama/i }).click();
    await dialog.getByLabel("LLM Base URL", { exact: true }).fill(`https://example.com/ollama-${STAMP}-${suffix}`);
    await dialog.getByLabel("LLM model", { exact: true }).fill(`mock-${STAMP}-${suffix}`);
    await dialog.getByLabel("LLM API Key", { exact: true }).fill("sk-acceptance-dummy");
    await dialog.getByRole("button", { name: "保存供应商", exact: true }).click();
    await page.waitForTimeout(1200);
  };
  await createProvider("a");
  await createProvider("b");
  const listText = await section.innerText();
  check("UI 创建两个供应商并列表展示", listText.includes(`example.com/ollama-${STAMP}-a`) && listText.includes(`example.com/ollama-${STAMP}-b`));
  check("首个供应商标记为默认", listText.includes("默认"));
  const rows = await sql`select id, is_default from ai_provider_config where base_url like ${`https://example.com/ollama-${STAMP}-%`} order by created_at`;
  rows.forEach((r) => created.push(r.id));
  check("默认状态真实入库且唯一", rows.length === 2 && rows.filter((r) => r.is_default).length === 1, JSON.stringify(rows));

  const firstRowForDefault = section.locator("li", { hasText: `ollama-${STAMP}-a` });
  const firstSetDefault = firstRowForDefault.getByRole("button", { name: "设为默认", exact: true });
  if ((await firstSetDefault.count()) > 0) {
    await firstSetDefault.click();
    await page.waitForTimeout(800);
  }
  const secondRow = section.locator("li", { hasText: `ollama-${STAMP}-b` });
  await secondRow.getByRole("button", { name: "设为默认", exact: true }).click();
  await page.waitForTimeout(1000);
  const defaults = await sql`select base_url from ai_provider_config where base_url like ${`https://example.com/ollama-${STAMP}-%`} and is_default = true`;
  check("UI 设为默认真实生效", defaults.length === 1 && defaults[0].base_url.includes("-b"), JSON.stringify(defaults));

  // 连接测试：example.com 无 /api/tags，真实失败路径必须如实显示
  const firstRow = section.locator("li", { hasText: `ollama-${STAMP}-a` });
  await firstRow.getByRole("button", { name: "测试连接", exact: true }).click();
  // 服务端连接测试超时是 8s；等待必须 ≥ 服务端上限，否则慢网络下会把“仍在请求”误判为“未落库”
  await page.waitForTimeout(9000);
  const failText = await section.innerText();
  const [tested] = await sql`select last_test_ok, last_test_error from ai_provider_config where id = ${created[0]}`;
  check("连接测试失败如实显示并落库", !!tested?.last_test_error && failText.includes(tested.last_test_error) && tested.last_test_ok === false);

  await firstRow.getByRole("button", { name: "停用", exact: true }).click();
  await page.waitForTimeout(900);
  const [disabled] = await sql`select is_active from ai_provider_config where id = ${created[0]}`;
  check("UI 停用真实生效", disabled?.is_active === false);
  await secondRow.getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForTimeout(300);
  const stillThere = await sql`select count(*)::int as n from ai_provider_config where id = ${created[1]}`;
  check("危险操作第一次点击只进入确认态（不删除）", stillThere[0].n === 1 && (await secondRow.innerText()).includes("确认删除"));
  await secondRow.getByRole("button", { name: "确认删除？", exact: true }).click();
  await page.waitForTimeout(900);
  const left = await sql`select count(*)::int as n from ai_provider_config where id = ${created[1]}`;
  check("UI 确认后删除真实生效", left[0].n === 0);
  await page.screenshot({ path: "/tmp/ai-settings.png" });
} finally {
  try {
    await sql`delete from ai_provider_config where base_url like ${`https://example.com/ollama-${STAMP}-%`}`;
    await sql`delete from setting where key like 'ai.%'`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  AI 模型配置验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
