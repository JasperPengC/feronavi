import "./_env.ts";   // 环境预设必须最先加载
/**
 * MCP 客户端观测与工具级策略自检（Round 25 长任务第 25 项，规范 9 节 / REST 11 节）：
 * 客户端 initialize 记录名字/版本、调用计数、策略 DENY 优先于令牌档位、整体替换、权限与审计。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { apiToken, auditEntry, member, mcpClient, mcpToolPolicy, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "mcp-pol-admin";
const GUEST = "mcp-pol-member";
const PW = "mcp-pol-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "MCP 策略管理员", ar!.id);
await mk(GUEST, "MCP 普通成员", mr!.id);
const admin = (await loadActor(adminId))!;
const { token, row: tokenRow } = await tokenService.createToken(admin, { name: "策略自检令牌", tier: "READ_WRITE" });

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const rpc = async (body: unknown) => {
  const res = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;   // eslint-disable-line @typescript-eslint/no-explicit-any -- MCP 响应按 fixture 断言
  try { json = JSON.parse(text); } catch { /* SSE 原文 */ }
  return { status: res.status, json, text };
};
const call = (name: string) => rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name, arguments: {} } });
const loginCookie = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return {
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(csrfToken),
  };
};

try {
  // ① initialize + 调用 → 客户端被记录
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "policy-e2e", version: "2.3" } } });
  ok("MCP initialize 成功", init.status === 200 && init.json?.result?.serverInfo?.name === "feronavi", String(init.status));
  const ping = await call("ping");
  ok("ping 工具可调用", ping.json?.result && !ping.json?.result?.isError, JSON.stringify(ping.json?.result));
  const who = await call("whoami");
  ok("whoami 工具可调用", who.json?.result && !who.json?.result?.isError);

  const H = { ...(await loginCookie(ADMIN)), "content-type": "application/json" };
  const list = await fetch(`${BASE}/api/v1/mcp-clients`, { headers: { cookie: H.cookie } });
  const listed = await list.json() as { clients?: { id: string; tokenId: string; tokenName: string; clientName: string | null; callCount: number; policies: unknown[] }[] };
  const client = (listed.clients ?? []).find((c) => c.tokenId === tokenRow.id);
  ok("GET /mcp-clients 记录令牌与客户端信息", list.status === 200 && client?.clientName === "policy-e2e" && client?.tokenName === "策略自检令牌", JSON.stringify(client));
  ok("调用计数已累加", (client?.callCount ?? 0) >= 2, String(client?.callCount));

  // ② DENY 策略：档位允许也拒绝
  const put = (policies: unknown[]) => fetch(`${BASE}/api/v1/mcp-clients/${client!.id}/policy`, {
    method: "PUT", headers: H, body: JSON.stringify({ policies }),
  });
  const deniedPut = await put([{ toolName: "ping", effect: "DENY" }]);
  ok("设置 DENY 策略 200", deniedPut.status === 200, String(deniedPut.status));
  const deniedCall = await call("ping");
  ok("DENY 后 ping 被拒绝（优先于令牌档位）",
    deniedCall.json?.result?.isError === true && String(deniedCall.json?.result?.content?.[0]?.text ?? "").includes("已被管理员策略禁用"),
    JSON.stringify(deniedCall.json?.result));
  const other = await call("whoami");
  ok("未配置 DENY 的其它工具不受影响", other.json?.result && !other.json?.result?.isError);

  // ③ 校验
  ok("未知工具名 → 400", (await put([{ toolName: "no.such.tool", effect: "DENY" }])).status === 400);
  ok("重复工具名 → 400", (await put([{ toolName: "ping", effect: "DENY" }, { toolName: "ping", effect: "ALLOW" }])).status === 400);
  const guestH = await loginCookie(GUEST);
  ok("无 apikey:manage_any 读 → 403", (await fetch(`${BASE}/api/v1/mcp-clients`, { headers: { cookie: guestH.cookie } })).status === 403);
  ok("无 apikey:manage_any 写策略 → 403", (await fetch(`${BASE}/api/v1/mcp-clients/${client!.id}/policy`, {
    method: "PUT", headers: { ...guestH, "content-type": "application/json" },
    body: JSON.stringify({ policies: [] }),
  })).status === 403);

  // ④ 整体替换：清空策略后恢复
  const cleared = await put([]);
  ok("清空策略 200", cleared.status === 200, String(cleared.status));
  const again = await call("ping");
  ok("清空策略后 ping 恢复可用", again.json?.result && !again.json?.result?.isError);

  // ⑤ 审计
  const audits = await db.select().from(auditEntry).where(eq(auditEntry.action, "mcp.policy_updated"));
  ok("策略写入落 SECURITY 审计", audits.length >= 2 && audits.every((a) => a.severity === "SECURITY"), String(audits.length));
} finally {
  await app.close();
  await db.delete(mcpToolPolicy);
  await db.delete(mcpClient);
  await db.delete(apiToken).where(eq(apiToken.id, tokenRow.id));
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
