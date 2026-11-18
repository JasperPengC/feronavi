import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 知识问答（带引用）自检（第十三期补：ask.knowledge） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, page, pageRevision, pageChunk, indexJob, chunkEmbedding, setting, auditEntry, activityEntry, workItem, aiProviderConfig } from "../src/db/schema.ts";
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

const U = "w13f-admin";
const KEY = "W13FPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w13f@x.test", name: "问答管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13f-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W13F 问答" });
const clearAi = async () => { await db.delete(setting).where(inArray(setting.key, ["ai.enabled", "ai.baseUrl", "ai.model", "ai.apiKey", "ai.dimensions", "ai.chatModel"])); };

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3974), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3974";

try {
  await clearAi();
  const pg = await wiki.createPage(admin, pid, {
    title: "部署指南", content: "# 反向代理\n自托管需要在前面放一个 Nginx，并开启 proxy_buffering off。\n\n# 备份\n数据库与密钥缺一不可。",
  });
  await knowledge.reindexPage(admin, pg!.id);

  // ── 未配置模型：降级为"给证据"而不是报错（与检索同一硬约束）──
  const noKey = await knowledge.askKnowledge(admin, pid, "反向代理");
  ok("**未配置 AI 时不是错误**：返回相关片段而不是抛异常", noKey.ok === false && noKey.citations.length > 0, JSON.stringify(noKey).slice(0, 90));
  ok("降级说明写明原因（未配置）+ 提示已给片段", /未配置/.test(noKey.note ?? "") && /片段/.test(noKey.note ?? ""), String(noKey.note));
  ok("引用含页面 ID 与标题（可回溯到原文）", !!noKey.citations[0]!.pageId && noKey.citations[0]!.title === "部署指南");
  const none = await knowledge.askKnowledge(admin, pid, "完全不相干的词xyzzy");
  ok("无相关内容时明确说明、不编造答案", none.citations.length === 0 && /没有找到/.test(none.note ?? ""), String(none.note));

  // ── 配了对话模型：走模型并带引用（用注入的假 fetch，不真调外部服务）──
  await settingService.putSettings({ "ai.baseUrl": "https://example.com/v1", "ai.model": "bge-m3-1024", "ai.chatModel": "gpt-test" });
  const realFetch = globalThis.fetch;
  let sawPrompt = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/chat/completions")) {
      sawPrompt = String(init?.body ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "按 [1]，需要在前面放 Nginx。" } }], usage: { total_tokens: 42 } }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input as never, init as never);
  }) as typeof fetch;
  const asked = await knowledge.askKnowledge(admin, pid, "反向代理要配什么");
  globalThis.fetch = realFetch;
  ok("配置对话模型后返回答案（带 [1] 引用标记）", asked.ok === true && /\[1\]/.test(asked.answer ?? ""), JSON.stringify(asked).slice(0, 90));
  ok("**引用由服务端派生**（不让模型自由生成引用）", asked.citations.length > 0 && asked.citations[0]!.title === "部署指南");
  ok("提示词要求「只依据资料、不足就说不确定」（抑制编造）", /只依据给定资料|不要编造|不知道/.test(sawPrompt), sawPrompt.slice(0, 60));
  ok("答案附带检索模式（vector/keyword），便于排障", asked.mode === "vector" || asked.mode === "keyword", asked.mode);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w13f-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const httpAsk = await fetch(`${BASE}/api/v1/knowledge/ask`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ projectId: pid, question: "反向代理要配什么" }),
  });
  const body = (await httpAsk.json()) as { citations: unknown[] };
  ok("HTTP 问答 200 且带引用", httpAsk.status === 200 && body.citations.length > 0, String(httpAsk.status));
  const bad = await fetch(`${BASE}/api/v1/knowledge/ask`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ projectId: pid, question: "" }),
  });
  ok("空问题 → 400", bad.status === 400, String(bad.status));
  const anon = await fetch(`${BASE}/api/v1/knowledge/ask`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: pid, question: "x" }),
  });
  ok("匿名访问被拒", anon.status === 403, String(anon.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await clearAi();
  await db.delete(chunkEmbedding); await db.delete(pageChunk); await db.delete(indexJob);
  await db.delete(pageRevision); await db.delete(page);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(aiProviderConfig);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
