import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 知识索引与检索自检（第十三期）：切片、可重入、无 key 退化（反控）、维度拒绝、可见性 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, page, pageRevision, pagePermission, pageChunk, chunkEmbedding, indexJob, auditEntry, activityEntry, setting, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiki from "../src/server/services/wiki.service.ts";
import * as knowledge from "../src/server/services/knowledge.service.ts";
import * as settingService from "../src/server/services/setting.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, inArray } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w13-admin", INS = "w13-insider";
const KEY = "W13PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, INS]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "知识管理员"), b = await mk(INS, "项目成员");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W13 知识库" });
await db.insert(roleAssignment).values({ memberId: b.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid });
const insider = (await loadActor(b.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3982), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3982";
const clearAi = async () => { await db.delete(setting).where(inArray(setting.key, ["ai.baseUrl", "ai.model", "ai.apiKey", "ai.enabled", "ai.dimensions"])); };

try {
  // ── 切片 ──
  const md = "# 部署指南\n如何自托管部署。\n\n## 反向代理\n需要配置 Nginx。\n\n## 备份\n数据库与密钥缺一不可。";
  const chunks = knowledge.chunkMarkdown(md);
  ok("按标题切片并保留标题路径", chunks.length === 3 && chunks[1]!.headingPath === "部署指南 > 反向代理",
    JSON.stringify(chunks.map((c) => c.headingPath)));
  ok("每块都有内容哈希（判重依据）", chunks.every((c) => c.contentHash.length === 64));
  ok("同内容哈希稳定（可重入的前提）",
    knowledge.chunkMarkdown(md)[0]!.contentHash === chunks[0]!.contentHash);
  ok("只有标题的页面也产出一个块（否则永远搜不到）", knowledge.chunkMarkdown("# 只有标题").length >= 1);

  // ── 无 AI 配置时的检索（**反控**：这是硬约束）──
  await clearAi();
  ok("未配置 AI 时 loadAiConfig 返回 null 而非报错", (await knowledge.loadAiConfig()) === null);
  const emb = await knowledge.embed(["测试"]);
  ok("未配置 AI 时 embed 返回 ok:false 而不抛错", emb.ok === false && /未配置/.test(emb.reason ?? ""), JSON.stringify(emb));

  const pg = await wiki.createPage(admin, pid, { title: "部署指南", content: md });
  const idx1 = await knowledge.reindexPage(admin, pg!.id);
  ok("无 AI 配置也能建索引（切片照建）", idx1.inserted === 3 && idx1.failed === 0, JSON.stringify(idx1));
  ok("索引任务标记 embedReason 为未配置（不假装有向量）", /未配置/.test(idx1.embedReason ?? ""), String(idx1.embedReason));
  const kw = await knowledge.searchKnowledge(admin, pid, "反向代理");
  ok("**无 key 时检索仍可用**（退化为关键词）", kw.mode === "keyword" && kw.hits.length >= 1, JSON.stringify(kw).slice(0, 90));
  ok("检索提示写明退化原因", /未配置 AI/.test(kw.note ?? ""), String(kw.note));

  // ── 可重入 ──
  const idx2 = await knowledge.reindexPage(admin, pg!.id);
  ok("同内容再索引：0 新增、3 复用（可重入）", idx2.inserted === 0 && idx2.reused === 3, JSON.stringify(idx2));
  const idx3 = await knowledge.reindexPage(admin, pg!.id, "FULL");
  ok("FULL 模式强制重建", idx3.inserted === 3, JSON.stringify(idx3));
  const chunkCount = await sql<{ n: number }[]>`select count(*)::int as n from page_chunk where page_id = ${pg!.id}`;
  ok("库内切片数不被 FULL 重复膨胀（每次换代各存一份）", chunkCount[0]!.n >= 3 && chunkCount[0]!.n <= 9, String(chunkCount[0]!.n));

  // ── 生效代：只有成功才切换 ──
  const gen1 = idx3.activeGeneration;
  ok("成功后生效代前移", gen1 > 1, String(gen1));
  const fetchBadDim: typeof fetch = async () => new Response(JSON.stringify({ data: [{ embedding: new Array(768).fill(0.1) }] }), { status: 200, headers: { "content-type": "application/json" } });
  await settingService.putSettings({ "ai.baseUrl": "https://1.1.1.1/v1", "ai.model": "test-768" });
  const bad = await knowledge.embed(["x"], { fetchImpl: fetchBadDim });
  ok("维度不是 1024 → 明确拒绝且说明差异", bad.ok === false && /768 维/.test(bad.reason ?? ""), String(bad.reason));
  // 维度配置非法时在配置阶段就拒（不等写库）
  await settingService.putSettings({ "ai.dimensions": 768 });
  let dimRejected = false, dimMsg = "";
  try { await knowledge.loadAiConfig(); } catch (e) { dimRejected = (e as { code?: string }).code === "VALIDATION"; dimMsg = (e as Error).message; }
  ok("配置阶段拒绝非 1024 维（规范硬要求）", dimRejected && /1024/.test(dimMsg), dimMsg.slice(0, 60));
  await settingService.putSettings({ "ai.dimensions": 1024 });
  const fetchOk: typeof fetch = async () => new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }], usage: { total_tokens: 12 } }), { status: 200, headers: { "content-type": "application/json" } });
  const good = await knowledge.embed(["x"], { fetchImpl: fetchOk });
  ok("1024 维返回被接受并带用量", good.ok === true && good.vectors![0]!.length === 1024 && good.tokens === 12);
  await clearAi();

  // ── 可见性：受限页不得从知识检索泄露 ──
  const secret = await wiki.createPage(admin, pid, { title: "机密部署", content: "# 机密\n内部反向代理口令", visibility: "RESTRICTED" });
  const secretIndex = await knowledge.reindexPage(admin, secret!.id);
  const adminHit = await knowledge.searchKnowledge(admin, pid, "反向代理");
  ok("创建者能搜到自己的受限页", adminHit.hits.some((h) => h.pageId === secret!.id), JSON.stringify(adminHit.hits.map((h) => h.title)));
  const insiderHit = await knowledge.searchKnowledge(insider, pid, "反向代理");
  ok("**受限页不从未授权者的知识检索泄露**", !insiderHit.hits.some((h) => h.pageId === secret!.id),
    JSON.stringify(insiderHit.hits.map((h) => h.title)));

  // ── 页面任务/切片预览沿用 Wiki 项目范围与 ACL ──
  const loginInsider = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: INS, password: "w13-password-1234" }),
  });
  const insiderCookie = loginInsider.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const hiddenJobs = await fetch(`${BASE}/api/v1/pages/${secret!.id}/index-jobs`, { headers: { cookie: insiderCookie } });
  const hiddenChunks = await fetch(`${BASE}/api/v1/pages/${secret!.id}/chunks`, { headers: { cookie: insiderCookie } });
  ok("未获页面 ACL 的项目成员无法读取受限页索引任务", hiddenJobs.status === 403, String(hiddenJobs.status));
  ok("未获页面 ACL 的项目成员无法读取受限页切片", hiddenChunks.status === 403, String(hiddenChunks.status));

  // 管理员 HTTP 会话（原脚本在下方才登录，但这里就要用 cookie —— 属真实 TDZ 缺陷，本轮修掉）
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: "w13-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const adminJobs = await fetch(`${BASE}/api/v1/pages/${secret!.id}/index-jobs`, { headers: { cookie } });
  const adminChunks = await fetch(`${BASE}/api/v1/pages/${secret!.id}/chunks`, { headers: { cookie } });
  const jobsBody = (await adminJobs.json()) as { jobs: { status: string }[] };
  const chunksBody = (await adminChunks.json()) as { generation: number; revisionId: string; chunks: Record<string, unknown>[] };
  ok("管理员可以读取受限页任务状态", adminJobs.status === 200 && jobsBody.jobs[0]?.status === "SUCCEEDED");
  ok("管理员可预览当前版本与有效代切片", adminChunks.status === 200 && chunksBody.generation === secretIndex.generation
    && chunksBody.revisionId === (await wiki.getPage(admin, secret!.id))?.currentRevisionId && chunksBody.chunks.length === 1);
  ok("切片预览只返回实际向量存在状态，不泄露哈希或向量", chunksBody.chunks[0]?.hasVector === false
    && !("contentHash" in (chunksBody.chunks[0] ?? {})) && !("vector" in (chunksBody.chunks[0] ?? {})));

  // 即使残留旧 revision 或旧 generation 的切片，也不可出现在当前预览。
  const staleRevision = (await db.insert(pageRevision).values({
    pageId: secret!.id, revisionNo: 99, content: "旧版本内容", changeSummary: "测试旧版本", authorId: a.id,
  }).returning({ id: pageRevision.id }))[0]!;
  await db.insert(pageChunk).values([
    { pageId: secret!.id, revisionId: secretIndex.jobId ? (await wiki.getPage(admin, secret!.id))!.currentRevisionId! : "", headingPath: null, content: "旧代内容", tokenCount: 3, contentHash: "old-generation-test", generation: secretIndex.generation - 1 },
    { pageId: secret!.id, revisionId: staleRevision.id, headingPath: null, content: "旧版本内容", tokenCount: 3, contentHash: "old-revision-test", generation: secretIndex.generation },
  ]);
  const filteredChunks = await fetch(`${BASE}/api/v1/pages/${secret!.id}/chunks`, { headers: { cookie } });
  const filteredBody = (await filteredChunks.json()) as { chunks: { content: string }[] };
  ok("切片预览排除非当前版本与非当前生效代", filteredBody.chunks.length === 1 && filteredBody.chunks[0]!.content.includes("内部反向代理口令"));

  await db.insert(pagePermission).values({ pageId: secret!.id, principalType: "MEMBER", principalId: b.id, canRead: true, canWrite: false });
  const grantedChunks = await fetch(`${BASE}/api/v1/pages/${secret!.id}/chunks`, { headers: { cookie: insiderCookie } });
  const grantedJobs = await fetch(`${BASE}/api/v1/pages/${secret!.id}/index-jobs`, { headers: { cookie: insiderCookie } });
  ok("获得页面只读 ACL 后，项目成员可读任务和切片", grantedChunks.status === 200 && grantedJobs.status === 200);

  // ── HTTP（管理员会话在上面已建立）──
  const httpSearch = await fetch(`${BASE}/api/v1/projects/${pid}/knowledge/search?q=${encodeURIComponent("反向代理")}`, { headers: { cookie } });
  const body = (await httpSearch.json()) as { mode: string; hits: unknown[] };
  ok("HTTP 检索 200 且无 key 时仍返回结果", httpSearch.status === 200 && body.hits.length >= 1, `${httpSearch.status} ${JSON.stringify(body).slice(0, 70)}`);
  const httpStatus = await fetch(`${BASE}/api/v1/knowledge/ai-status`, { headers: { cookie } });
  const st = (await httpStatus.json()) as { configured: boolean; message?: string };
  ok("AI 状态端点如实报告未配置", st.configured === false && /未配置/.test(st.message ?? ""), JSON.stringify(st));
  const emptyQ = await fetch(`${BASE}/api/v1/projects/${pid}/knowledge/search?q=`, { headers: { cookie } });
  ok("空查询词 → 400", emptyQ.status === 400, String(emptyQ.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await clearAi();
  await db.delete(chunkEmbedding);
  await db.delete(pageChunk);
  await db.delete(indexJob);
  await db.delete(pagePermission);
  await db.delete(pageRevision);
  await db.delete(page);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, INS]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
