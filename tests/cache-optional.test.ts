// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), disconnect: vi.fn(), quit: vi.fn(), connect: vi.fn(async () => {}) }));
vi.mock("ioredis", () => ({ default: class {
  status = "reconnecting";
  constructor() { mocks.create(); }
  connect = mocks.connect;
  disconnect = mocks.disconnect;
  quit = mocks.quit;
} }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("REDIS_URL", ""); });
afterEach(() => vi.unstubAllEnvs());
it("未配置可选缓存时不创建默认localhost连接", async () => {
  const cache = await import("../src/server/auth/cache.ts");
  expect(() => cache.getRedisClient()).toThrow();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("关闭离线缓存直接断开，避免QUIT无限等待重连", async () => {
  vi.stubEnv("REDIS_URL", "redis://cache.invalid:6379");
  const cache = await import("../src/server/auth/cache.ts");
  cache.getRedisClient();
  await cache.closeCache();
  expect(mocks.quit).not.toHaveBeenCalled();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
