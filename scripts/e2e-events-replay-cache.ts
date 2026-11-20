/** 一次性库/独立Valkey：真实HTTP补取跨成员游标与缓存故障，不连接原预览。 */
import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startIsolatedRedis } from "../tests/support/isolated-special.ts";
import { sql } from "../src/db/index.ts";
import { ensureInitialized } from "./_test-helpers.ts";
assert.match(
  process.env.FERONAVI_TEST_DATABASE ?? "",
  /^feronavi_test_[a-f0-9]{32}$/,
);
const cache = await startIsolatedRedis(process.env.FERONAVI_TEST_DIRECTORY!);
process.env.REDIS_URL = cache.url;
const { buildApp } = await import("../src/server/app.ts");
const { realtimeRedis, closeRealtimeRedis } =
  await import("../src/server/services/realtime-redis.ts");
const { closeCache } = await import("../src/server/auth/cache.ts");
const { createSession } = await import("../src/server/auth/session.ts");
const app = await buildApp({ logger: false });
const recoveryController = new AbortController();
let recoveryReading: Promise<void> | undefined;
try {
  await ensureInitialized();
  const [row] =
    await sql`insert into member(username,name,status,password_hash) values(${`replay-${randomUUID()}`},'补取隔离验收','ACTIVE','not-a-login-password') returning id`;
  const session = await createSession({ memberId: row!.id as string });
  const redis = realtimeRedis()!;
  // 合成事件只写本次独立缓存；测试空成员页必须推进到第502条本人成员事件。
  const other = randomUUID(),
    batch = redis.pipeline();
  for (let id = 1; id <= 502; id++) {
    batch.zadd(
      "feronavi:events",
      id,
      JSON.stringify({
        id,
        event: "notification.new",
        data: { id: `fixture-${id}`, unreadCount: 1 },
        memberId: id === 502 ? row!.id : other,
      }),
    );
  }
  batch.set("feronavi:events:cursor", "502");
  const results = await batch.exec();
  assert.ok(results?.every(([error]) => !error));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const replay = (since: number) =>
    fetch(`${base}/api/v1/events/replay?since=${since}`, {
      method: "POST",
      headers: { cookie: `feronavi_session=${session.token}` },
      signal: AbortSignal.timeout(15_000),
    });
  const first = await replay(0);
  assert.equal(first.status, 200);
  const page = (await first.json()) as {
    items: unknown[];
    hasMore: boolean;
    nextCursor: number;
  };
  assert.deepEqual(page, { items: [], hasMore: true, nextCursor: 500 });
  console.log("PASS 真实Valkey跨成员500条空页提供nextCursor=500");
  const second = await replay(page.nextCursor);
  assert.equal(second.status, 200);
  const next = (await second.json()) as {
    items: { id: number }[];
    hasMore: boolean;
    nextCursor: number;
  };
  assert.deepEqual(
    next.items.map((i) => i.id),
    [502],
  );
  assert.equal(next.hasMore, false);
  assert.equal(next.nextCursor, 502);
  console.log("PASS 真实HTTP继续补取只返回第502条本人事件，未漏失或泄露");
  const originalRange = redis.zrange.bind(redis);
  redis.zrange = (async (...args: Parameters<typeof originalRange>) => {
    const found = await originalRange(...args);
    if (args[0] === "feronavi:events") await redis.del("feronavi:events");
    return found;
  }) as typeof redis.zrange;
  try {
    const disappearing = await replay(500);
    assert.equal(disappearing.status, 410);
    console.log("PASS 真实缓存读取边界窗口消失后410，不成功跳过事件");
  } finally {
    redis.zrange = originalRange;
  }
  const evicted = await replay(500);
  assert.equal(evicted.status, 410);
  console.log("PASS 游标仍在但事件集合已丢失时410要求全量恢复");
  await cache.suspend();
  const outage = await replay(500);
  assert.equal(outage.status, 410);
  const unavailable = (await outage.json()) as { nextCursor?: number };
  assert.equal(unavailable.nextCursor, undefined);
  console.log("PASS 真实缓存中断补取410，不能成功推进游标");
  // 此前只调用补取，没有创建任何Pub/Sub订阅；首次SSE建连时缓存真实不可用。
  const stream = await fetch(`${base}/api/v1/events`, {
    headers: { cookie: `feronavi_session=${session.token}` },
    signal: recoveryController.signal,
  });
  assert.equal(stream.status, 200);
  let recoveryText = "";
  recoveryReading = (async () => {
    const reader = stream.body!.getReader(),
      decoder = new TextDecoder();
    try {
      for (;;) {
        const frame = await reader.read();
        if (frame.done) break;
        recoveryText += decoder.decode(frame.value, { stream: true });
      }
    } catch (error) {
      if (!recoveryController.signal.aborted) throw error;
    }
  })();
  void recoveryReading.catch(() => {});
  await delay(500);
  assert.ok(recoveryText.includes(":ok"));
  assert.ok(!recoveryText.includes("event: dropped"));
  await cache.resume();
  const recoveryDeadline = Date.now() + 10_000;
  while (
    !recoveryText.includes("event: dropped") &&
    Date.now() < recoveryDeadline
  )
    await delay(25);
  assert.ok(
    recoveryText.includes("event: dropped"),
    "首次订阅故障恢复必须通知现存浏览器刷新",
  );
  console.log("PASS 首次Pub/Sub订阅时缓存不可用，恢复后现存SSE收到dropped");
  const lost = await replay(502);
  assert.equal(lost.status, 410);
  console.log("PASS 缓存重启丢失旧窗口后410明确要求全量恢复");
} finally {
  recoveryController.abort();
  await recoveryReading;
  await app.close();
  await closeCache();
  await closeRealtimeRedis();
  await sql.end();
  await cache.stop();
}
