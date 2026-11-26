import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AssistantPage } from "../src/client/routes/AssistantPage.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";
import type { RagChatResult } from "../src/shared/rag.ts";
import type { RagConversation, RagConversationDetail, RagMessage } from "../src/shared/rag-conversations.ts";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const result: RagChatResult = { ok: true, answer: "发布前先完成**回归测试**。", mode: "vector", citations: [{ pageId: "page-a", projectId: A, projectName: "研发项目", title: "发布手册", headingPath: "发布 / 检查", snippet: "回归测试通过后方可发布。" }], scope: { projectIds: [A, B], projectCount: 2 } };
let client: QueryClient;
let records: Map<string, RagConversationDetail>;
let owners: Map<string, string>;
let memberId: string;
let detailReads: number;
let calls: { id: string; body: { requestId: string; question: string } }[];
let cancelCalls: string[];
let chat: (conversation: RagConversation, message: RagMessage) => Promise<Response>;
let reply: RagChatResult;
let create: (conversation: RagConversation) => Promise<Response>;
let patch: (conversation: RagConversation) => Promise<Response>;
let decisions: { decision: string }[];
let targetVersion: number;
let targetTitle: string;
let boardState: {stateKey:string;name:string};
let noTransitions: boolean;
let targetRelations: Record<string, string | null>;
let deniedRelation: string | undefined;
let managedStatesReads: number;
let decide: () => Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stamp = "2026-11-16T12:00:00.000Z";
function seed(title: string, projectId: string | null = null, question?: string) {
  const conversation: RagConversation = { id: crypto.randomUUID(), title, projectId, projectName: projectId === A ? "研发项目" : projectId === B ? "运营项目" : null, available: true, createdAt: stamp, updatedAt: stamp, deletedAt: null };
  owners.set(conversation.id, memberId);
  records.set(conversation.id, { conversation, messages: question ? [{ id: crypto.randomUUID(), conversationId: conversation.id, requestId: crypto.randomUUID(), question, status: "completed", reply: structuredClone(result), createdAt: stamp, updatedAt: stamp }] : [], hasMore: false });
  return conversation;
}
function finish(conversation: RagConversation, message: RagMessage, response = reply) {
  if (message.status === "pending") { message.status = response.ok ? "completed" : "failed"; message.reply = structuredClone(response); }
  return json({ conversation, message });
}
beforeEach(() => {
  setLocale("zh-CN"); calls = []; cancelCalls = []; records = new Map(); owners = new Map(); memberId = A; detailReads = 0; reply = structuredClone(result);
  vi.stubGlobal("scrollTo", () => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  chat = async (conversation, message) => finish(conversation, message);
  create = async (conversation) => json(conversation);
  patch = async (conversation) => json(conversation);
  boardState = {stateKey:"TODO",name:"待处理"}; noTransitions = false;
  decisions = []; targetVersion = 3; targetTitle = "原始标题"; targetRelations = {}; deniedRelation = undefined; managedStatesReads = 0;
  decide = async () => json({});
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === "/api/v1/work-items/target") return json({ id: "target", projectId: A, key: "DEV-12", title: targetTitle, version: targetVersion, priority: "LOW", statusId: "todo", workflowId: "workflow", assigneeId: A, allowedTransitions: noTransitions ? [] : [{ toStateKey: "DONE", toName: "已完成" }], ...targetRelations });
    if (path === "/api/v1/workflows/workflow/states") { managedStatesReads++; return json({ code: "FORBIDDEN", message: "无工作流管理权限", details: null }, 403); }
    if (path === `/api/v1/projects/${A}/work-items/board`) return json({ columns: [{ ...boardState, items: [{ id: "target", version: targetVersion }] }] });
    if (/^\/api\/v1\/(work-items|milestones|iterations|releases|modules)\/(old|new)-/.test(path)) {
      const id = path.split("/").at(-1)!;
      if (id === deniedRelation) return json({ code: "FORBIDDEN", message: "关联对象不可访问", details: null }, 403);
      if (path.includes("/work-items/")) return json({ id, projectId: A, key: id.startsWith("old") ? "DEV-10" : "DEV-20", title: id.startsWith("old") ? "原父项" : "新父项" });
      return json({ id, projectId: A, name: id.startsWith("old") ? "原业务计划" : "新业务计划" });
    }
    if (path === `/api/v1/projects/${A}/members`) return json({ members: [{ id: A, name: "陈华", username: "chenhua" }, { id: B, name: "李明", username: "liming" }] });
    if (path.endsWith("/rag/projects")) return json({ items: [{ id: A, key: "DEV", name: "研发项目" }, { id: B, key: "OPS", name: "运营项目" }] });
    const base = "/api/v1/rag/conversations";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === base) {
      if (init?.method === "POST") return create(seed(body.title ?? "新对话", body.projectId ?? null));
      const deleted = url.searchParams.get("deleted") === "true", page = Number(url.searchParams.get("page") ?? 1);
      const items = [...records.values()].map((r) => r.conversation).filter((c) => owners.get(c.id) === memberId && !!c.deletedAt === deleted);
      return json({ items: items.slice((page - 1) * 50, page * 50), total: items.length, page, pageSize: 50 });
    }
    if (path.startsWith(`${base}/`)) {
      const [id, action, requestId] = path.slice(base.length + 1).split("/");
      const record = records.get(id!);
      if (!record || owners.get(id!) !== memberId) return json({ code: "NOT_FOUND", message: "会话不存在", details: null }, 404);
      if (action === "messages") {
        calls.push({ id: id!, body });
        let message = record.messages.find((m) => m.requestId === body.requestId);
        if (!message) {
          message = { id: crypto.randomUUID(), conversationId: id!, requestId: body.requestId, question: body.question, status: "pending", reply: null, createdAt: stamp, updatedAt: stamp };
          record.messages.push(message);
          if (record.messages.length === 1) record.conversation.title = body.question.slice(0, 120);
        }
        return chat(record.conversation, message);
      }
      if (action === "requests") {
        if (path.includes("/actions/")) {
          decisions.push(body);
          const response = await decide();
          if (!response.ok) return response;
          const message = record.messages.find(m => m.requestId === requestId)!;
          message.reply!.actions![0]!.status = body.decision === "confirm" ? "confirmed" : "rejected";
          if (body.decision === "confirm") { targetVersion++; targetTitle = String(message.reply!.actions![0]!.parameters.title ?? targetTitle); }
          return json({ conversation: record.conversation, message });
        }
        cancelCalls.push(requestId!);
        const message = record.messages.find((m) => m.requestId === requestId)!;
        message.status = "cancelled"; message.reply = null;
        return json({ conversation: record.conversation, message });
      }
      if (init?.method === "PATCH") {
        if (body.title !== undefined) record.conversation.title = body.title;
        if (body.deleted !== undefined) record.conversation.deletedAt = body.deleted ? stamp : null;
        return patch(record.conversation);
      }
      detailReads++;
      const before = url.searchParams.get("before");
      const end = before ? record.messages.findIndex((message) => message.id === before) : record.messages.length;
      return json({ ...record, messages: record.messages.slice(Math.max(0, end - 100), end), hasMore: end > 100 });
    }
    throw new Error(`Unexpected API: ${init?.method} ${path}`);
  });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

