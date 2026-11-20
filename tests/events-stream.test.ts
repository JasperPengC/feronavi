// @vitest-environment node
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { Writable } from "node:stream";
import Fastify, { type FastifyReply, type FastifyRequest, type RouteHandlerMethod } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/server/permission/actor.ts";
import type { SseEvent } from "../src/server/services/events.service.ts";

const fake = vi.hoisted(() => ({
  subscribers: new Set<(event: SseEvent) => void>(),
  connected: vi.fn(async () => {}),
  disconnected: vi.fn(async () => {}),
  touch: vi.fn(async () => {}),
  replay: vi.fn(),
}));
vi.mock("../src/server/services/events.service.ts", () => ({
  BACKLOG_LIMIT: 100,
  subscribe: (listener: (event: SseEvent) => void) => {
    fake.subscribers.add(listener);
    return () => fake.subscribers.delete(listener);
  },
  replaySince: fake.replay,
  subscribeRecovery: () => () => {},
  canDeliverEvent: (memberId: string, e: SseEvent) => e.memberId === null || e.memberId === memberId,
}));
vi.mock("../src/server/services/presence.service.ts", () => ({
  presenceConnected: fake.connected,
  presenceDisconnected: fake.disconnected,
  touchPresence: fake.touch,
  listOnline: vi.fn(),
}));
vi.mock("../src/server/services/events-access.ts", () => ({
  currentEventIdentity: async (credential: { memberId: string }) => ({ actor: { memberId: credential.memberId } }),
  eventReadable: async (identity: { actor: { memberId: string } }, event: SseEvent) => event.memberId === null || event.memberId === identity.actor.memberId,
}));
vi.mock("../src/server/services/realtime-redis.ts", () => ({ closeRealtimeRedis: async () => {} }));
import { registerEventRoutes } from "../src/server/routes/events.ts";

/** 真正的 Writable 缓冲和 drain；只控制底层写入何时完成。 */
class Consumer extends Writable {
  chunks: string[] = [];
  paused = false;
  pending?: (error?: Error | null) => void;

  constructor() { super({ highWaterMark: 128 }); }
  writeHead() { return this; }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString());
    if (this.paused) this.pending = callback;
    else callback();
  }
  resumeConsumer() {
    this.paused = false;
    const callback = this.pending;
    this.pending = undefined;
    callback?.();
  }
  events() {
    return this.chunks.join("").split("\n\n").flatMap((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      return event ? [{ event, id: Number(/^id: (.+)$/m.exec(block)?.[1]), data: JSON.parse(/^data: (.+)$/m.exec(block)![1]!) }] : [];
    });
  }
}

const actor: Actor = {
  memberId: "alice", username: "alice", name: "Alice", permissions: new Set(), grants: [],
  mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null,
};
const event = (id: number, memberId: string | null = null): SseEvent => ({
  id, event: "notification.new", data: { id: `notice-${id}`, body: "x".repeat(150) }, memberId,
});
const publish = (payload: SseEvent) => { for (const listener of fake.subscribers) listener(payload); };
const connections: { raw: Consumer; request: EventEmitter; done: Promise<unknown> }[] = [];
let app: ReturnType<typeof Fastify>;
let handler: RouteHandlerMethod;

async function connect(memberId = "alice", headers: Record<string, string> = {}) {
  const raw = new Consumer();
  raw.on("error", () => {});
  const request = new EventEmitter();
  const done = Promise.resolve(handler.call(app,
    { actor: { ...actor, memberId }, raw: request, headers, sessionToken: "test-session" } as unknown as FastifyRequest,
    { raw } as unknown as FastifyReply));
  connections.push({ raw, request, done });
  await setImmediate();
  return { raw, request, done };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.clearAllMocks();
  app = Fastify();
  app.addHook("onRoute", (route) => { if (route.method === "GET" && route.url === "/api/v1/events") handler = route.handler; });
  await registerEventRoutes(app);
});
afterEach(async () => {
  for (const connection of connections) {
    connection.request.emit("aborted");
    connection.request.emit("close");
    connection.raw.destroy();
    connection.raw.resumeConsumer();
  }
  await Promise.all(connections.map((connection) => connection.done));
  connections.length = 0;
  fake.subscribers.clear();
  vi.useRealTimers();
  await app.close();
});

