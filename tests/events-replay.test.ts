// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  get: vi.fn(),
  zrange: vi.fn(),
  zrangebyscore: vi.fn(),
}));
vi.mock("../src/server/services/realtime-redis.ts", () => ({
  realtimeRedis: () => fake,
  realtimeSubscriber: () => null,
}));
vi.mock("../src/server/services/event-access.service.ts", () => ({
  legacyEventScope: vi.fn(),
  canDeliverEvent: (memberId: string, event: { memberId: string | null }) => event.memberId === null || event.memberId === memberId,
}));
import { replaySince } from "../src/server/services/events.service.ts";
beforeEach(() => {
  vi.resetAllMocks();
  fake.get.mockResolvedValue("600");
  fake.zrange.mockResolvedValue([]);
});
it("跨他人事件的全局页仍返回向前nextCursor，不跳过第501条", async () => {
  fake.zrangebyscore.mockResolvedValue(
    Array.from({ length: 501 }, (_, i) =>
      JSON.stringify({
        id: i + 1,
        event: "notification.new",
        data: {},
        memberId: i === 500 ? "a" : "b",
      }),
    ),
  );
  const result = await replaySince(0, "a");
  expect(result.items).toEqual([]);
  expect(result.hasMore).toBe(true);
  expect(result.nextCursor).toBe(500);
});
it.each(["zrange", "zrangebyscore"])(
  "Redis %s失败封闭返回gone而不抛入原始流",
  async (name) => {
    fake.zrangebyscore.mockResolvedValue([]);
    fake[name as "zrange"].mockRejectedValue(Error("offline"));
    await expect(replaySince(0, "a")).resolves.toMatchObject({ gone: true });
  },
);
const record = (id: number) =>
  JSON.stringify({ id, event: "presence", data: {}, memberId: null });
it.each([false, true])(
  "cursor存在但集合丢失/读取oldest后窗口消失必须gone（race=%s）",
  async (race) => {
    fake.get.mockResolvedValue("42");
    fake.zrange.mockResolvedValue(race ? [record(39)] : []);
    fake.zrangebyscore.mockResolvedValue([]);
    expect((await replaySince(40, "a")).gone).toBe(true);
  },
);
it.each([
  ["0", 0],
  ["42", 42],
])("真正空缓存且since等于cursor可成功空页（%s）", async (cursor, since) => {
  fake.get.mockResolvedValue(cursor);
  fake.zrange.mockResolvedValue([]);
  fake.zrangebyscore.mockResolvedValue([]);
  expect(await replaySince(since, "a")).toMatchObject({
    gone: false,
    items: [],
    nextCursor: since,
  });
});
it.each([
  [41, 43],
  [42, 43],
  [41, 42],
])("全局页缺首条/中间/尾条保守gone（%j）", async (...ids) => {
  fake.get.mockResolvedValue("43");
  fake.zrange.mockResolvedValue([record(39)]);
  fake.zrangebyscore.mockResolvedValue(ids.map(record));
  expect((await replaySince(40, "a")).gone).toBe(true);
});