async function show(path = "/assistant", waitForScope = true, permissions: string[] = []) {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: "/assistant", validateSearch: (search: Record<string, unknown>) => ({ project: typeof search.project === "string" ? search.project : undefined, conversation: typeof search.conversation === "string" ? search.conversation : undefined }), component: AssistantPage });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [path] }) });
  const actor: Actor = { memberId, username: memberId, name: memberId, permissions, dataScopes: [], mustChangePassword: false, locale: "zh-CN", theme: null, timezone: null };
  render(<QueryClientProvider client={client}><ActorContext.Provider value={actor}><RouterProvider router={router as never} /></ActorContext.Provider></QueryClientProvider>);
  await screen.findByRole("textbox", { name: "你的问题" });
  if (waitForScope) await waitFor(() => expect((screen.getByRole("button", { name: "资料范围" }) as HTMLButtonElement).disabled).toBe(false));
  return router;
}
function textbox() { return screen.getByRole("textbox", { name: "你的问题" }) as HTMLTextAreaElement; }
function send(question: string) { fireEvent.change(textbox(), { target: { value: question } }); fireEvent.click(screen.getByRole("button", { name: "发送问题" })); }
async function completed() { await screen.findByText("回归测试", { selector: "strong" }); await waitFor(() => expect(textbox().readOnly).toBe(false)); }
async function selectScope(name: string) { fireEvent.click(screen.getByRole("button", { name: "资料范围" })); fireEvent.click(await screen.findByRole("option", { name })); }
async function switchTo(name: string) { fireEvent.click(await screen.findByRole("link", { name: new RegExp(name) })); }

it("首次发送创建真实会话并写入URL，追问只传question与requestId", async () => {
  const router = await show(); expect(records.size).toBe(0);
  send("发布前做什么？"); await completed();
  expect(router.state.location.search).toMatchObject({ conversation: calls[0]!.id });
  expect(screen.getByText("对话按账号保存")).toBeTruthy();
  send("谁来验收？"); await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[0]!.id).toBe(calls[1]!.id);
  expect(Object.keys(calls[1]!.body).sort()).toEqual(["question", "requestId"]);
  expect(calls[1]!.body.requestId).not.toBe(calls[0]!.body.requestId);
});

it.each([false, true])("发送立即清空输入框，问题只出现在消息中（已有会话=%s）", async (existing) => {
  let resolve!: () => void;
  chat = (c, m) => new Promise((done) => { resolve = () => done(finish(c, m)); });
  const one = existing ? seed("已有会话", A) : undefined;
  await show(one ? `/assistant?conversation=${one.id}` : "/assistant");
  send("发送后不应留在输入框");
  expect(textbox().value).toBe("");
  await screen.findByText("发送后不应留在输入框", { selector: ".assistant-question" });
  expect(textbox().value).toBe("");
  await act(async () => resolve());
  await completed();
});

it("刷新正在回答的会话不把已发送问题填回输入框", async () => {
  const one = seed("等待会话", A, "已经发送的问题");
  const message = records.get(one.id)!.messages[0]!;
  message.status = "pending"; message.reply = null;
  await show(`/assistant?conversation=${one.id}`);
  await screen.findByRole("button", { name: "取消回答" });
  expect(textbox().value).toBe("");
});

it("两会话切换恢复内容和范围，伪造URL范围不改变已有会话", async () => {
  const one = seed("发布计划", A, "研发旧问题"), two = seed("运营计划", B, "运营旧问题");
  await show(`/assistant?conversation=${one.id}&project=${B}`);
  await screen.findByText("研发旧问题", { selector: ".assistant-question" });
  expect(screen.getByRole("button", { name: "资料范围" }).textContent).toContain("研发项目");
  fireEvent.change(textbox(), { target: { value: "研发未发送草稿" } });
  await switchTo("运营计划"); await screen.findByText("运营旧问题", { selector: ".assistant-question" });
  expect(textbox().value).toBe("");
  expect(screen.getByRole("button", { name: "资料范围" }).textContent).toContain("运营项目");
  fireEvent.change(textbox(), { target: { value: "运营未发送草稿" } });
  await switchTo("发布计划"); await screen.findByText("研发旧问题", { selector: ".assistant-question" });
  expect(textbox().value).toBe("研发未发送草稿");
  expect(two.id).not.toBe(one.id);
});

it("刷新query恢复已保存会话，换范围开启空白且保留旧会话", async () => {
  const one = seed("已保存的对话", A, "已保存的问题");
  const router = await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("已保存的问题", { selector: ".assistant-question" });
  await selectScope("运营项目 · OPS");
  await waitFor(() => expect(screen.queryByText("已保存的问题", { selector: ".assistant-question" })).toBeNull());
  expect(router.state.location.search).toMatchObject({ project: B });
  send("运营新问题"); await completed();
  expect(records.get(calls[0]!.id)!.conversation.projectId).toBe(B);
  await switchTo("已保存的对话"); await screen.findByText("已保存的问题", { selector: ".assistant-question" });
});

