/** 随机隔离库内真实HTTP/session/CSRF/Bearer/MCP/个人导出；模型传输为合成响应。 */
import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, page, setting } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { createSession } from "../src/server/auth/session.ts";
import { createProject } from "../src/server/services/project.service.ts";
import { createPage, setPermissions } from "../src/server/services/wiki.service.ts";
import { reindexPage } from "../src/server/services/knowledge.service.ts";
import { createToken } from "../src/server/services/token.service.ts";
import { putSettings } from "../src/server/services/setting.service.ts";
import { buildApp } from "../src/server/app.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import type { RagConversation, RagConversationDetail, RagConversationList, RagMessage, RagMessageResult } from "../src/shared/rag-conversations.ts";

type Headers = Record<string, string>;
interface McpResponse { result: { tools?: { name: string; outputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }[]; isError?: boolean; content?: { text: string }[] } }
interface PersonalExport { subject: { memberId: string }; sections: { ragConversations: RagConversation[]; ragMessages: RagMessage[] }; counts: { ragConversations: number; ragMessages: number } }
assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
let app: Awaited<ReturnType<typeof buildApp>> | undefined, passed = 0, modelCalls = 0, seq = 0;
let releaseModel: (() => void) | undefined, modelStarted: (() => void) | undefined, modelHold: Promise<void> | undefined;
const realFetch = globalThis.fetch;
const check = (name: string, condition: unknown) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
const request = (question = "银桥月结完成时间") => ({ requestId: randomUUID(), question });
const base = "/api/v1/rag/conversations";
const details = (id: string) => `${base}/${id}`;
const messages = (id: string) => `${details(id)}/messages`;
const cancel = (id: string, requestId: string) => `${details(id)}/requests/${requestId}/cancel`;
const sessionHeaders = async (memberId: string): Promise<Headers> => {
  const session = await createSession({ memberId, remember: false, userAgent: "RAG protocol synthetic test", ip: "127.0.0.1" });
  const cookie = `feronavi_session=${session.token}`;
  const csrf = await app!.inject({ url: "/api/v1/auth/csrf", headers: { cookie } }); assert.equal(csrf.statusCode, 200);
  return { cookie: `${cookie}; ${csrf.cookies.map(c => `${c.name}=${c.value}`).join("; ")}`, "x-csrf-token": csrf.json<{ csrfToken: string }>().csrfToken };
};
const mcp = async (headers: Headers, method: string, params: unknown): Promise<McpResponse> => {
  const response = await app!.inject({ method: "POST", url: "/api/v1/mcp", headers: { ...headers, accept: "application/json, text/event-stream" }, payload: { jsonrpc: "2.0", id: ++seq, method, params } });
  assert.equal(response.statusCode, 200); return response.json<McpResponse>();
};
const tool = async <T>(headers: Headers, name: string, args: unknown): Promise<T> => {
  const called = await mcp(headers, "tools/call", { name, arguments: args }); assert.ok(!called.result.isError, `${name}: ${called.result.content?.[0]?.text ?? "无错误详情"}`);
  return JSON.parse(called.result.content![0]!.text) as T;
};
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const makeMember = async (name: string) => (await db.insert(member).values({ username: `rag-http-${name}-${randomUUID().slice(0, 8)}`, name, passwordHash: "no-login", status: "ACTIVE" }).returning())[0]!;
  const owner = await makeMember("owner"), otherMember = await makeMember("other");
  await db.insert(roleAssignment).values([owner, otherMember].map(m => ({ memberId: m.id, roleId: adminRole!.id, scopeType: "ORG" })));
  const actor = (await loadActor(owner.id))!;
  const a = await createProject(actor, { key: "RAGCONVHTTPA", name: "协议会话甲" }), b = await createProject(actor, { key: "RAGCONVHTTPB", name: "协议会话乙" });
  await db.delete(setting).where(inArray(setting.key, ["ai.enabled", "ai.baseUrl", "ai.model", "ai.apiKey", "ai.chatModel", "ai.chatBaseUrl", "ai.chatApiKey"]));
  const pageA = (await createPage(actor, a.id, { title: "银桥月结甲", content: "# 银桥月结\n银桥月结账单每月第三个工作日完成。甲方独立数据。" }))!;
  const pageB = (await createPage(actor, b.id, { title: "银桥月结乙", content: "# 银桥月结\n银桥月结乙项目于每月第七个工作日完成。乙方独立数据。" }))!;
  for (const p of [pageA, pageB]) await reindexPage(actor, p.id, "FULL", { skipEmbedding: true });
  await putSettings({ "ai.chatBaseUrl": "https://1.1.1.1/v1", "ai.chatModel": "synthetic-http-rag" });
  globalThis.fetch = (async (_url,init) => {
    const body=JSON.parse(String(init?.body??'{}')) as {stream:boolean;tools?:unknown[];messages:{role:string;content:string}[]};assert.equal(body.stream,true);
    const firstTurn=!!body.tools?.length&&!body.messages.some(m=>m.role==='tool');
    const projectId=/"id":"([^"]+)"/u.exec(body.messages[0]!.content)?.[1];
    const question=body.messages.filter(m=>m.role==='user').at(-1)?.content??'银桥月结';
