// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Actor } from "../src/server/permission/actor.ts";
import type { ConversationRow, MessageRow } from "../src/server/repos/rag-conversation.repo.ts";
import { DomainError } from "../src/shared/errors.ts";
import type { RagProject } from "../src/shared/rag.ts";
import type { RagChatResult } from "../src/shared/rag.ts";

const state = vi.hoisted(() => ({ conversations: new Map<string, ConversationRow>(), messages: new Map<string, MessageRow>(), projects: [] as RagProject[], deniedPages: new Set<string>(), chat: vi.fn(), publish: vi.fn(), loadActor: vi.fn(), currentActor: undefined as Actor | null | undefined, requiredGrant: undefined as string | undefined, sequence: Promise.resolve() }));
vi.mock("../src/server/services/workspace-events.service.ts", () => ({ publishWorkspaceInvalidation: state.publish }));
vi.mock("../src/server/auth/actor-loader.ts", () => ({ loadActor: state.loadActor }));
vi.mock("../src/server/services/rag.service.ts", () => ({ listRagProjects: async (_actor: unknown, allowed?: string[]) => state.projects.filter(p => !allowed?.length || allowed.includes(p.id)), chatRag: state.chat }));
vi.mock("../src/server/services/wiki.service.ts", () => ({ getPage: async (actor: Actor, id: string) => { if (state.deniedPages.has(id) || (state.requiredGrant && !actor.grants?.some(grant => grant.scopeId === state.requiredGrant))) throw new DomainError("FORBIDDEN", "无权访问"); return { projectId: state.projects[0]?.id }; } }));
vi.mock("../src/server/repos/rag-conversation.repo.ts", () => ({
  insertConversation: async (data: Pick<ConversationRow, "ownerId" | "projectId" | "title" | "titleIsDefault">) => { const row = { id: randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }; state.conversations.set(row.id, row); return row; },
  findConversation: async (owner: string, id: string) => { const row = state.conversations.get(id); return row?.ownerId === owner ? row : null; },
  listConversations: async (owner: string, deleted: boolean, page: number, pageSize: number, allowed?: string[]) => { const rows = [...state.conversations.values()].filter(r => r.ownerId === owner && !!r.deletedAt === deleted && (!allowed?.length || allowed.includes(r.projectId))); return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }; },
  withConversationLock: async (owner: string, id: string, callback: (row: ConversationRow | null) => Promise<unknown>) => { const previous = state.sequence; let release!: () => void; state.sequence = new Promise<void>(r => { release = r; }); await previous; try { const row = state.conversations.get(id); return await callback(row?.ownerId === owner ? row : null); } finally { release(); } },
  updateConversation: async (id: string, patch: Partial<ConversationRow>) => { const row = state.conversations.get(id); Object.assign(row!, patch, { updatedAt: new Date() }); return row; },
  listMessages: async (id: string, limit: number, before?: string) => { const rows = [...state.messages.values()].filter(r => r.conversationId === id); const end = before ? rows.findIndex(r => r.id === before) : rows.length; return rows.slice(0, end).reverse().slice(0, limit); },
  findMessage: async (id: string, requestId: string) => [...state.messages.values()].find(r => r.conversationId === id && r.requestId === requestId) ?? null,
  insertMessage: async (data: Pick<MessageRow, "conversationId" | "requestId" | "question" | "status">) => { const row = { id: randomUUID(), ...data, reply: null, createdAt: new Date(), updatedAt: new Date() }; state.messages.set(row.id, row); return row; },
  updateMessage: async (id: string, patch: Partial<MessageRow>) => { const row = state.messages.get(id); Object.assign(row!, patch, { updatedAt: new Date() }); return row; },
  expirePending: async (id: string, cutoff: Date) => { let changed = 0; for (const row of state.messages.values()) if (row.conversationId === id && row.status === "pending" && row.updatedAt < cutoff) { Object.assign(row, { status: "failed", reply: null, updatedAt: new Date() }); changed++; } return changed; },
  findPending: async (id: string) => [...state.messages.values()].find(r => r.conversationId === id && r.status === "pending") ?? null,
  cancelPending: async (id: string) => { for (const row of state.messages.values()) if (row.conversationId === id && row.status === "pending") Object.assign(row, { status: "cancelled", reply: null, updatedAt: new Date() }); },
}));
import * as service from "../src/server/services/rag-conversation.service.ts";
const actor = { memberId: randomUUID() } as Actor;
const other = { memberId: randomUUID() } as Actor;
const project = { id: randomUUID(), name: "甲", key: "A" };
const pageId = randomUUID();
const reply = (): RagChatResult => ({ ok: true, answer: "服务器答案", citations: [{ pageId, projectId: project.id, projectName: "甲", title: "秘密", headingPath: null, snippet: "秘密摘录" }], mode: "keyword", scope: { projectIds: [project.id], projectCount: 1 } });
const input = () => ({ requestId: randomUUID(), question: "第一个问题" });
beforeEach(() => { state.conversations.clear(); state.messages.clear(); state.projects = [project]; state.deniedPages.clear(); state.chat.mockReset(); state.chat.mockResolvedValue(reply()); state.publish.mockReset(); state.sequence = Promise.resolve(); state.currentActor = undefined; state.requiredGrant = undefined; state.loadActor.mockReset(); state.loadActor.mockImplementation(async (memberId: string) => state.currentActor === undefined ? { ...actor, memberId } : state.currentActor); });
describe("持久RAG会话服务", () => {
  it("会话和消息变更只发布所有者缓存定位，幂等发送不重复发布", async () => {
    const c = await service.createConversation(actor, { projectId: project.id });
    const event = { domain: "ragConversation", resourceType: "RAG_CONVERSATION", resourceId: c.id, memberId: actor.memberId };
    expect(state.publish).toHaveBeenLastCalledWith(event);
    await service.updateConversation(actor, c.id, { title: "新标题" });
    expect(state.publish).toHaveBeenCalledTimes(2);
    const request = input();
    await service.sendMessage(actor, c.id, request);
    expect(state.publish).toHaveBeenCalledTimes(4);
    await service.sendMessage(actor, c.id, request);
    expect(state.publish).toHaveBeenCalledTimes(4);
    await service.cancelMessage(actor, c.id, randomUUID());
    expect(state.publish).toHaveBeenCalledTimes(5);
    expect(state.publish.mock.calls.every(([payload]) => JSON.stringify(payload) === JSON.stringify(event))).toBe(true);
  });
  it("读取时只在过期消息首次改变状态后通知，普通GET不形成刷新循环", async () => {
    const c = await service.createConversation(actor, {});
    const stale = { id: randomUUID(), conversationId: c.id, ...input(), status: "pending", reply: null, createdAt: new Date(0), updatedAt: new Date(0) };
    state.messages.set(stale.id, stale); state.publish.mockClear();
    await service.getConversation(actor, c.id);
    expect(stale.status).toBe("failed"); expect(state.publish).toHaveBeenCalledOnce();
    await service.getConversation(actor, c.id);
    expect(state.publish).toHaveBeenCalledOnce();
  });
  it.each(["cancel", "delete", "deactivate"])("供应商尝试前检查%s后已停止的消息", async action => {
    let check!: () => Promise<void>;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    state.chat.mockImplementation(async (_actor, _input, _allowed, guard) => {
      check = guard; await guard(); await hold;
      await expect(guard()).rejects.toBeTruthy();
      return reply();
    });
    const c = await service.createConversation(actor, {}); const request = input();
    const running = service.sendMessage(actor, c.id, request).catch(error => error);
    await vi.waitFor(() => expect(check).toBeTypeOf("function"));
    if (action === "cancel") await service.cancelMessage(actor, c.id, request.requestId);
    else if (action === "delete") await service.updateConversation(actor, c.id, { deleted: true });
    else state.currentActor = null;
    release(); await running;
    expect(state.messages.size).toBe(1);
  });
  it("账号所有权与未知ID同形，固定范围不可由更新篡改", async () => {
    const c = await service.createConversation(actor, { projectId: project.id });
    expect(c).toMatchObject({ title: "新对话", projectId: project.id, available: true });
    expect(typeof c.createdAt).toBe("string");
    await expect(service.getConversation(other, c.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.getConversation(actor, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.updateConversation(actor, c.id, { projectId: project.id } as never)).rejects.toThrow();
  });
  it("相同请求重放真实回复，异问题冲突，首问自动命名且不覆盖手工名称", async () => {
    const c = await service.createConversation(actor, {}); const request = input();
    const first = await service.sendMessage(actor, c.id, request);
    const again = await service.sendMessage(actor, c.id, request);
    expect(first.message.reply).toEqual(reply()); expect(again.message.id).toBe(first.message.id); expect(state.messages.size).toBe(1);
    expect(first.conversation.title).toBe(request.question);
    await expect(service.sendMessage(actor, c.id, { ...request, question: "不同问题" })).rejects.toMatchObject({ code: "CONFLICT" });
    const named = await service.createConversation(actor, { title: "新对话" });
    await service.sendMessage(actor, named.id, input()); expect((await service.getConversation(actor, named.id)).conversation.title).toBe("新对话");
  });
  it("运行中重放pending，另一请求冲突，取消幂等且迟到结果不能覆写", async () => {
    let finish!: (value: RagChatResult) => void; state.chat.mockImplementation(() => new Promise(r => { finish = r; }));
    const c = await service.createConversation(actor, {}); const request = input(); const running = service.sendMessage(actor, c.id, request);
    await vi.waitFor(() => expect(state.chat).toHaveBeenCalledTimes(1));
    expect((await service.sendMessage(actor, c.id, request)).message.status).toBe("pending");
    await expect(service.sendMessage(actor, c.id, input())).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.cancelMessage(actor, c.id, request.requestId)).message.status).toBe("cancelled");
    expect((await service.cancelMessage(actor, c.id, request.requestId)).message.status).toBe("cancelled");
    finish(reply()); expect((await running).message).toMatchObject({ status: "cancelled", reply: null });
  });
  it("软删除取消pending，恢复后也不写入迟到回复", async () => {
    let finish!: (value: RagChatResult) => void; state.chat.mockImplementation(() => new Promise(r => { finish = r; }));
    const c = await service.createConversation(actor, {}); const running = service.sendMessage(actor, c.id, input());
    await vi.waitFor(() => expect(state.chat).toHaveBeenCalled());
    await service.updateConversation(actor, c.id, { deleted: true });
    expect((await service.listConversations(actor, { deleted: "true", page: 1, pageSize: 50 })).total).toBe(1);
    await service.updateConversation(actor, c.id, { deleted: false }); finish(reply());
    expect((await running).message.status).toBe("cancelled");
  });
  it("当前Wiki权限撤销清空答案与摘录，不能进入下一轮history", async () => {
    const c = await service.createConversation(actor, {}); await service.sendMessage(actor, c.id, input()); state.deniedPages.add(pageId);
    expect((await service.getConversation(actor, c.id)).messages[0]).toMatchObject({ status: "unavailable", reply: null });
    await service.sendMessage(actor, c.id, input()); expect(state.chat.mock.calls.at(-1)?.[1].history).toEqual([]);
  });
  it("固定项目失权和令牌白名单限制历史与提问", async () => {
    const c = await service.createConversation(actor, { projectId: project.id }); await service.sendMessage(actor, c.id, input());
    state.projects = [];
    const detail = await service.getConversation(actor, c.id);
    expect(detail.conversation).toMatchObject({ available: false, projectName: null }); expect(detail.messages[0]).toMatchObject({ status: "unavailable", reply: null });
    await expect(service.sendMessage(actor, c.id, input(), [randomUUID()])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("受限令牌看不到全部项目会话且无法操作范围外会话", async () => {
    const all = await service.createConversation(actor, {});
    await expect(service.createConversation(actor, {}, [project.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const operation of [() => service.getConversation(actor, all.id, undefined, [project.id]), () => service.updateConversation(actor, all.id, { title: "篡改" }, [project.id]), () => service.sendMessage(actor, all.id, input(), [project.id]), () => service.cancelMessage(actor, all.id, randomUUID(), [project.id])]) await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    const list = await service.listConversations(actor, { deleted: "false", page: 1, pageSize: 50 }, [project.id]); expect(list.total).toBe(0); expect(list.items).toEqual([]);
  });
  it("先取消再发送同请求ID始终不启动模型且补回原问题", async () => {
    const c = await service.createConversation(actor, {}); const request = input();
    expect((await service.cancelMessage(actor, c.id, request.requestId)).message.status).toBe("cancelled");
    const result = await service.sendMessage(actor, c.id, request); expect(result.message).toMatchObject({ status: "cancelled", question: request.question, reply: null }); expect(state.chat).not.toHaveBeenCalled();
    await expect(service.sendMessage(actor, c.id, { ...request, question: "不同" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("重放、取消与本人导出均重新隐藏已失权回答", async () => {
    const c = await service.createConversation(actor, {}); const request = input(); await service.sendMessage(actor, c.id, request); state.deniedPages.add(pageId);
    expect((await service.sendMessage(actor, c.id, request)).message).toMatchObject({ status: "unavailable", reply: null });
    expect((await service.cancelMessage(actor, c.id, request.requestId)).message).toMatchObject({ status: "unavailable", reply: null });
    await service.updateConversation(actor, c.id, { deleted: true });
    const exported = await service.exportConversationData(actor); expect(exported.conversations).toHaveLength(1); expect(exported.messages[0]).toMatchObject({ status: "unavailable", reply: null });
    expect(await service.exportConversationData(other)).toEqual({ conversations: [], messages: [] });
  });
  it("模型执行期间失去Wiki权限，最终发送响应也隐藏答案", async () => {
    state.chat.mockImplementation(async () => { state.deniedPages.add(pageId); return reply(); });
    const c = await service.createConversation(actor, {}); expect((await service.sendMessage(actor, c.id, input())).message).toMatchObject({ status: "unavailable", reply: null });
  });
  it("供应商等待期间角色主体被撤销，最终响应使用新Actor隐藏答案", async () => {
    const teamId = randomUUID(); state.requiredGrant = teamId;
    const original = { ...actor, grants: [{ roleKey: "MEMBER", scopeType: "TEAM" as const, scopeId: teamId }] };
    state.currentActor = original;
    state.chat.mockImplementation(async () => { state.currentActor = { ...actor, grants: [] }; return reply(); });
    const c = await service.createConversation(original, { projectId: project.id });
    expect((await service.sendMessage(original, c.id, input())).message).toMatchObject({ status: "unavailable", reply: null });
  });
  it("供应商等待期间账号失活，最终响应拒绝返回历史", async () => {
    state.chat.mockImplementation(async () => { state.currentActor = null; return reply(); });
    const c = await service.createConversation(actor, { projectId: project.id });
    await expect(service.sendMessage(actor, c.id, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("构建history前刷新角色主体，不把失权答案加入下一轮", async () => {
    const teamId = randomUUID(); state.requiredGrant = teamId;
    const original = { ...actor, grants: [{ roleKey: "MEMBER", scopeType: "TEAM" as const, scopeId: teamId }] };
    state.currentActor = original;
    const c = await service.createConversation(original, { projectId: project.id }); await service.sendMessage(original, c.id, input());
    state.currentActor = { ...actor, grants: [] };
    await service.sendMessage(original, c.id, input()); expect(state.chat.mock.calls.at(-1)?.[1].history).toEqual([]);
  });
  it("正常无结果保持completed，供应商失败failed，超时pending可回收", async () => {
    const c = await service.createConversation(actor, {}); state.chat.mockResolvedValue({ ...reply(), answer: null, citations: [], mode: "none" });
    expect((await service.sendMessage(actor, c.id, input())).message.status).toBe("completed");
    state.chat.mockResolvedValue({ ...reply(), ok: false, answer: null }); expect((await service.sendMessage(actor, c.id, input())).message.status).toBe("failed");
    const stale = { id: randomUUID(), conversationId: c.id, ...input(), status: "pending", reply: null, createdAt: new Date(0), updatedAt: new Date(0) }; state.messages.set(stale.id, stale);
    await service.sendMessage(actor, c.id, input()); expect(stale.status).toBe("failed");
  });
  it("只给同一会话最近六个有答案轮次，分页每次100条", async () => {
    const c = await service.createConversation(actor, {}); const b = await service.createConversation(actor, {}); await service.sendMessage(actor, b.id, { ...input(), question: "另一个会话" });
    for (let i = 0; i < 105; i++) await service.sendMessage(actor, c.id, { ...input(), question: `问题${i}` });
    const history = state.chat.mock.calls.at(-1)?.[1].history; expect(history).toHaveLength(12); expect(history[0]).toEqual({ role: "user", content: "问题98" });
    const detail = await service.getConversation(actor, c.id); expect(detail.messages).toHaveLength(100); expect(detail.messages[0]?.question).toBe("问题5"); expect(detail.hasMore).toBe(true);
    const older = await service.getConversation(actor, c.id, detail.messages[0]!.id); expect(older.messages).toHaveLength(5); expect(older.hasMore).toBe(false);
  });
});
it('explicit empty scope never exposes unrestricted conversations', async()=>{
 const c=await service.createConversation(actor,{projectId:project.id});
 await expect(service.getConversation(actor,c.id,undefined,[])).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(service.createConversation(actor,{},[])).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('business evidence and action scope revoked hides whole history answer', async()=>{
 const c=await service.createConversation(actor,{});await service.sendMessage(actor,c.id,input());
 for(const row of state.messages.values())row.reply={...reply(),citations:[],evidence:[{id:randomUUID(),toolName:'workitem.list',projectId:project.id,observedAt:new Date().toISOString(),resources:[],summary:'live'}]};state.projects=[];
 expect((await service.getConversation(actor,c.id)).messages[0]).toMatchObject({status:'unavailable',reply:null});
});
it('无工具回答也包含授权项目引导，撤销项目必须隐藏整轮历史',async()=>{
 const c=await service.createConversation(actor,{});state.chat.mockResolvedValue({...reply(),citations:[],evidence:[],actions:[]});await service.sendMessage(actor,c.id,input());state.projects=[];
 expect((await service.getConversation(actor,c.id)).messages[0]).toMatchObject({status:'unavailable',reply:null});
 expect((await service.exportConversationData(actor)).messages[0]?.reply).toBeNull();
});