it("切换期间迟到响应只更新原会话，新建也不删除旧内容", async () => {
  let resolve!: () => void;
  chat = (c, m) => new Promise((done) => { resolve = () => done(finish(c, m)); });
  const one = seed("研发会话", A), two = seed("运营会话", B, "运营旧问题");
  await show(`/assistant?conversation=${one.id}`); send("慢问题");
  await screen.findByRole("button", { name: "取消回答" });
  await switchTo("运营会话"); await screen.findByText("运营旧问题", { selector: ".assistant-question" });
  fireEvent.change(textbox(), { target: { value: "运营草稿" } });
  await act(async () => resolve());
  expect(screen.queryByText("慢问题", { selector: ".assistant-question" })).toBeNull(); expect(textbox().value).toBe("运营草稿");
  await switchTo("慢问题"); await screen.findByText("慢问题", { selector: ".assistant-question" });
  fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
  await waitFor(() => expect(screen.queryByText("慢问题", { selector: ".assistant-question" })).toBeNull());
  expect(records.has(one.id)).toBe(true); expect(records.has(two.id)).toBe(true);
});

it("刷新pending可取消，显式cancel保留问题且点击不触发默认重提", async () => {
  const one = seed("等待中的会话", A, "等待问题");
  const message = records.get(one.id)!.messages[0]!; message.status = "pending"; message.reply = null;
  await show(`/assistant?conversation=${one.id}`);
  const stop = await screen.findByRole("button", { name: "取消回答" });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true }); fireEvent(stop, click);
  expect(click.defaultPrevented).toBe(true);
  await waitFor(() => expect(textbox().readOnly).toBe(false));
  expect(cancelCalls).toEqual([message.requestId]); expect(calls).toHaveLength(0); expect(textbox().value).toBe("等待问题");
});

it("重命名、软删除、已删除列表与恢复返回可读内容", async () => {
  const one = seed("需要整理", A, "保留的问题");
  await show(`/assistant?conversation=${one.id}`); await screen.findByText("保留的问题", { selector: ".assistant-question" });
  fireEvent.click(screen.getByRole("button", { name: "重命名对话" }));
  fireEvent.change(screen.getByRole("textbox", { name: "对话名称" }), { target: { value: "发布资料" } });
  fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
  await screen.findByRole("link", { name: /发布资料/ });
  fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
  await waitFor(() => expect(screen.queryByText("保留的问题", { selector: ".assistant-question" })).toBeNull());
  expect(records.get(one.id)!.conversation.deletedAt).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "已删除" }));
  await switchTo("发布资料"); await screen.findByText("保留的问题", { selector: ".assistant-question" });
  fireEvent.click(screen.getByRole("button", { name: "恢复对话" }));
  await waitFor(() => expect(records.get(one.id)!.conversation.deletedAt).toBeNull());
  await screen.findByRole("button", { name: "删除对话" });
});

it("模糊网络失败且服务器尚未认领时重试复用请求ID，明确failed重试换ID", async () => {
  chat = async (conversation) => { records.get(conversation.id)!.messages = []; throw new TypeError("Failed to fetch"); };
  await show(); send("网络问题");
  await screen.findByRole("button", { name: "重试问题" }); expect(textbox().value).toBe("网络问题");
  chat = async (c, m) => { m.status = "failed"; m.reply = null; return json({ conversation: c, message: m }); };
  fireEvent.click(screen.getByRole("button", { name: "重试问题" }));
  await screen.findByText("回答失败，问题已保留，请重试。");
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.body.requestId).toBe(calls[0]!.body.requestId);
  chat = async (c, m) => finish(c, m);
  fireEvent.click(screen.getByRole("button", { name: "重试问题" })); await completed();
  expect(calls[2]!.body.requestId).not.toBe(calls[1]!.body.requestId);
});

it("Enter发送，Shift+Enter、Alt+Enter与中文输入法确认不误发", async () => {
  await show(); fireEvent.change(textbox(), { target: { value: "整理验收要点" } });
  fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true }); fireEvent.keyDown(textbox(), { key: "Enter", altKey: true });
  fireEvent.keyDown(textbox(), { key: "Enter", isComposing: true }); fireEvent.keyDown(textbox(), { key: "Enter", keyCode: 229 });
  expect(calls).toHaveLength(0); fireEvent.keyDown(textbox(), { key: "Enter" }); await completed(); expect(calls).toHaveLength(1);
});

it("保留引用编号、安全Markdown、超时本地化与折叠技术详情", async () => {
  reply = { ...result, ok: false, answer: null, note: "调用失败：The operation was aborted due to timeout" };
  await show(); send("上线如何检查？");
  await screen.findByText("回答服务超时，问题已保留。可重试，或先查看参考来源。");
  expect((screen.getByText("技术详情", { selector: "summary" }).closest("details") as HTMLDetailsElement).open).toBe(false);
  const summary = screen.getByText("参考来源 · 1", { selector: "summary" });
  expect((summary.closest("details") as HTMLDetailsElement).open).toBe(false); fireEvent.click(summary);
  expect(screen.getByRole("link", { name: /\[1\].*研发项目.*发布手册/ }).getAttribute("href")).toBe(`/projects/${A}/wiki?page=page-a`);
  reply = result; fireEvent.click(screen.getByRole("button", { name: "重试问题" })); await completed();
});

it.each([false, true])("缺少对话模型时保留问题并按权限提供恢复指引（可配置=%s）", async canConfigure => {
  reply = { ...result, ok: false, answer: null, note: "未配置对话模型（ai.chatModel）" };
  await show("/assistant", true, canConfigure ? ["ai:configure"] : []);
  send("首次使用验收的操作顺序是什么？");
  await screen.findByText(canConfigure
    ? "还没有配置对话模型。请先配置模型，再重试这条问题。"
    : "还没有配置对话模型。请联系管理员配置后，再重试这条问题。");
  expect(textbox().value).toBe("首次使用验收的操作顺序是什么？");
  const configure = screen.queryByRole("link", { name: "配置对话模型" });
  if (canConfigure) expect(configure?.getAttribute("href")).toBe("/settings/integrations");
  else expect(configure).toBeNull();
  expect((screen.getByText("技术详情", { selector: "summary" }).closest("details") as HTMLDetailsElement).open).toBe(false);
});

