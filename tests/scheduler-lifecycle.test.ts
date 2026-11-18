// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ calls: 0, release: () => {} }));
vi.mock("../src/server/services/webhook.service.ts", () => ({ retryDue: async () => { fake.calls++; await new Promise<void>((resolve) => { fake.release = resolve; }); return []; } }));
import { startWebhookRetryScheduler } from "../src/server/services/webhook-retry.ts";
afterEach(() => { fake.release(); fake.calls = 0; });
it("手动触发和定时触发共用重入保护，停机等待当前任务", async () => {
  const worker = startWebhookRetryScheduler({ intervalMs: 60_000 });
  const first = worker.runOnce();
  const second = worker.runOnce();
  expect(fake.calls).toBe(1);
  let stopped = false;
  const closing = Promise.resolve(worker.stop()).then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  fake.release();
  await Promise.all([first, second, closing]);
  expect(stopped).toBe(true);
  await worker.runOnce();
  expect(fake.calls).toBe(1);
});
