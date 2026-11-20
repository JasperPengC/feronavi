import { afterEach, expect, it, vi } from "vitest";
import { streamAssistantMessage } from "../src/client/lib/assistant-stream.ts";
import { ApiError } from "../src/client/lib/api.ts";

afterEach(() => { vi.unstubAllGlobals(); document.cookie = "csrf_token=; max-age=0"; });
const frame = (type: string, data: object) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...data })}\r\n\r\n`;
const final = { conversation: { id: "conversation" }, message: { requestId: "request", status: "completed" } };
function response(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  // 按读取需求供给分块，避免预置数万个单字节对象拖慢流队列。
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + chunkSize));
    offset += chunkSize;
  } }), { headers: { "content-type": "text/event-stream" } });
}
it("逐字节UTF8与CRLF分块不破坏中文，reset按顺序交付且result之前可见delta", async () => {
  vi.stubGlobal("fetch", async () => response(": heartbeat\r\n\r\n" + frame("delta", { text: "旧答案" }) + frame("reset", {}) + frame("delta", { text: "新答案🙂" }) + frame("result", { result: final })));
  const events: string[] = [];
  await streamAssistantMessage("/stream", { requestId: "request", question: "问题" }, event => {
    events.push(event.type === "delta" ? event.text : event.type);
  });
  expect(events).toEqual(["旧答案", "reset", "新答案🙂", "result"]);
});
it("缺少result的断流与服务端error都不能当完成", async () => {
  vi.stubGlobal("fetch", async () => response(frame("delta", { text: "未完成" })));
  await expect(streamAssistantMessage("/stream", {}, () => {})).rejects.toThrow();
  vi.stubGlobal("fetch", async () => response(frame("error", { message: "请恢复请求" })));
  const events: string[] = [];
  await expect(streamAssistantMessage("/stream", {}, e => events.push(e.type))).rejects.toThrow("请恢复请求");
  expect(events).toEqual(["error"]);
});
it("事件名不符和超限帧拒绝交付", async () => {
  const onEvent = vi.fn();
  vi.stubGlobal("fetch", async () => response('event: delta\ndata: {"type":"reset"}\n\n'));
  await expect(streamAssistantMessage("/stream", {}, onEvent)).rejects.toThrow("Invalid assistant event");
  for (const chunkSize of [200_000, 1]) {
    vi.stubGlobal("fetch", async () => response(frame("delta", { text: "x".repeat(70_000) }), chunkSize));
    await expect(streamAssistantMessage("/stream", {}, onEvent)).rejects.toThrow("Assistant event limit exceeded");
  }
  expect(onEvent).not.toHaveBeenCalled();
});
it("恰好达到帧限额时，整块与逐字节CRLF分块都能交付", async () => {
  const text = "x".repeat(65_536 - (frame("delta", { text: "" }).length - 4));
  const delta = frame("delta", { text });
  expect(delta.length - 4).toBe(65_536);
  for (const chunkSize of [200_000, 1]) {
    vi.stubGlobal("fetch", async () => response(delta + frame("result", { result: final }), chunkSize));
    const events: string[] = [];
    await streamAssistantMessage("/stream", {}, event => events.push(event.type));
    expect(events).toEqual(["delta", "result"]);
  }
});
it("result后的尾部数据不因落在同一分块而推翻已完成的结果", async () => {
  const stream = frame("result", { result: final }) + "x".repeat(65_537);
  for (const chunkSize of [200_000, 1]) {
    vi.stubGlobal("fetch", async () => response(stream, chunkSize));
    const events: string[] = [];
    await streamAssistantMessage("/stream", {}, event => events.push(event.type));
    expect(events).toEqual(["result"]);
  }
});
it("流式写请求复用CSRF恢复、同源凭据和ApiError", async () => {
  document.cookie = "csrf_token=old";
  const seen: { path: string; token: string | null; credentials?: RequestCredentials }[] = [];
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    seen.push({ path: url.pathname, token: new Headers(init.headers).get("x-csrf-token"), credentials: init.credentials });
    if (url.pathname === "/api/v1/auth/csrf") return Response.json({ csrfToken: "fresh" });
    if (seen.length === 1) return Response.json({ code: "FORBIDDEN", message: "CSRF expired" }, { status: 403 });
    return response(frame("result", { result: final }));
  });
  await streamAssistantMessage("/stream", {}, () => {});
  expect(seen).toEqual([{ path: "/stream", token: "old", credentials: "same-origin" }, { path: "/api/v1/auth/csrf", token: null, credentials: "same-origin" }, { path: "/stream", token: "fresh", credentials: "same-origin" }]);
  vi.stubGlobal("fetch", async () => Response.json({ code: "NOT_FOUND", message: "不可访问", details: null }, { status: 404 }));
  await expect(streamAssistantMessage("/stream", {}, () => {})).rejects.toBeInstanceOf(ApiError);
});
