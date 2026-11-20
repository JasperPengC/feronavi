// @vitest-environment node
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  sub: undefined as unknown as EventEmitter & {
    subscribe: ReturnType<typeof vi.fn>;
  },
}));
vi.mock("../src/server/services/realtime-redis.ts", () => ({
  realtimeRedis: () => null,
  realtimeSubscriber: () => state.sub,
}));
vi.mock("../src/server/services/event-access.service.ts", () => ({ legacyEventScope: vi.fn(), canDeliverEvent: vi.fn() }));
import {
  subscribe,
  subscribeRecovery,
} from "../src/server/services/events.service.ts";
it("初次订阅不误报，subscriber断线后成功重新订阅向本机发一次恢复，取消订阅无残留", async () => {
  state.sub = Object.assign(new EventEmitter(), {
    subscribe: vi.fn(async () => {}),
  });
  const recovery = vi.fn();
  const removeRecovery = subscribeRecovery(recovery);
  const remove = subscribe(() => {});
  state.sub.emit("ready");
  await Promise.resolve();
  await Promise.resolve();
  expect(recovery).not.toHaveBeenCalled();
  state.sub.emit("close");
  state.sub.emit("ready");
  await Promise.resolve();
  await Promise.resolve();
  expect(recovery).toHaveBeenCalledTimes(1);
  state.sub.emit("ready");
  await Promise.resolve();
  await Promise.resolve();
  expect(recovery).toHaveBeenCalledTimes(1);
  removeRecovery();
  remove();
  state.sub.emit("close");
  state.sub.emit("ready");
  await Promise.resolve();
  await Promise.resolve();
  expect(recovery).toHaveBeenCalledTimes(1);
});
it.each(["close", "reject"])(
  "首次订阅成功之前%s也必须在恢复成功时发一次恢复",
  async (mode) => {
    // Complete the prior subscriber lifecycle so the real module starts a fresh subscriber.
    state.sub.emit("end");
    state.sub = Object.assign(new EventEmitter(), {
      subscribe: vi.fn(async () => {}),
    });
    const recover = vi.fn();
    const off = subscribeRecovery(recover);
    const remove = subscribe(() => {});
    if (mode === "close") state.sub.emit("close");
    else {
      state.sub.subscribe.mockRejectedValueOnce(
        Error("first subscription failed"),
      );
      state.sub.emit("ready");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(recover).not.toHaveBeenCalled();
    state.sub.emit("ready");
    await Promise.resolve();
    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
    state.sub.emit("ready");
    await Promise.resolve();
    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
    off();
    remove();
  },
);