it("unavailable历史不伪造回答，未知会话提供已删除恢复入口", async () => {
  const one = seed("失去来源权限", A, "历史问题");
  records.get(one.id)!.messages[0]!.status = "unavailable"; records.get(one.id)!.messages[0]!.reply = null;
  const router = await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("此回答的资料已不可访问。"); expect(screen.queryByText("回归测试", { selector: "strong" })).toBeNull();
  await act(async () => { await router.navigate({ to: "/assistant", search: { conversation: crypto.randomUUID() } }); });
  await screen.findByRole("button", { name: "查看已删除对话" });
});

it("点击范围图标打开完整共享Select，Escape焦点返回按钮", async () => {
  await show(); fireEvent.click(document.querySelector(".assistant-context svg")!);
  expect(screen.getByRole("listbox", { name: "资料范围" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull(); expect(document.activeElement).toBe(screen.getByRole("button", { name: "资料范围" }));
  expect(within(screen.getByRole("button", { name: "资料范围" })).queryByText("全部项目")).toBeTruthy();
});


it("刷新后的pending轮询恢复完成回答，不重发问题", async () => {
  const one = seed("正在回答", A, "可恢复的等待");
  const message = records.get(one.id)!.messages[0]!; message.status = "pending"; message.reply = null;
  await show(`/assistant?conversation=${one.id}`); await screen.findByRole("button", { name: "取消回答" });
  finish(one, message);
  await waitFor(() => expect(screen.getByText("回归测试", { selector: "strong" })).toBeTruthy(), { timeout: 3500 });
  expect(textbox().readOnly).toBe(false); expect(calls).toHaveLength(0);
});

it("停止正在提交的请求后忽略迟到答案，可继续新问题", async () => {
  let resolve!: () => void;
  chat = (c, m) => new Promise((done) => { resolve = () => done(finish(c, m)); });
  await show(); send("先取消的问题"); await screen.findByRole("button", { name: "取消回答" });
  fireEvent.click(screen.getByRole("button", { name: "取消回答" }));
  await waitFor(() => expect(textbox().readOnly).toBe(false));
  expect(textbox().value).toBe("先取消的问题");
  await act(async () => resolve());
  expect(screen.queryByText("回归测试", { selector: "strong" })).toBeNull(); expect(calls).toHaveLength(1);
  chat = async (c, m) => finish(c, m); send("继续新问题"); await completed(); expect(calls).toHaveLength(2);
});

it("从固定项目切回全部范围开启新会话，旧范围保持不变", async () => {
  const one = seed("固定范围", A, "旧问题");
  const router = await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("旧问题", { selector: ".assistant-question" });
  await selectScope("全部项目");
  await waitFor(() => expect(router.state.location.search.project).toBeUndefined());
  expect(router.state.location.search.conversation).toBeUndefined();
  send("全部资料的问题"); await completed();
  expect(records.get(calls[0]!.id)!.conversation.projectId).toBeNull();
  expect(records.get(one.id)!.conversation.projectId).toBe(A);
});

it("会话列表每页50条，详情最近100条并按时间正序加载更早消息", async () => {
  const one = seed("较长会话", A);
  const record = records.get(one.id)!;
  record.messages = Array.from({ length: 101 }, (_, index) => ({ id: crypto.randomUUID(), conversationId: one.id, requestId: crypto.randomUUID(), question: `记录问题${index}`, status: "completed" as const, reply: { ...result, answer: `记录回答${index}`, citations: [] }, createdAt: stamp, updatedAt: stamp }));
  for (let index = 0; index < 50; index++) seed(`列表会话${index}`);
  await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("记录问题100", { selector: ".assistant-question" });
  expect(screen.queryByText("记录问题0", { selector: ".assistant-question" })).toBeNull();
  expect(screen.queryByRole("link", { name: /列表会话49/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "加载更多对话" })); await screen.findByRole("link", { name: /列表会话49/ });
  fireEvent.click(screen.getByRole("button", { name: "加载更早消息" })); await screen.findByText("记录问题0", { selector: ".assistant-question" });
  const questions = document.querySelectorAll(".assistant-question"); expect(questions[0]!.textContent).toBe("记录问题0"); expect(questions[100]!.textContent).toBe("记录问题100");
});


it("创建会话尚未返回时停止，不会随后发送已取消的问题", async () => {
  let resolve!: () => void;
  create = (conversation) => new Promise((done) => { resolve = () => done(json(conversation)); });
  await show(); send("创建中的问题");
  fireEvent.click(await screen.findByRole("button", { name: "取消回答" }));
  await act(async () => resolve());
  await waitFor(() => expect(textbox().readOnly).toBe(false));
  expect(calls).toHaveLength(0); expect(textbox().value).toBe("创建中的问题");
});


it("删除响应迟到时不把已经切换的另一会话导航走", async () => {
  let resolve!: () => void;
  patch = (conversation) => new Promise((done) => { resolve = () => done(json(conversation)); });
  const one = seed("删除原会话", A, "原会话问题"), two = seed("保留当前会话", B, "当前会话问题");
  const router = await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("原会话问题", { selector: ".assistant-question" });
  fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
  await switchTo("保留当前会话"); await screen.findByText("当前会话问题", { selector: ".assistant-question" });
  await act(async () => resolve());
  expect(router.state.location.search.conversation).toBe(two.id);
  expect(screen.getByText("当前会话问题", { selector: ".assistant-question" })).toBeTruthy();
});

it("手机会话列表按需展开，选择后关闭抽屉", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  seed("手机已保存会话", A, "手机恢复问题");
  await show(); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "会话列表" }));
  await screen.findByRole("dialog", { name: "对话" });
  await switchTo("手机已保存会话"); await screen.findByText("手机恢复问题", { selector: ".assistant-question" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});


it("退出清缓存并换账号后，旧消息POST迟到不能重建缓存或泄露答案", async () => {
  let resolve!: () => void;
  chat = (c, m) => new Promise((done) => { resolve = () => done(finish(c, m)); });
  const one = seed("账号A私有会话", A);
  await show(`/assistant?conversation=${one.id}`); send("账号A私有问题");
  await screen.findByRole("button", { name: "取消回答" });
  cleanup(); await client.cancelQueries(); client.clear(); memberId = B;
  await show();
  await act(async () => resolve());
  expect(client.getQueryCache().findAll().some((query) => query.queryKey.includes(one.id))).toBe(false);
  cleanup(); await show(`/assistant?conversation=${one.id}`, false);
  await screen.findByRole("button", { name: "查看已删除对话" });
  expect(screen.queryByText("账号A私有问题", { selector: ".assistant-question" })).toBeNull();
  expect(screen.queryByText("回归测试", { selector: "strong" })).toBeNull();
});

it("退出后旧create迟到不能导航或继续以新账号发出原问题", async () => {
  let resolve!: () => void;
  create = (conversation) => new Promise((done) => { resolve = () => done(json(conversation)); });
  const oldRouter = await show(); send("账号A创建中的问题");
  await screen.findByRole("button", { name: "取消回答" });
  cleanup(); await client.cancelQueries(); client.clear(); memberId = B;
  const newRouter = await show();
  await act(async () => resolve());
  expect(calls).toHaveLength(0);
  expect(oldRouter.state.location.search.conversation).toBeUndefined();
  expect(newRouter.state.location.search.conversation).toBeUndefined();
});

it("退出后旧PATCH迟到不能改写新账号缓存或触发原导航", async () => {
  let resolve!: () => void;
  patch = (conversation) => new Promise((done) => { resolve = () => done(json(conversation)); });
  const one = seed("账号A待删除", A, "账号A的历史");
  const oldRouter = await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("账号A的历史", { selector: ".assistant-question" });
  fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
  cleanup(); await client.cancelQueries(); client.clear(); memberId = B;
  await show();
  await act(async () => resolve());
  expect(oldRouter.state.location.search.conversation).toBe(one.id);
  expect(client.getQueryCache().findAll().some((query) => query.queryKey.includes(one.id))).toBe(false);
});

it("POST网络失败但详情确认pending时保留取消入口并阻止并发重提", async () => {
  chat = async () => { throw new TypeError("Failed to fetch"); };
  const one = seed("服务器确认等待", A);
  await show(`/assistant?conversation=${one.id}`);
  const readsBeforeSend = detailReads;
  send("已被服务器认领的问题");
  await waitFor(() => expect(detailReads).toBeGreaterThan(readsBeforeSend));
  await waitFor(() => expect(screen.getByRole("button", { name: "取消回答" })).toBeTruthy());
  expect(textbox().readOnly).toBe(true);
  fireEvent.submit(textbox().closest("form")!); expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "取消回答" }));
  await waitFor(() => expect(textbox().readOnly).toBe(false));
  expect(cancelCalls).toEqual([calls[0]!.body.requestId]); expect(textbox().value).toBe("已被服务器认领的问题");
});


