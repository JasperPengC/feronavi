// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/server/services/realtime-redis.ts", () => ({
  realtimeRedis: () => null,
}));
vi.mock("../src/server/services/events.service.ts", () => ({
  publish: vi.fn(async () => 1),
}));
import {
  markOnline,
  markOffline,
  listOnline,
  touchPresence,
  resetPresenceForTests,
} from "../src/server/services/presence.service.ts";
beforeEach(async () => {
  vi.useFakeTimers();
  await resetPresenceForTests();
});
afterEach(() => vi.useRealTimers());
it("过期快照后仍活跃两标签心跳可重建，旧标签关闭不会删除新标签", async () => {
  const actor = { memberId: "a", name: "Old", username: "a" } as never;
  await markOnline(actor);
  await markOnline(actor);
  vi.advanceTimersByTime(61000);
  expect(await listOnline()).toEqual([]);
  await touchPresence("a");
  expect(await listOnline()).toHaveLength(1);
  await markOffline("a");
  expect(await listOnline()).toHaveLength(1);
  await markOnline({ ...actor, name: "New" });
  await markOffline("a");
  expect(await listOnline()).toHaveLength(1);
  await markOffline("a");
  expect(await listOnline()).toEqual([]);
});
it("同成员已认证新连接同步当前可读姓名", async () => {
  await markOnline({ memberId: "a", name: "Old", username: "old" } as never);
  await markOnline({ memberId: "a", name: "New", username: "new" } as never);
  expect((await listOnline())[0]).toMatchObject({
    name: "New",
    username: "new",
  });
});