describe("SSE 流隔离、背压与关闭", () => {
  it("补取历史期间到达的实时帧必须排在历史之后", async () => {
    let finishReplay!: (value: unknown) => void;
    fake.replay.mockReturnValue(new Promise(resolve => { finishReplay = resolve; }));
    const { raw } = await connect("alice", { "last-event-id": "10" });
    publish(event(12, "alice"));
    expect(raw.events()).toEqual([]);
    finishReplay({ items: [{ id: 11, event: "notification.new", data: { unreadCount: 1 } }], hasMore: false, gone: false });
    await setImmediate();
    expect(raw.events().map(item => item.id)).toEqual([11, 12]);
  });
  it("只发送当前成员的定向事件和广播，其他成员事件不占积压额度", async () => {
    const alice = await connect();
    const bob = await connect("bob");
    for (let id = 1; id <= 150; id++) { publish(event(id, "bob")); await setImmediate(); }
    publish(event(151, "alice"));
    publish(event(152));
    await setImmediate();
    expect(alice.raw.events().map((item) => item.id)).toEqual([151, 152]);
    expect(bob.raw.events().map((item) => item.id)).toEqual([...Array.from({ length: 150 }, (_, i) => i + 1), 152]);
    expect(alice.raw.writableEnded).toBe(false);
    expect(bob.raw.writableEnded).toBe(false);
  });

  it("快速消费者连续收到超过 100 条事件后仍保持连接", async () => {
    const { raw } = await connect();
    for (let id = 1; id <= 350; id++) { publish(event(id)); await setImmediate(); }
    expect(raw.events().map((item) => item.id)).toEqual(Array.from({ length: 350 }, (_, i) => i + 1));
    expect(raw.writableEnded).toBe(false);
  });

  it("发生背压后等待 drain，恢复时顺序送达且不会重复首条已缓冲事件", async () => {
    const { raw } = await connect();
    raw.paused = true;
    publish(event(1));
    await setImmediate();
    for (let id = 2; id <= 25; id++) publish(event(id));
    expect(raw.writableLength).toBeLessThan(500);
    expect(raw.events().map((item) => item.id)).toEqual([1]);
    raw.resumeConsumer();
    await setImmediate();
    expect(raw.events().map((item) => item.id)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    raw.paused = true;
    publish(event(26));
    await setImmediate();
    for (let id = 27; id <= 126; id++) publish(event(id));
    expect(raw.writableEnded).toBe(false);
    raw.resumeConsumer();
    await setImmediate();
    expect(raw.events().map((item) => item.id)).toEqual(Array.from({ length: 126 }, (_, i) => i + 1));
  });

  it("只有待发队列超过 100 才 dropped，关闭时清理订阅并完成 handler", async () => {
    const { raw, done } = await connect();
    raw.paused = true;
    publish(event(1));
    await setImmediate();
    for (let id = 2; id <= 101; id++) publish(event(id));
    expect(raw.writableEnded).toBe(false);
    publish(event(102));
    expect(raw.writableEnded).toBe(true);
    expect(fake.subscribers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    raw.resumeConsumer();
    await done;
    expect(raw.events().map((item) => [item.event, item.id])).toEqual([["notification.new", 1], ["dropped", Number.NaN]]);
    expect(raw.chunks.join("")).toContain("event: dropped\ndata: {}\nid:\n\n");
    expect(fake.disconnected).toHaveBeenCalledExactlyOnceWith("alice");
  });

  it("背压时心跳不继续写入缓冲，恢复后正常发送心跳", async () => {
    const { raw } = await connect();
    raw.paused = true;
    publish(event(1));
    await setImmediate();
    const buffered = raw.writableLength;
    for (let tick = 0; tick < 3; tick++) { vi.advanceTimersByTime(25_000); await setImmediate(); }
    expect(raw.writableLength).toBe(buffered);
    expect(fake.touch).toHaveBeenCalledTimes(3);
    raw.resumeConsumer();
    await setImmediate();
    vi.advanceTimersByTime(25_000);
    await setImmediate();
    expect(raw.chunks.at(-1)).toBe(":ping\n\n");
  });

  it.each(["close", "aborted", "error"])("%s 关闭后解除订阅、移除监听并完成 handler", async (reason) => {
    const { raw, request, done } = await connect();
    const completed = vi.fn();
    void done.then(completed);
    if (reason === "aborted") request.emit("aborted");
    else if (reason === "error") raw.destroy(new Error("consumer disconnected"));
    else raw.destroy();
    await setImmediate();
    expect(completed).toHaveBeenCalledOnce();
    expect(fake.subscribers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(raw.listenerCount("drain")).toBe(0);
    expect(raw.listenerCount("close")).toBe(0);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(fake.disconnected).toHaveBeenCalledExactlyOnceWith("alice");
    const output = raw.chunks.join("");
    publish(event(999));
    expect(raw.chunks.join("")).toBe(output);
  });
});