it("服务器拒绝详情后不渲染ReactQuery保留的旧data", async () => {
  const one = seed("旧账号缓存", A, "不能继续显示的旧问题");
  memberId = B;
  client.setQueryData(["rag-conversation", B, one.id], { pages: [structuredClone(records.get(one.id)!)], pageParams: [undefined] });
  await show(`/assistant?conversation=${one.id}`, false);
  await screen.findByRole("button", { name: "查看已删除对话" });
  expect(screen.queryByText("不能继续显示的旧问题", { selector: ".assistant-question" })).toBeNull();
  expect(screen.queryByText("回归测试", { selector: "strong" })).toBeNull();
});

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { "content-type": "text/event-stream" } });
  return { response, emit: (event: object & { type: string }) => controller.enqueue(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)), close: () => controller.close() };
}
it("SSE增量立即显示，reset清掉旧正文，轮询不抹掉新正文且final替换临时内容", async () => {
  const stream = controlledStream();
  chat = async (c, m) => { stream.emit({ type: "accepted", result: { conversation: c, message: m } }); return stream.response; };
  const one = seed("流式回答", A);
  await show(`/assistant?conversation=${one.id}`); send("实时进度");
  await waitFor(() => expect(calls).toHaveLength(1));
  await act(async () => stream.emit({ type: "delta", text: "旧的部分回答" }));
  await screen.findByText("旧的部分回答"); expect(textbox().value).toBe("");
  await act(async () => stream.emit({ type: "reset" }));
  await screen.findByText("正在重试回答…"); expect(screen.queryByText("旧的部分回答")).toBeNull();
  await act(async () => stream.emit({ type: "delta", text: "新的部分回答" }));
  await screen.findByText("新的部分回答");
  await act(async () => { await client.invalidateQueries({ queryKey: ["rag-conversation", A, one.id] }); });
  expect(screen.getByText("新的部分回答")).toBeTruthy();
  await act(async () => { const m = records.get(one.id)!.messages[0]!; finish(one, m); stream.emit({ type: "result", result: { conversation: one, message: m } }); });
  await completed(); expect(screen.queryByText("新的部分回答")).toBeNull();
});
it("断流保留pending并轮询恢复同一个请求，不把半截答案当完成", async () => {
  const stream = controlledStream();
  chat = async (c, m) => { stream.emit({ type: "accepted", result: { conversation: c, message: m } }); return stream.response; };
  const one = seed("断流恢复", A); await show(`/assistant?conversation=${one.id}`); send("网络中断");
  await waitFor(() => expect(calls).toHaveLength(1));
  await act(async () => { stream.emit({ type: "delta", text: "尚未完成的答案" }); stream.close(); });
  await screen.findByText("连接已中断，正在恢复已保存的请求…");
  expect(screen.getByRole("button", { name: "取消回答" })).toBeTruthy();
  fireEvent.submit(textbox().closest("form")!); expect(calls).toHaveLength(1);
  finish(one, records.get(one.id)!.messages[0]!);
  await act(async () => { await client.invalidateQueries({ queryKey: ["rag-conversation", A, one.id] }); });
  await completed(); expect(screen.queryByText("尚未完成的答案")).toBeNull();
});
function proposalReply() {
  return { ...result, evidence: [{ id: "e1", projectId: A, toolName: "workitem.get", observedAt: stamp, summary: "已读取工作项当前状态", resources: [{ kind: "workItem" as const, id: "target" }] }, { id: "e2", projectId: A, toolName: "project.get", observedAt: stamp, summary: "已核对项目", resources: [] }], actions: [{ id: "proposal", projectId: A, toolName: "workitem.update", targetId: "target", parameters: { workItemId: "target", expectedVersion: 3, title: "新的业务标题", priority: "HIGH" }, expectedVersion: 3, status: "pending" as const, createdAt: stamp, expiresAt: "2099-11-16T13:00:00.000Z" }] };
}
it("业务建议显示项目编号标题及新旧值，证据集中折叠，确认只提交decision且防重复", async () => {
  reply = proposalReply();
  let resolve!: () => void; decide = () => new Promise(done => { resolve = () => done(json({})); });
  await show(); send("修改任务"); await completed();
  await screen.findByText("DEV-12"); expect(screen.getByText("原始标题", { selector: ".assistant-action-target span" })).toBeTruthy();
  expect(screen.getByText("新的业务标题")).toBeTruthy();
  expect(screen.getByText("高")).toBeTruthy(); expect(screen.getByText("低")).toBeTruthy();
  const evidence = screen.getByText("业务依据 · 2", { selector: "summary" }).closest("details")!;
  expect(evidence.open).toBe(false); expect(evidence.querySelectorAll("li")).toHaveLength(2);
  expect(within(evidence).getByRole("button", { name: /工作项/, hidden: true })).toBeTruthy();
  expect(evidence.querySelector('a[href*="issue=target"]')).toBeNull();
  const button = screen.getByRole("button", { name: "确认执行" }); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText("执行中"); expect(decisions).toEqual([{ decision: "confirm" }]);
  await act(async () => resolve()); await screen.findAllByText("已执行 · 待核验");
  await waitFor(() => expect(screen.getByText("新的业务标题", { selector: ".assistant-action-target span" })).toBeTruthy());
  expect(screen.queryByText("原始标题")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
});
it("拒绝建议不提交参数，版本已变化的建议不能确认", async () => {
  const one = seed("操作拒绝", A, "旧问题"); records.get(one.id)!.messages[0]!.reply = proposalReply();
  await show(`/assistant?conversation=${one.id}`); await screen.findByText("DEV-12");
  fireEvent.click(screen.getByRole("button", { name: "拒绝建议" })); await screen.findAllByText("已拒绝");
  expect(decisions).toEqual([{ decision: "reject" }]);
  cleanup(); client.clear(); targetVersion = 4; records.get(one.id)!.messages[0]!.reply = proposalReply();
  await show(`/assistant?conversation=${one.id}`); await screen.findByText("目标已变化，请重新提问生成建议。");
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true);
});
it("SSE工具进度用业务名称，error可见并保持请求恢复", async () => {
  const stream = controlledStream();
  chat = async (c, m) => { stream.emit({ type: "accepted", result: { conversation: c, message: m } }); return stream.response; };
  const one = seed("工具状态", A); await show(`/assistant?conversation=${one.id}`); send("读任务");
  await waitFor(() => expect(calls).toHaveLength(1));
  await act(async () => stream.emit({ type: "status", phase: "tool", toolName: "workitem.get" }));
  await screen.findByText("正在读取工作项…");
  await act(async () => stream.emit({ type: "error", message: "模型暂时不可用" }));
  await screen.findByText("模型暂时不可用");
  expect(screen.getByRole("button", { name: "取消回答" })).toBeTruthy();
});
it("后台会话的SSE增量不会串到当前会话，返回后可继续读原正文", async () => {
  const stream = controlledStream();
  chat = async (c, m) => { stream.emit({ type: "accepted", result: { conversation: c, message: m } }); return stream.response; };
  const one = seed("后台流式", A), two = seed("当前会话", B, "当前问题");
  const router = await show(`/assistant?conversation=${one.id}`); send("后台问题");
  await waitFor(() => expect(calls).toHaveLength(1));
  await act(async () => { await router.navigate({ to: "/assistant", search: { conversation: two.id } }); });
  fireEvent.change(textbox(), { target: { value: "当前新草稿" } });
  await act(async () => stream.emit({ type: "delta", text: "后台专属正文" }));
  expect(screen.queryByText("后台专属正文")).toBeNull(); expect(textbox().value).toBe("当前新草稿");
  await act(async () => { await router.navigate({ to: "/assistant", search: { conversation: one.id } }); });
  await screen.findByText("后台专属正文");
});
it("确认冲突时显示重新生成提示，不能覆盖原建议参数或再次执行", async () => {
  const one = seed("冲突操作", A, "修改问题"); records.get(one.id)!.messages[0]!.reply = proposalReply();
  decide = async () => json({ code: "CONFLICT", message: "目标版本已变化", details: null }, 409);
  await show(`/assistant?conversation=${one.id}`); await screen.findByText("DEV-12");
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  await screen.findByText("目标已变化，请重新提问生成建议。");
  expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(true);
  expect(records.get(one.id)!.messages[0]!.reply!.actions![0]!.parameters.title).toBe("新的业务标题");
});
it("状态建议通过REST扁平目标与普通业务看板显示当前和目标状态名", async () => {
  reply = proposalReply(); reply.actions![0] = { ...reply.actions![0]!, toolName: "workitem.transition", parameters: { workItemId: "target", version: 3, toStateKey: "DONE" } };
  await show(); send("完成任务"); await completed();
  await screen.findByText("待处理"); expect(screen.getByText("已完成")).toBeTruthy();
});
it("指派建议解析新旧成员名字，网络失败允许用原建议重试", async () => {
  reply = proposalReply(); reply.actions![0] = { ...reply.actions![0]!, toolName: "workitem.assign", parameters: { workItemId: "target", assigneeId: B } };
  decide = async () => json({ code: "INTERNAL", message: "网络暂时不可用", details: null }, 503);
  await show(); send("指派给李明"); await completed();
  await screen.findByText("陈华"); expect(screen.getByText("李明")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  await screen.findByText("网络暂时不可用");
  decide = async () => json({}); fireEvent.click(screen.getByRole("button", { name: "重试确认" }));
  await screen.findAllByText("已执行 · 待核验"); expect(decisions).toEqual([{ decision: "confirm" }, { decision: "confirm" }]);
});

it("I1普通成员无管理状态权限时仍可确认allowedTransitions允许的流转", async () => {
  reply = proposalReply(); reply.actions![0] = { ...reply.actions![0]!, toolName: "workitem.transition", parameters: { workItemId: "target", version: 3, toStateKey: "DONE" } };
  await show(); send("成员完成任务"); await completed();
  await screen.findByText("已完成");
  await waitFor(() => expect((screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "确认执行" })); await screen.findAllByText("已执行 · 待核验");
  expect(decisions).toEqual([{ decision: "confirm" }]); expect(managedStatesReads).toBe(0);
});
it("I2省略assigneeId的解除指派显示当前负责人到未指派且不改参数", async () => {
  reply = proposalReply(); reply.actions![0] = { ...reply.actions![0]!, toolName: "workitem.assign", parameters: { workItemId: "target", idempotencyKey: "server-key" } };
  await show(); send("解除任务指派"); await completed();
  await screen.findByText("陈华"); expect(screen.getByText("未指派")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认执行" })); await screen.findAllByText("已执行 · 待核验");
  expect(decisions).toEqual([{ decision: "confirm" }]);
  expect(records.get(calls[0]!.id)!.messages[0]!.reply!.actions![0]!.parameters).toEqual({ workItemId: "target", idempotencyKey: "server-key" });
});
it.each(["parentId", "milestoneId", "iterationId", "releaseId", "moduleId"])("I3更新%s解析新旧关联名称并保持参数原样", async field => {
  targetRelations[field] = `old-${field}`;
  reply = proposalReply(); reply.actions![0]!.parameters = { workItemId: "target", expectedVersion: 3, [field]: `new-${field}` };
  await show(); send("调整业务关联"); await completed();
  const oldName = field === "parentId" ? "DEV-10 · 原父项" : "原业务计划";
  const newName = field === "parentId" ? "DEV-20 · 新父项" : "新业务计划";
  await screen.findByText(oldName); await screen.findByText(newName);
  const changes = document.querySelector(".assistant-action-changes")!;
  expect(changes.textContent).not.toContain(`old-${field}`); expect(changes.textContent).not.toContain(`new-${field}`);
  expect(within(changes as HTMLElement).getAllByRole("button", { name: /查看|新业务计划|原业务计划|父项/ }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "确认执行" })); await screen.findAllByText("已执行 · 待核验");
  expect(decisions).toEqual([{ decision: "confirm" }]);
  expect(records.get(calls[0]!.id)!.messages[0]!.reply!.actions![0]!.parameters[field]).toBe(`new-${field}`);
});
it.each(["old-iterationId", "new-iterationId"])("I3%s失权时明确提示并阻止信息不完整的确认", async id => {
  targetRelations.iterationId = "old-iterationId"; deniedRelation = id;
  reply = proposalReply(); reply.actions![0]!.parameters = { workItemId: "target", expectedVersion: 3, iterationId: "new-iterationId" };
  await show(); send("调整迭代"); await completed();
  await screen.findByText("关联对象不可访问或读取失败，核对完成前无法确认。", { selector: "p" });
  const button = screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true); fireEvent.click(button); expect(decisions).toEqual([]);
  expect(document.querySelector(".assistant-action-changes")!.textContent).not.toContain(id);
});
it("I3创建建议解析计划名称、解除关联显示原名称到未设置", async () => {
  reply = proposalReply(); reply.actions![0] = { ...reply.actions![0]!, toolName: "workitem.create", targetId: null, expectedVersion: null, parameters: { projectId: A, type: "TASK", title: "待建任务", releaseId: "new-releaseId" } };
  const router = await show(); send("创建关联任务"); await completed(); await screen.findByText("新业务计划");
  expect(document.querySelector(".assistant-action-changes")!.textContent).not.toContain("new-releaseId");
  const one = seed("解除关联", A, "原问题"); const change = proposalReply(); change.actions![0]!.parameters = { workItemId: "target", expectedVersion: 3, releaseId: null }; records.get(one.id)!.messages[0]!.reply = change;
  targetRelations.releaseId = "old-releaseId";
  await act(async () => { await router.navigate({ to: "/assistant", search: { conversation: one.id } }); });
  await screen.findByText("原业务计划"); expect(screen.getByText("未设置")).toBeTruthy();
});