if(firstTurn){modelCalls++;modelStarted?.();modelStarted=undefined;const hold=modelHold;modelHold=undefined;await hold;}
    const delta=firstTurn?{tool_calls:[{index:0,id:'knowledge-read',type:'function',function:{name:'knowledge_search',arguments:JSON.stringify({projectId,q:question,limit:5})}}]}:body.tools?.length?{content:'规划，不输出'}:{content:'银桥月结按照本项目规则完成 [1]。'};
    return new Response(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }) as typeof fetch;
  app = await buildApp({ logger: false }); await app.ready();
  const ownerSession = await sessionHeaders(owner.id), otherSession = await sessionHeaders(otherMember.id);
  const writeToken = await createToken(actor, { name: "临时会话写令牌", tier: "READ_WRITE", projectWhitelist: [a.id], allowedIpCidrs: ["127.0.0.1/32"] });
  const readToken = await createToken(actor, { name: "临时会话只读令牌", tier: "READ_ONLY", projectWhitelist: [a.id], allowedIpCidrs: ["127.0.0.1/32"] });
  const writeHeaders = { authorization: `Bearer ${writeToken.token}` }, readHeaders = { authorization: `Bearer ${readToken.token}` };
  check("匿名和无CSRF会话写入拒绝", (await app.inject(base)).statusCode === 401 && (await app.inject({ method: "POST", url: base, headers: { cookie: ownerSession.cookie! }, payload: {} })).statusCode === 403);
  check("无效Bearer不能回退合法session", (await app.inject({ url: base, headers: { ...ownerSession, authorization: "Bearer invalid" } })).statusCode === 401);
  const createA = await app.inject({ method: "POST", url: base, headers: ownerSession, payload: { projectId: a.id } }); assert.equal(createA.statusCode, 200); const ca = createA.json<RagConversation>();
  const cb = (await app.inject({ method: "POST", url: base, headers: ownerSession, payload: { projectId: b.id } })).json<RagConversation>();
  const all = (await app.inject({ method: "POST", url: base, headers: ownerSession, payload: {} })).json<RagConversation>();
  const otherConversation = (await app.inject({ method: "POST", url: base, headers: otherSession, payload: { projectId: b.id, title: "其他账号私有" } })).json<RagConversation>();
  const ownerQuestion = request("银桥月结本人第一问");
  const sent = await app.inject({ method: "POST", url: messages(ca.id), headers: ownerSession, payload: ownerQuestion }); assert.equal(sent.statusCode, 200); const first = sent.json<RagMessageResult>();
  check("session+CSRF保存真实服务回答与固定范围", first.message.status === "completed" && !!first.message.reply?.answer && first.message.reply.citations.length > 0 && first.message.reply.citations.every(c => c.projectId === a.id));
  const replay = (await app.inject({ method: "POST", url: messages(ca.id), headers: ownerSession, payload: ownerQuestion })).json<RagMessageResult>();
  check("HTTP请求ID幂等且异问题冲突", replay.message.id === first.message.id && modelCalls === 1 && (await app.inject({ method: "POST", url: messages(ca.id), headers: ownerSession, payload: { ...ownerQuestion, question: "不同问题" } })).statusCode === 409);
  const refreshed = await sessionHeaders(owner.id);
  const restored = (await app.inject({ url: details(ca.id), headers: refreshed })).json<RagConversationDetail>();
  check("新session与刷新查询恢复持久会话和回答", restored.messages[0]?.id === first.message.id && restored.messages[0]?.reply?.answer === first.message.reply?.answer && restored.conversation.projectId === a.id);
  const ownList = (await app.inject({ url: base, headers: ownerSession })).json<RagConversationList>();
  const otherList = (await app.inject({ url: base, headers: otherSession })).json<RagConversationList>();
  check("双账号列表只包含本人会话", ownList.items.some(c => c.id === ca.id) && !ownList.items.some(c => c.id === otherConversation.id) && otherList.items.length === 1 && otherList.items[0]?.id === otherConversation.id);
  const hidden = await app.inject({ url: details(ca.id), headers: otherSession }), unknown = await app.inject({ url: details(randomUUID()), headers: otherSession });
  check("外人和未知ID的HTTP状态及错误体完全相同", hidden.statusCode === 403 && hidden.body === unknown.body);
  for (const mutation of [
    { method: "PATCH" as const, url: details(ca.id), payload: { title: "他人重命名" } },
    { method: "POST" as const, url: messages(ca.id), payload: request() },
    { method: "POST" as const, url: cancel(ca.id, randomUUID()), payload: {} },
  ]) assert.equal((await app.inject({ ...mutation, headers: otherSession })).statusCode, 403);
  check("他人会话重命名发送取消均拒绝", true);
  check("固定scope不能通过PATCH变更或发送伪造历史", (await app.inject({ method: "PATCH", url: details(ca.id), headers: ownerSession, payload: { projectId: b.id } })).statusCode === 400 && (await app.inject({ method: "POST", url: messages(ca.id), headers: ownerSession, payload: { ...request(), history: [] } })).statusCode === 400);
  const limited = (await app.inject({ url: base, headers: readHeaders })).json<RagConversationList>();
  check("受限Bearer列表隐藏全部项目和范围外会话", limited.total === 1 && limited.items[0]?.id === ca.id && (await app.inject({ url: details(all.id), headers: readHeaders })).statusCode === 403 && (await app.inject({ url: details(cb.id), headers: readHeaders })).statusCode === 403);
  check("受限写令牌不允许创建全部项目会话", (await app.inject({ method: "POST", url: base, headers: writeHeaders, payload: {} })).statusCode === 403);
  for (const mutation of [
    { method: "POST" as const, url: base, payload: { projectId: a.id } },
    { method: "PATCH" as const, url: details(ca.id), payload: { title: "禁止" } },
    { method: "POST" as const, url: messages(ca.id), payload: request() },
    { method: "POST" as const, url: cancel(ca.id, randomUUID()), payload: {} },
  ]) assert.equal((await app.inject({ ...mutation, headers: readHeaders })).statusCode, 403);
  check("只读Bearer对所有会话写操作拒绝但可读取", (await app.inject({ url: details(ca.id), headers: readHeaders })).statusCode === 200);
  modelHold = new Promise<void>(resolve => { releaseModel = resolve; }); const started = new Promise<void>(resolve => { modelStarted = resolve; });
  const waitingQuestion = request(), waiting = app.inject({ method: "POST", url: messages(ca.id), headers: ownerSession, payload: waitingQuestion });
  // inject是惰性thenable，显式then启动请求以便可控等待供应商。
  const waitingResult = Promise.resolve(waiting); await started;
  const pending = (await app.inject({ url: details(ca.id), headers: refreshed })).json<RagConversationDetail>();
  check("刷新查询能看到pending且另一请求冲突", pending.messages.some(m => m.requestId === waitingQuestion.requestId && m.status === "pending") && (await app.inject({ method: "POST", url: messages(ca.id), headers: ownerSession, payload: request() })).statusCode === 409);
  const cancelled = (await app.inject({ method: "POST", url: cancel(ca.id, waitingQuestion.requestId), headers: ownerSession, payload: {} })).json<RagMessageResult>(); releaseModel!();
  check("HTTP取消幂等且迟到结果不能覆盖", cancelled.message.status === "cancelled" && (await waitingResult).json<RagMessageResult>().message.status === "cancelled" && (await app.inject({ method: "POST", url: cancel(ca.id, waitingQuestion.requestId), headers: ownerSession, payload: {} })).json<RagMessageResult>().message.status === "cancelled");
  await app.inject({ method: "PATCH", url: details(ca.id), headers: ownerSession, payload: { title: "保存后的名称", deleted: true } });
  const deleted = (await app.inject({ url: `${base}?deleted=true`, headers: refreshed })).json<RagConversationList>();
  check("软删除列表保留本人会话且可恢复", deleted.items.some(c => c.id === ca.id) && (await app.inject({ method: "PATCH", url: details(ca.id), headers: ownerSession, payload: { deleted: false } })).json<RagConversation>().title === "保存后的名称");
  const discovered = (await mcp(writeHeaders, "tools/list", {})).result.tools!;
  const names = ["list", "get", "create", "update", "send", "cancel"].map(name => `rag.conversation.${name}`);
  check("真实MCP发现六个会话工具和具体输出契约", names.every(name => discovered.some(t => t.name === name && t.outputSchema)) && discovered.find(t => t.name === "rag.conversation.get")?.annotations?.readOnlyHint === true && discovered.find(t => t.name === "rag.conversation.send")?.annotations?.readOnlyHint === false);
  const mcpCreated = await tool<RagConversation>(writeHeaders, "rag.conversation.create", { projectId: a.id, title: "MCP持久会话" });
  const mcpSent = await tool<RagMessageResult>(writeHeaders, "rag.conversation.send", { conversationId: mcpCreated.id, ...request() });
  const mcpRead = await tool<RagConversationDetail>(readHeaders, "rag.conversation.get", { conversationId: mcpCreated.id });
  const mcpListed = await tool<RagConversationList>(readHeaders, "rag.conversation.list", {});
  check("MCP写后REST和只读MCP均能恢复同一记录", mcpSent.message.status === "completed" && mcpRead.messages[0]?.id === mcpSent.message.id && mcpListed.items.some(c => c.id === mcpCreated.id) && (await app.inject({ url: details(mcpCreated.id), headers: refreshed })).json<RagConversationDetail>().messages[0]?.id === mcpSent.message.id);
  const deniedMcp = await mcp(readHeaders, "tools/call", { name: "rag.conversation.create", arguments: { projectId: a.id } });
  check("只读MCP写工具由真实档位守卫拒绝", deniedMcp.result.isError && JSON.parse(deniedMcp.result.content![0]!.text).code === "FORBIDDEN");
  const doc = (await app.inject("/api/v1/openapi.json")).json<{ openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } }>();
  const resolveRefs = (node: unknown): void => { if (!node || typeof node !== "object") return; for (const [key, value] of Object.entries(node)) { if (key === "$ref") { assert.equal(typeof value, "string"); assert.ok(String(value).startsWith("#/components/schemas/")); assert.ok(Object.hasOwn(doc.components.schemas, String(value).split("/").at(-1)!)); } else resolveRefs(value); } }; resolveRefs(doc);
  check("OpenAPI3.1保留原路径及四条会话路径并可解析所有引用", doc.openapi === "3.1.0" && [base, `${base}/{conversationId}`, `${base}/{conversationId}/messages`, `${base}/{conversationId}/requests/{requestId}/cancel`, "/api/v1/rag/projects", "/api/v1/rag/search", "/api/v1/rag/chat"].every(path => Object.hasOwn(doc.paths, path)));
  await app.inject({ method: "POST", url: messages(otherConversation.id), headers: otherSession, payload: request("银桥月结其他账号私有问题") });
  await app.inject({ method: "PATCH", url: details(mcpCreated.id), headers: ownerSession, payload: { deleted: true } });
  await db.update(page).set({ visibility: "RESTRICTED" }).where(eq(page.id, pageA.id));
  await setPermissions(actor, pageA.id, [{ principalType: "MEMBER", principalId: otherMember.id, canRead: true, canWrite: true }]);
  const projected = (await app.inject({ url: details(ca.id), headers: refreshed })).json<RagConversationDetail>();
  check("恢复历史执行当前Wiki读权且不暴露答案或摘录", projected.messages.find(m => m.id === first.message.id)?.status === "unavailable" && projected.messages.find(m => m.id === first.message.id)?.reply === null && !JSON.stringify(projected).includes("甲方独立数据"));
  const exportedResponse = await app.inject({ url: `/api/v1/me/data-export?memberId=${otherMember.id}`, headers: refreshed }); assert.equal(exportedResponse.statusCode, 200); const exported = exportedResponse.json<PersonalExport>();
  check("真实个人导出忽略伪造memberId且只包含本人正常和软删会话", exported.subject.memberId === owner.id && exported.sections.ragConversations.some(c => c.id === ca.id) && exported.sections.ragConversations.some(c => c.id === mcpCreated.id && c.deletedAt) && exported.sections.ragConversations.every(c => c.id !== otherConversation.id) && exported.sections.ragMessages.every(m => m.conversationId !== otherConversation.id));
  check("个人导出权限投影清除失权答案和引用并保持计数一致", exported.sections.ragMessages.find(m => m.id === first.message.id)?.status === "unavailable" && exported.sections.ragMessages.find(m => m.id === first.message.id)?.reply === null && exported.counts.ragConversations === exported.sections.ragConversations.length && exported.counts.ragMessages === exported.sections.ragMessages.length && !exportedResponse.body.includes("甲方独立数据"));
  const otherExport = (await app.inject({ url: "/api/v1/me/data-export", headers: otherSession })).json<PersonalExport>();
  check("另一账号个人导出也不含本人会话", otherExport.subject.memberId === otherMember.id && otherExport.sections.ragConversations.length === 1 && otherExport.sections.ragConversations[0]?.id === otherConversation.id);
  console.log(`RAG会话HTTP/MCP隔离验收：${passed}项通过（真实鉴权/权限/数据库，合成模型传输）`);
} finally {
  releaseModel?.(); globalThis.fetch = realFetch; await app?.close(); await closeCache(); await sql.end();
}
