import "./_env.ts";
/**
 * MCP npx 桥验收：真实令牌 + 真实 /api/v1/mcp，不依赖本地数据库。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const BASE = process.env.BASE;
const checks = [];
const check = (n, p, d = "") => { checks.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
let tokenId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const created = await page.evaluate(async () => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || "");
    const r = await fetch("/api/v1/tokens", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ name: `npx mcp ${Date.now()}`, tier: "READ_ONLY" }) });
    return { status: r.status, body: await r.json() };
  });
  tokenId = created.body?.row?.id ?? null;
  check("创建只读 MCP 令牌", created.status === 201 && !!created.body.token, String(created.status));

  const child = spawn(process.execPath, ["packages/feronavi-mcp/bin/feronavi-mcp.mjs", "--url", BASE, "--token", created.body.token], { stdio: ["pipe", "pipe", "pipe"] });
  let out = ""; let err = "";
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { err += d; });
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "acceptance", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } });
  await new Promise((r) => setTimeout(r, 2500)); child.kill();
  const messages = out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byId = (id) => messages.find((m) => m.id === id);
  check("initialize 成功", !!byId(1)?.result?.serverInfo, JSON.stringify(byId(1)?.result?.serverInfo ?? {}));
  check("tools/list 返回工具", (byId(2)?.result?.tools?.length ?? 0) > 10, String(byId(2)?.result?.tools?.length ?? 0));
  check("whoami 经服务端鉴权成功", (byId(3)?.result?.content?.[0]?.text ?? "").includes("username"), err.slice(0, 80));
} catch (e) { console.error("  ❌", e); checks.push(false); }
finally {
  if (tokenId) await page.evaluate(async (id) => { const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/) || [])[1] || ""); await fetch(`/api/v1/tokens/${id}`, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": csrf } }); }, tokenId).catch(() => {});
  await ctx.close(); await browser.close();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  MCP npx 验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