it.each([true,false])("已确认无出边流转按真实当前stateKey匹配原建议，不能借用后续状态（匹配=%s）", async matches => {
  noTransitions = true; targetVersion = 4;
  boardState = matches ? {stateKey:"DONE",name:"验收完成"} : {stateKey:"CLOSED",name:"之后归档"};
  const one = seed("历史流转", A, "完成任务");
  const saved = proposalReply(); saved.actions![0] = {...saved.actions![0]!,status:"confirmed",toolName:"workitem.transition",parameters:{workItemId:"target",toStateKey:"DONE"}};
  records.get(one.id)!.messages[0]!.reply = saved;
  await show(`/assistant?conversation=${one.id}`);
  if(matches) await screen.findByText("验收完成");
  else { await screen.findByText("当前状态名称暂不可用"); expect(screen.queryByText("之后归档")).toBeNull(); }
  expect(managedStatesReads).toBe(0);
});
it("纯抽屉入口是button而页面与里程碑保留真链接", async () => {
  const one=seed("资源入口",A,"查看业务");
  const saved=proposalReply(); saved.actions=[]; saved.evidence=[{id:"resources",projectId:A,toolName:"project.get",observedAt:stamp,summary:"资源",resources:[{kind:"workItem",id:"target"},{kind:"iteration",id:"i"},{kind:"release",id:"r"},{kind:"page",id:"p"},{kind:"milestone",id:"m"}]}];
  records.get(one.id)!.messages[0]!.reply=saved;
  await show(`/assistant?conversation=${one.id}`);
  await screen.findByText("资源");
  const evidence=document.querySelector(".assistant-evidence") as HTMLElement;
  expect(within(evidence).getAllByRole("button",{hidden:true})).toHaveLength(3);
  const links=within(evidence).getAllByRole("link",{hidden:true}) as HTMLAnchorElement[];
  expect(links.map(link=>link.getAttribute("href"))).toEqual([`/projects/${A}/wiki?page=p`,`/projects/${A}/milestones/m`]);
});

