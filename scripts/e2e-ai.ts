import "./_env.ts";   // 环境预设必须最先加载
/** AI 模型配置（Round 77）：CRUD/默认/停用/连接测试/密钥脱敏/权限 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { aiProviderConfig, auditEntry, member, role, roleAssignment, setting as settingTable } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as ai from "../src/server/services/ai-config.service.ts";
import { eq, like } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "ai-admin";
const GUEST = "ai-guest";
const PW = "ai-pass-123456";
const STAMP = Date.now().toString(36).slice(-5);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "AI 管理员", ar!.id);
await mk(GUEST, "AI 成员", mr!.id);
const admin = (await loadActor(adminId))!;

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
let ids: string[] = [];
try {
  const H = await login(ADMIN);
  const G = await login(GUEST);
  ok("非管理员访问 AI 配置 → 403", (await fetch(`${BASE}/api/v1/ai/providers`, { headers: { cookie: G.cookie } })).status === 403);

  const c1 = await fetch(`${BASE}/api/v1/ai/providers`, {
    method: "POST", headers: H,
    body: JSON.stringify({ provider: "OPENAI_COMPAT", baseUrl: "https://1.1.1.1/v1", model: `chat-${STAMP}`, embeddingModel: "bge-m3", apiKey: "sk-secret-key" }),
  });
  const p1 = (await c1.json() as { id: string }).id;
  ids.push(p1);
  const c2 = await fetch(`${BASE}/api/v1/ai/providers`, {
    method: "POST", headers: H,
    body: JSON.stringify({ provider: "OLLAMA", baseUrl: "https://1.1.1.1/ollama", model: `chat2-${STAMP}`, embeddingModel: "nomic-embed-text" }),
  });
  const p2 = (await c2.json() as { id: string }).id;
  ids.push(p2);
  ok("创建两个供应商 201（OpenAI 兼容 + Ollama）", c1.status === 201 && c2.status === 201);
  const listRaw = await (await fetch(`${BASE}/api/v1/ai/providers`, { headers: { cookie: H.cookie } })).text();
  ok("列表不泄露 API Key 明文/密文", !listRaw.includes("sk-secret-key") && !listRaw.includes("apiKeyEncrypted") && listRaw.includes("hasApiKey"));
  const list = JSON.parse(listRaw) as { providers: { id: string; isDefault: boolean; isActive: boolean }[] };
  ok("第一个供应商自动成为默认，第二个不是", list.providers.find((p) => p.id === p1)?.isDefault === true && list.providers.find((p) => p.id === p2)?.isDefault === false, JSON.stringify(list.providers.map((p) => [p.id === p1, p.isDefault])));

  const setDefault = await fetch(`${BASE}/api/v1/ai/providers/${p2}/default`, { method: "POST", headers: H, body: JSON.stringify({}) });
  ok("设默认 200", setDefault.status === 200);
  const afterDefault = await (await fetch(`${BASE}/api/v1/ai/providers`, { headers: { cookie: H.cookie } })).json() as { providers: { id: string; isDefault: boolean }[] };
  ok("默认切换成功且唯一", afterDefault.providers.find((p) => p.id === p2)?.isDefault === true && afterDefault.providers.filter((p) => p.isDefault).length === 1, JSON.stringify(afterDefault.providers.map((p) => [p.id === p2, p.isDefault])));

  // 停用默认供应商 → 不能设为默认；停用后默认不变但不可用
  await fetch(`${BASE}/api/v1/ai/providers/${p2}`, { method: "PATCH", headers: H, body: JSON.stringify({ isActive: false }) });
  const setInactiveDefault = await fetch(`${BASE}/api/v1/ai/providers/${p2}/default`, { method: "POST", headers: H, body: JSON.stringify({}) });
  ok("已停用供应商设默认 → 400", setInactiveDefault.status === 400, String(setInactiveDefault.status));

  // 真实连接测试（fetch 打桩：成功/失败路径都要覆盖；真实出站受 SSRF 限制，本地无法用内网 mock）
  const realFetch = globalThis.fetch;
  let capturedUrls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrls.push(String(url));
    void init;
    // 真实推理模型会把过低预算全耗在reasoning，HTTP200但content为空。
    const requestBody = init?.body ? JSON.parse(String(init.body)) as { max_tokens?: number } : {};
    const body = String(url).endsWith("/chat/completions") ? { choices: [{ message: { content: (requestBody.max_tokens ?? 0) >= 128 ? "OK" : "" } }] }
      : String(url).endsWith("/embeddings") ? { data: [{ embedding: Array(1024).fill(0.25) }] }
      : { data: [{ id: "mock-model" }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const testOk = await ai.testProvider(admin, p1);
  ok("BOTH测试实际对话与1024维向量，不能用模型列表代替", testOk.ok === true
    && capturedUrls.includes("https://1.1.1.1/v1/chat/completions") && capturedUrls.includes("https://1.1.1.1/v1/embeddings"), JSON.stringify({ testOk, capturedUrls }));
  await ai.updateProvider(admin, p1, { purpose: "EMBEDDING" });
  globalThis.fetch = (async (url) => new Response(JSON.stringify(String(url).endsWith("/models")
    ? { data: [{ id: "mock-model" }] } : { message: "Sorry, your account balance is insufficient sk-secret-key" }), { status: String(url).endsWith("/models") ? 200 : 402 })) as typeof fetch;
  const balance = await ai.testProvider(admin, p1);
  ok("列模型成功但向量402不得误报通过，提示余额不足且不回显密钥", balance.ok === false && /402/.test(balance.error ?? "")
    && /余额/.test(balance.error ?? "") && !JSON.stringify(balance).includes("sk-secret-key"));
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0.2) }] }))) as typeof fetch;
  const wrongDimension = await ai.testProvider(admin, p1);
  ok("非1024维模型测试失败，明确实际维度", wrongDimension.ok === false && /768/.test(wrongDimension.error ?? "") && /1024/.test(wrongDimension.error ?? ""));
  await ai.updateProvider(admin, p1, { purpose: "LLM" });
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [] }))) as typeof fetch;
  const emptyChat = await ai.testProvider(admin, p1);
  ok("对话200但无实际回答不得误报通过", emptyChat.ok === false);
  capturedUrls = [];
  globalThis.fetch = (async (url) => { capturedUrls.push(String(url)); return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })); }) as typeof fetch;
  ok("LLM用途只测试对话，不要求支持向量接口", (await ai.testProvider(admin, p1)).ok === true && capturedUrls.length === 1 && capturedUrls[0]!.endsWith("/chat/completions"));
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  const testFail = await ai.testProvider(admin, p1);
  ok("连接测试失败记录 HTTP 错误", testFail.ok === false && (testFail.error ?? "").includes("HTTP 500"), JSON.stringify(testFail));
  globalThis.fetch = realFetch;
  const [row] = await db.select().from(aiProviderConfig).where(eq(aiProviderConfig.id, p1));
  ok("最近测试状态落库（失败）", row?.lastTestOk === false && !!row?.lastTestError);
  await ai.updateProvider(admin, p1, { purpose: "BOTH" });

  // 删除默认供应商 → 自动回退到另一个启用的供应商；若都停用则关闭 AI
  await fetch(`${BASE}/api/v1/ai/providers/${p2}`, { method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] } });
  const afterDel = await (await fetch(`${BASE}/api/v1/ai/providers`, { headers: { cookie: H.cookie } })).json() as { providers: { id: string; isDefault: boolean }[] };
  ok("删除默认后回退到剩余默认", afterDel.providers.length === 1 && afterDel.providers[0]!.isDefault === true, JSON.stringify(afterDel.providers));
  ids = [p1];
} finally {
  await app.close();
  await db.delete(aiProviderConfig).where(like(aiProviderConfig.baseUrl, "https://1.1.1.1/%"));
  await db.delete(settingTable).where(like(settingTable.key, "ai.%"));
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  void ids;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
