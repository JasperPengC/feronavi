// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), send: vi.fn(), cancel: vi.fn(), decision:vi.fn() }));
vi.mock("../src/server/services/token.service.ts", () => ({ authenticateToken: mocks.auth, tierAllows: (ctx: { tier: string }, kind: string) => kind === "read" || ["READ_WRITE", "ADMIN"].includes(ctx.tier), projectAllowed: (ctx: { projectWhitelist: string[] }, id: string) => !ctx.projectWhitelist.length || ctx.projectWhitelist.includes(id) }));
vi.mock("../src/server/services/rag-conversation.service.ts", () => ({ listConversations: mocks.list, createConversation: mocks.create, getConversation: mocks.get, updateConversation: mocks.update, sendMessage: mocks.send, cancelMessage: mocks.cancel, decideAction:mocks.decision }));
vi.mock("../src/server/services/rag.service.ts", () => ({ listRagProjects: vi.fn(), searchRag: vi.fn(), chatRag: vi.fn() }));
vi.mock("../src/server/services/mcp-resource.service.ts", () => ({ projectForMcpResource: vi.fn() }));
import { registerRagRoutes } from "../src/server/routes/rag.ts";
import { RAG_TOOLS } from "../src/server/mcp/rag-tools.ts";
import { guardTools } from "../src/server/mcp/guard.ts";
const actor = { memberId: "owner", username: "owner" } as never;
const id = "11111111-1111-4111-8111-111111111111", project = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
let app: ReturnType<typeof Fastify> | undefined;
async function setup() {
  const a = Fastify(); await a.register(cookie); await a.register(csrf);
  a.addHook("preHandler", async req => { if (req.headers["x-session"] === "yes") req.actor = actor; });
  a.setErrorHandler((err, _req, reply) => { const e = err as { httpStatus?: number; statusCode?: number; code?: string; message: string }; reply.status(e.httpStatus ?? e.statusCode ?? 500).send({ code: e.code, message: e.message }); });
  a.get("/session", async (_req, reply) => ({ csrfToken: await reply.generateCsrf() }));
  await registerRagRoutes(a); await a.ready(); app = a; return a;
}
afterEach(async () => { await app?.close(); vi.clearAllMocks(); });
it("会话API要求登录与CSRF，Bearer写操作不能借用只读令牌", async () => {
  const a = await setup();
  expect((await a.inject("/api/v1/rag/conversations")).statusCode).toBe(401);
  expect((await a.inject({ method: "POST", url: "/api/v1/rag/conversations", headers: { "x-session": "yes" }, payload: {} })).statusCode).toBe(403);
  mocks.auth.mockResolvedValue({ actor, ctx: { tier: "READ_ONLY", projectWhitelist: [project] } });
  mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  expect((await a.inject({ url: "/api/v1/rag/conversations", headers: { authorization: "Bearer test" } })).statusCode).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(actor, { deleted: "false", page: 1, pageSize: 50 }, [project]);
  expect((await a.inject({ method: "POST", url: "/api/v1/rag/conversations", headers: { authorization: "Bearer test" }, payload: { projectId: project } })).statusCode).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("服务端会话提交校验所有输入并下传当前身份、范围和请求ID", async () => {
  const a = await setup(); const session = await a.inject("/session");
  const headers = { "x-session": "yes", cookie: session.cookies.map(c => `${c.name}=${c.value}`).join("; "), "x-csrf-token": session.json().csrfToken };
  mocks.create.mockResolvedValue({ id });
  expect((await a.inject({ method: "POST", url: "/api/v1/rag/conversations", headers, payload: { ownerId: "other" } })).statusCode).toBe(400);
  expect((await a.inject({ method: "POST", url: "/api/v1/rag/conversations", headers, payload: { projectId: project } })).statusCode).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(actor, { projectId: project }, undefined);
  mocks.send.mockResolvedValue({ message: { requestId }, conversation: { id } });
  expect((await a.inject({ method: "POST", url: `/api/v1/rag/conversations/${id}/messages`, headers, payload: { requestId, question: "核对账单", history: [] } })).statusCode).toBe(400);
  expect((await a.inject({ method: "POST", url: `/api/v1/rag/conversations/${id}/messages`, headers, payload: { requestId, question: "核对账单" } })).statusCode).toBe(200);
  expect(mocks.send).toHaveBeenCalledWith(actor, id, { requestId, question: "核对账单" }, undefined,{token:undefined});
  mocks.cancel.mockResolvedValue({ message: { requestId }, conversation: { id } });
  expect((await a.inject({ method: "POST", url: `/api/v1/rag/conversations/${id}/requests/${requestId}/cancel`, headers, payload: {} })).statusCode).toBe(200);
  expect(mocks.cancel).toHaveBeenCalledWith(actor, id, requestId, undefined,undefined);
});
it("新增会话MCP与OpenAPI完整发现，写入档位和项目白名单保持一致", async () => {
  const a = await setup(); const doc = (await a.inject("/api/v1/openapi.json")).json();
  expect(doc.paths["/api/v1/rag/conversations"].post.operationId).toBe("ragConversationCreate");
  expect(doc.paths["/api/v1/rag/conversations/{conversationId}/messages"].post.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/MessageInput");
  const tools = guardTools(RAG_TOOLS);
  const read = tools.find(t => t.name === "rag.conversation.get")!, send = tools.find(t => t.name === "rag.conversation.send")!;
  const ctx = { actor, token: { tier: "READ_ONLY", projectWhitelist: [project] } } as never;
  await expect(send.handler(ctx, { conversationId: id, requestId, question: "核对账单", userConfirmed: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  mocks.get.mockResolvedValue({ conversation: { id }, messages: [], hasMore: false });
  await read.handler(ctx, { conversationId: id });
  expect(mocks.get).toHaveBeenCalledWith(actor, id, undefined, [project],expect.objectContaining({tier:"READ_ONLY"}));
});
it('SSE事件真实判别、确认只接受decision，沿用CSRF与档位',async()=>{
 const a=await setup();const session=await a.inject('/session');const headers={'x-session':'yes',cookie:session.cookies.map(c=>`${c.name}=${c.value}`).join('; '),'x-csrf-token':session.json().csrfToken};
 const result={conversation:{id},message:{requestId,status:'completed'}};
 mocks.get.mockResolvedValue({conversation:{id},messages:[]});mocks.send.mockImplementation(async(_actor,_id,_input,_scope,options)=>{await options.emit({type:'accepted',result});await options.emit({type:'delta',text:'首段'});return result;});
 const response=await a.inject({method:'POST',url:`/api/v1/rag/conversations/${id}/messages/stream`,headers,payload:{requestId,question:'实时查询'}});
 expect(response.statusCode).toBe(200);expect(response.headers['content-type']).toContain('text/event-stream');
 const frames=response.body.trim().split('\n\n');expect(frames.map(f=>f.split('\n')[0])).toEqual(['event: accepted','event: delta','event: result']);expect(JSON.parse(frames[1]!.split('data: ')[1]!)).toEqual({type:'delta',text:'首段'});
 const url=`/api/v1/rag/conversations/${id}/requests/${requestId}/actions/${project}`;mocks.decision.mockResolvedValue(result);
 expect((await a.inject({method:'POST',url,headers,payload:{decision:'confirm',parameters:{title:'tampered'}}})).statusCode).toBe(400);expect(mocks.decision).not.toHaveBeenCalled();
 expect((await a.inject({method:'POST',url,headers,payload:{decision:'confirm'}})).statusCode).toBe(200);expect(mocks.decision).toHaveBeenCalledWith(actor,id,requestId,project,'confirm',undefined,undefined);
 expect((await a.inject({method:'POST',url,headers:{'x-session':'yes'},payload:{decision:'confirm'}})).statusCode).toBe(403);
});