it("审批提交快照显示申请状态与当前状态，不声称已执行", async () => {
  const one = seed("审批中的建议", A, "申请完成");
  const saved: RagChatResult = proposalReply();
  saved.actions![0] = { ...saved.actions![0]!, status: "confirmed", toolName: "workitem.transition", parameters: { workItemId: "target", toStateKey: "DONE" }, result: { outcome: "approval_pending", approval: { status: "PENDING" }, observedAt: stamp, resources: [{ kind: "workItem", id: "target" }], value: { id: "target", projectId: A, key: "DEV-12", title: "原始标题", version: 3 } } };
  records.get(one.id)!.messages[0]!.reply = saved;
  await show(`/assistant?conversation=${one.id}`);
  await screen.findAllByText("审批已提交");
  await screen.findByText(/当前状态：待处理/);
  expect(screen.getByText("申请状态")).toBeTruthy(); expect(screen.queryByText("已执行")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
});

it("没有项目也能发送个人工作台问题", async () => {
  const fallback = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/rag/projects") ? Promise.resolve(json({ items: [] })) : fallback(input, init));
  await show();
  send("列出我的待办");
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.body.question).toBe("列出我的待办");
});

it("文件与凭据直传后仅在消息结构化字段传引用，移除后不再发送", async () => {
  const fallback = globalThis.fetch;
  const uploaded: { path: string; body: unknown }[] = [];
  const fileId = crypto.randomUUID(), credentialRef = crypto.randomUUID();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/rag/artifacts/files") {
      uploaded.push({ path, body: init?.body });
      return json({ artifactId: fileId, filename: "需求.csv", mimeType: "text/csv", sizeBytes: 18, allowedProjectIds: [A], expiresAt: "2099-11-16T12:30:00Z" }, 201);
    }
    if (path === "/api/v1/rag/artifacts/credentials") {
      uploaded.push({ path, body: JSON.parse(String(init?.body)) });
      return json({ credentialRef, allowedProjectIds: [A], expiresAt: "2099-11-16T12:30:00Z" }, 201);
    }
    if (path === `/api/v1/rag/artifacts/${fileId}` && init?.method === "DELETE") return json({ ok: true });
    return fallback(input, init);
  });
  await show();
  fireEvent.click(screen.getByRole("button", { name: "添加资料" }));
  fireEvent.click(screen.getByRole("button", { name: "目标项目" }));
  fireEvent.click(await screen.findByRole("option", { name: "研发项目 · DEV" }));
  fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [new File(["标题\n需求"], "需求.csv", { type: "text/csv" })] } });
  await screen.findByText("需求.csv");
  expect((uploaded[0]!.body as FormData).get("projectIds")).toBe(JSON.stringify([A]));
  fireEvent.click(screen.getByRole("button", { name: "配置凭据" }));
  fireEvent.change(screen.getByLabelText(/^服务地址/), { target: { value: "https://api.github.com" } });
  fireEvent.change(screen.getByLabelText(/^访问令牌/), { target: { value: "fixture-secret-direct-form" } });
  expect((screen.getByLabelText(/^访问令牌/) as HTMLInputElement).type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));
  await screen.findByText("GitHub 凭据");
  expect(screen.queryByDisplayValue("fixture-secret-direct-form")).toBeNull();
  send("请使用这些资料创建导入建议");
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.body).toMatchObject({ question: "请使用这些资料创建导入建议", artifactIds: [fileId], credentialRefs: [credentialRef] });
  expect(JSON.stringify(calls[0]!.body)).not.toContain("fixture-secret");
  await completed();
  fireEvent.click(screen.getByRole("button", { name: "移除需求.csv" }));
  await waitFor(() => expect(screen.queryByText("需求.csv")).toBeNull());
  send("继续处理凭据");
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.body).toMatchObject({ credentialRefs: [credentialRef] });
  expect(calls[1]!.body).not.toHaveProperty("artifactIds");
});

