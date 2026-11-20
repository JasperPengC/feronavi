// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ rows: [] as unknown[], visible: new Set<string>(), redis: {
  get: vi.fn(async () => "2"), zrange: vi.fn(async () => [] as string[]), zrangebyscore: vi.fn(async () => [] as string[]),
} }));
vi.mock("../src/server/services/realtime-redis.ts", () => ({ realtimeRedis: () => fake.redis, realtimeSubscriber: () => null }));
vi.mock("../src/server/services/event-access.service.ts", () => ({
  legacyEventScope: vi.fn(),
  canDeliverEvent: vi.fn(async (_member: string, event: { data: { resourceId: string } }) => fake.visible.has(event.data.resourceId)),
}));
import { replaySince } from "../src/server/services/events.service.ts";

beforeEach(() => {
  fake.visible = new Set(["visible"]);
  fake.redis.zrangebyscore.mockResolvedValue(["visible", "restricted"].map((resourceId, index) => JSON.stringify({
    id: index + 1, event: "resource.invalidated", memberId: null,
    data: { domain: "wiki", projectId: "p1", resourceType: "PAGE", resourceId },
    scope: { projectId: "p1", resourceType: "PAGE", resourceId },
  })));
});

describe("断线重放权限", () => {
  it("补取只返回当前可见事件且剥离内部scope", async () => {
    const result = await replaySince(0, "reader");
    expect(result.items.map(e => e.data.resourceId)).toEqual(["visible"]);
    expect(result.items[0]).not.toHaveProperty("scope");
    expect(result.items[0]).not.toHaveProperty("memberId");
  });
  it("权限撤销后同一个游标不再返回旧的受限事件", async () => {
    expect((await replaySince(0, "reader")).items).toHaveLength(1);
    fake.visible.clear();
    expect((await replaySince(0, "reader")).items).toEqual([]);
  });
});
