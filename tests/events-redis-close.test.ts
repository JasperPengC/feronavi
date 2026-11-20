// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  clients: [] as {
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("ioredis", () => ({
  default: class {
    disconnect = vi.fn();
    removeAllListeners = vi.fn();
    on = vi.fn();
    constructor() {
      state.clients.push(this);
    }
  },
}));
import {
  realtimeRedis,
  realtimeSubscriber,
  closeRealtimeRedis,
} from "../src/server/services/realtime-redis.ts";
afterEach(() => vi.unstubAllEnvs());
it("关闭全部command/subscriber，不等待断网quit，关闭后可重新创建", async () => {
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
  const command = realtimeRedis();
  const sub = realtimeSubscriber();
  expect(command).not.toBe(sub);
  await closeRealtimeRedis();
  expect(state.clients).toHaveLength(2);
  for (const client of state.clients) {
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.removeAllListeners).toHaveBeenCalledWith("message");
  }
  expect(realtimeRedis()).not.toBe(command);
  await closeRealtimeRedis();
});