it("模糊失败后改变附带资料必须换请求ID", async () => {
  const one = seed("资料重试", A), artifactId = crypto.randomUUID(), fallback = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/rag/artifacts/files") return json({ artifactId, filename: "重试.csv", expiresAt: "2099-11-16T12:30:00Z" }, 201);
    if (path === `/api/v1/rag/artifacts/${artifactId}`) return json({ ok: true });
    return fallback(input, init);
  });
  chat = async conversation => { records.get(conversation.id)!.messages = []; throw new TypeError("Failed to fetch"); };
  await show(`/assistant?conversation=${one.id}`);
  fireEvent.click(screen.getByRole("button", { name: "添加资料" }));
  fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [new File(["标题"], "重试.csv", { type: "text/csv" })] } });
  await screen.findByText("重试.csv"); send("使用这份资料");
  await screen.findByRole("button", { name: "重试问题" });
  expect(calls[0]!.body.artifactIds).toEqual([artifactId]);
  fireEvent.click(screen.getByRole("button", { name: "移除重试.csv" }));
  await waitFor(() => expect(screen.queryByText("重试.csv")).toBeNull());
  chat = async (conversation, message) => finish(conversation, message);
  fireEvent.click(screen.getByRole("button", { name: "重试问题" })); await completed();
  expect(calls[1]!.body.requestId).not.toBe(calls[0]!.body.requestId);
  expect(calls[1]!.body).not.toHaveProperty("artifactIds");
});
