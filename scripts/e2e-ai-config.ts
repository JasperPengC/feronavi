import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** AI 供应商与用量自检（第十三期）：SSRF、密钥加密、原子计数、超限只停索引不停检索 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, page, pageRevision, pageChunk, chunkEmbedding, indexJob, aiProviderConfig, aiUsageCounter, setting, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import * as knowledge from "../src/server/services/knowledge.service.ts";
import * as ai from "../src/server/services/ai-config.service.ts";
import * as settingService from "../src/server/services/setting.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, inArray } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w13b-admin", LOW = "w13b-low";
const KEY = "W13BPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, LOW]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [guestRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13b-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "AI 管理员"), low = await mk(LOW, "受限账号");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
await db.insert(roleAssignment).values({ memberId: low.id, roleId: guestRole!.id, scopeType: "ORG", scopeId: null });
const lowActor = (await loadActor(low.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W13B AI" });
const clearAi = async () => { await db.delete(setting).where(inArray(setting.key, ["ai.enabled", "ai.baseUrl", "ai.model", "ai.apiKey", "ai.dimensions", "ai.limitTokensPerMonth"])); };

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3981), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3981";

try {
  await clearAi();
  await db.delete(aiProviderConfig);

  // ── 供应商配置：SSRF + 密钥加密 ──
  let ssrf = false;
  try { await ai.createProvider(admin, { provider: "OPENAI_COMPAT", baseUrl: "https://169.254.169.254/v1", model: "m", embeddingModel: "e", apiKey: "k" }); }
  catch (e) { ssrf = (e as { code?: string }).code === "VALIDATION"; }
  ok("base_url 过统一 SSRF 校验（云元数据地址被拒）", ssrf);
  let noKey = false;
  try { await ai.createProvider(admin, { provider: "OPENAI_COMPAT", baseUrl: "https://1.1.1.1/v1", model: "m", embeddingModel: "bge-m3-1024" }); }
  catch (e) { noKey = (e as { code?: string }).code === "VALIDATION"; }
  ok("OPENAI_COMPAT 缺 Key → VALIDATION", noKey);
  const ollama = await ai.createProvider(admin, { provider: "OLLAMA", baseUrl: "https://1.1.1.1", model: "llama3", embeddingModel: "bge-m3-1024" });
  ok("OLLAMA 允许无 Key（本地部署）", !!ollama!.id);
  const prov = await ai.createProvider(admin, { provider: "OPENAI_COMPAT", baseUrl: "https://1.1.1.1/v1", model: "gpt", embeddingModel: "bge-m3-1024", apiKey: "sk-secret-123" });
  const row = (await db.select().from(aiProviderConfig).where(eq(aiProviderConfig.id, prov!.id)).limit(1))[0]!;
  ok("密钥信封加密入库（enc:v1:）且查不到明文", row.apiKeyEncrypted!.startsWith("enc:v1:") && !row.apiKeyEncrypted!.includes("sk-secret-123"));
  ok("列表不回显密钥、只报 hasApiKey", (await ai.listProviders(admin)).find((x) => x.id === prov!.id)!.hasApiKey === true);
  ok("可取回明文供调用（仅内部路径）", (await ai.getProviderKey(prov!.id)) === "sk-secret-123");
  let denied = false;
  try { await ai.listProviders(lowActor); } catch { denied = true; }
  ok("无 ai:configure 者看不到供应商配置", denied);

  // ── 用量：原子累加 ──
  await db.delete(aiUsageCounter);
  await Promise.all(Array.from({ length: 10 }, () => ai.addUsage(a.id, { tokens: 5, calls: 1 })));
  const usage = await ai.usageOf(a.id);
  const day = usage.find((u) => u.period === "DAY")!;
  const month = usage.find((u) => u.period === "MONTH")!;
  ok("并发 10 次累加不丢计数（DAY 与 MONTH 各 50）", day.embeddingTokens === 50 && month.embeddingTokens === 50,
    `${day.embeddingTokens}/${month.embeddingTokens}`);
  ok("调用次数与 token 分别计数", day.embeddingCalls === 10 && day.embeddingTokens === 50, JSON.stringify(day));

  // ── 超限：只停新索引，不停检索（**反控**）──
  const pg = await wiki.createPage(admin, pid, { title: "知识页", content: "# 主题\n这是一个可检索的知识条目，关键词：配额熔断。" });
  await knowledge.reindexPage(admin, pg!.id);
  const beforeSearch = await knowledge.searchKnowledge(admin, pid, "配额熔断");
  ok("未超限时检索正常", beforeSearch.hits.length >= 1, JSON.stringify(beforeSearch).slice(0, 70));
  await settingService.putSettings({ "ai.limitTokensPerMonth": 10 });   // 已用 50 > 10
  const gate = await ai.canStartIndexing(a.id);
  ok("超限时索引闸门关闭并说明原因", gate.ok === false && /暂停新建索引/.test(gate.reason ?? ""), String(gate.reason));
  let blocked = false, msg = "";
  try { await knowledge.reindexPage(admin, pg!.id); } catch (e) { blocked = (e as { code?: string }).code === "CONFLICT"; msg = (e as Error).message; }
  ok("超限时**新建索引被拒**（CONFLICT）", blocked && /检索不受影响/.test(msg), msg.slice(0, 60));
  const afterSearch = await knowledge.searchKnowledge(admin, pid, "配额熔断");
  ok("**超限不阻断检索**（规范明示，反控）", afterSearch.hits.length >= 1, JSON.stringify(afterSearch).slice(0, 70));
  const usageAfter = (await ai.usageOf(a.id)).find((u) => u.period === "DAY")!;
  ok("检索计入 query_count", usageAfter.queryCount >= 2, String(usageAfter.queryCount));
  ok("用量快照带 exceeded 标记", usageAfter.exceeded === false && (await ai.usageOf(a.id)).find((u) => u.period === "MONTH")!.exceeded === true);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: "w13b-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  // CSRF 与会话绑定：必须用**同一次登录**的 token（先前用第二次登录的 token 配第一次的 cookie → 403，是测试写错）
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const httpProviders = await fetch(`${BASE}/api/v1/ai/providers`, { headers: { cookie } });
  const pbody = (await httpProviders.json()) as { providers: { hasApiKey: boolean }[] };
  ok("HTTP 供应商列表 200 且不含密钥明文", httpProviders.status === 200 && !JSON.stringify(pbody).includes("sk-secret"),
    JSON.stringify(pbody).slice(0, 80));
  const httpUsage = await fetch(`${BASE}/api/v1/ai/usage`, { headers: { cookie } });
  ok("HTTP 用量 200 且含 exceeded", httpUsage.status === 200 && JSON.stringify(await httpUsage.json()).includes("exceeded"));
  const httpCreate = await fetch(`${BASE}/api/v1/ai/providers`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ provider: "OPENAI_COMPAT", baseUrl: "https://10.0.0.1/v1", model: "m", embeddingModel: "e", apiKey: "k" }),
  });
  ok("HTTP 建供应商时 SSRF 拦截 → 400", httpCreate.status === 400, String(httpCreate.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await clearAi();
  await db.delete(aiUsageCounter);
  await db.delete(aiProviderConfig);
  await db.delete(chunkEmbedding); await db.delete(pageChunk); await db.delete(indexJob);
  await db.delete(pageRevision); await db.delete(page);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, LOW]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
