import "./_env.ts";
/**
 * MCP 客户端策略界面验收（Round 25 长任务第 26 项）——可重复执行、自建自删。
 *
 * 用真实 API 创建令牌 → 真实 MCP initialize/tools-call 让客户端被记录 →
 * 在设置页把 `ping` 设为 DENY → 回到 MCP 再调 ping，确认被策略拦截。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const TOKEN_NAME = `MCP 验收令牌 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let tokenId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async (name) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const t = await fetch("/api/v1/tokens", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ name, tier: "READ_WRITE" }) }).then((r) => r.json());
    const rpc = async (body) => {
      const r = await fetch("/api/v1/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ui-accept", version: "1.0" } } });
    const ping = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } });
    return { tokenId: t.row?.id, token: t.token, initOk: init.status === 200, ping: JSON.stringify(ping.json) };
  }, TOKEN_NAME);
  tokenId = prep.tokenId;
  check("真实创建令牌并 MCP initialize", !!tokenId && prep.initOk, String(prep.initOk));

  await page.goto(`${BASE}/tokens`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "MCP 客户端", exact: true }).click();
  const section = page.locator(".settings-section", { hasText: "MCP 客户端" });
  await section.scrollIntoViewIfNeeded();
  check("设置页出现「MCP 客户端」区块", (await section.count()) === 1);
  const row = section.locator(".settings-record-list > li", { hasText: TOKEN_NAME });
  check("客户端行包含令牌名与客户端信息", (await row.count()) === 1 && (await row.innerText()).includes("ui-accept"), (await row.innerText()).replace(/\n/g, " | "));
  check("调用次数已显示", /调用 \d+ 次/.test(await row.innerText()));

  await row.getByRole("button", { name: "编辑策略" }).click();
  await section.getByLabel("工具名").fill("ping");
  await section.getByRole("button", { name: "添加策略" }).click();
  await section.getByRole("button", { name: "保存策略" }).click();
  await page.waitForTimeout(1300);
  check("保存后行内显示 ping=DENY", (await row.innerText()).includes("ping=DENY"), (await row.innerText()).replace(/\n/g, " | "));

  // 用同一个真实令牌再调 MCP：确认策略真的**拦截执行**（不只是界面上显示）
  const mcpAfter = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${prep.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: {} } }),
  });
  const mcpBody = await mcpAfter.json().catch(() => null);
  const resultText = String(mcpBody?.result?.content?.[0]?.text ?? "");
  check("保存后真实 MCP 调用被 DENY 拦截", mcpBody?.result?.isError === true && resultText.includes("已被管理员策略禁用"), resultText.slice(0, 120));

  const denied = await page.evaluate(async (tid) => {
    const r = await fetch(`/api/v1/mcp-clients`, { credentials: "same-origin" });
    const d = await r.json();
    const c = (d.clients ?? []).find((x) => x.tokenId === tid);
    return c?.policies ?? [];
  }, tokenId);
  check("后端策略已落库（ping=DENY）", denied.some((p) => p.toolName === "ping" && p.effect === "DENY"), JSON.stringify(denied));
  await page.screenshot({ path: "/tmp/mcp-policy.png" });
} finally {
  if (tokenId) {
    await sql`delete from mcp_tool_policy where token_id = ${tokenId}`;
    await sql`delete from mcp_client where token_id = ${tokenId}`;
    await sql`delete from api_token where id = ${tokenId}`;
  }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  MCP 客户端策略界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
