// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../src/server/permission/actor.ts";
import { DomainError } from "../src/shared/errors.ts";
const state = vi.hoisted(() => ({ fetch: vi.fn(), usage: vi.fn(), actor: vi.fn(), page: vi.fn() }));
vi.mock("../src/db/index.ts", () => ({ db: {} }));
vi.mock("../src/server/lib/safe-fetch.ts", () => ({ safeOutboundFetch: state.fetch }));
vi.mock("../src/server/services/setting.service.ts", () => ({ getSettingRaw: async (key: string) => ({ "ai.chatBaseUrl": "https://model.example/v1", "ai.chatModel": "test-model" })[key] }));
vi.mock("../src/server/services/ai-config.service.ts", () => ({ addUsage: state.usage }));
vi.mock("../src/server/auth/actor-loader.ts", () => ({ loadActor: state.actor }));
vi.mock("../src/server/services/wiki.service.ts", () => ({ getPage: state.page }));
import { generateKnowledgeAnswer } from "../src/server/services/knowledge.service.ts";
const actor = { memberId: "member" } as Actor;
const hits = [{ chunkId: "chunk", pageId: "page", projectId: "project", title: "月结规则", snippet: "第六个工作日", headingPath: null, score: 1, mode: "keyword" as const }];
beforeEach(() => {
  vi.useFakeTimers(); state.fetch.mockReset(); state.usage.mockReset(); state.actor.mockReset(); state.page.mockReset();
  state.actor.mockResolvedValue(actor); state.page.mockResolvedValue({ projectId: "project",kind:"DOCUMENT",isArchived:false });
});
afterEach(() => vi.useRealTimers());
const success = () => new Response(JSON.stringify({ choices: [{ message: { content: "第六个工作日 [1]" } }], usage: { total_tokens: 32 } }));

it("首次超时后自动恢复，只记一份成功用量", async () => {
  state.fetch.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError")).mockImplementation(success);
  const pending = generateKnowledgeAnswer(actor, "截止日？", hits);
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: true, answer: "第六个工作日 [1]" });
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(state.usage).toHaveBeenCalledExactlyOnceWith("member", { tokens: 32, calls: 1 });
});
it("收到响应头后连接中断也自动重试", async () => {
  state.fetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }); } }).mockImplementation(success);
  const pending = generateKnowledgeAnswer(actor, "截止日？", hits); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: true }); expect(state.fetch).toHaveBeenCalledTimes(2);
});
it("连续暂时失败最多三次，保留最终原因", async () => {
  state.fetch.mockImplementation(() => new Response(null, { status: 503 }));
  const pending = generateKnowledgeAnswer(actor, "截止日？", hits); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: false, answer: null, note: expect.stringContaining("503") });
  expect(state.fetch).toHaveBeenCalledTimes(3); expect(state.usage).not.toHaveBeenCalled();
});
it.each([401, 403, 400])("认证或参数错误%s不自动重试", async status => {
  state.fetch.mockResolvedValue(new Response(null, { status }));
  expect(await generateKnowledgeAnswer(actor, "截止日？", hits)).toMatchObject({ ok: false });
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it.each([429, 502, 504])("临时HTTP%s能够自动恢复", async status => {
  state.fetch.mockResolvedValueOnce(new Response(null, { status })).mockImplementation(success);
  const pending = generateKnowledgeAnswer(actor, "截止日？", hits); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: true }); expect(state.fetch).toHaveBeenCalledTimes(2);
});
it("取消检查在后续尝试前执行，不继续调用供应商", async () => {
  state.fetch.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
  let active = true;
  const pending = generateKnowledgeAnswer(actor, "截止日？", hits, [], async () => {
    if (!active) throw new DomainError("CONFLICT", "已取消");
  });
  const observed = pending.catch(error => error);
  await vi.advanceTimersByTimeAsync(0); active = false; await vi.runAllTimersAsync();
  expect(await observed).toMatchObject({ code: "CONFLICT" }); expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("后续尝试重验来源权限，失权不再外发摘录", async () => {
  state.fetch.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
  state.page.mockResolvedValueOnce({projectId:"project",kind:"DOCUMENT",isArchived:false}).mockRejectedValue(new DomainError("FORBIDDEN", "无权读取"));
  const observed = generateKnowledgeAnswer(actor, "截止日？", hits).catch(error => error);
  await vi.runAllTimersAsync();
  expect(await observed).toMatchObject({ code: "FORBIDDEN" }); expect(state.fetch).toHaveBeenCalledTimes(1);
});
it.each([{kind:'FOLDER',isArchived:false},{kind:'DOCUMENT',isArchived:true}])('目录或归档资料不能在首次尝试发送给模型：%j',async page=>{
 state.page.mockResolvedValue({projectId:'project',...page});
 await expect(generateKnowledgeAnswer(actor,'截止日？',hits)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(state.fetch).not.toHaveBeenCalled();
});
