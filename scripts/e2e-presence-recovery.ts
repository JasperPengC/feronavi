/** 真实独立 Valkey 上验证心跳与过期扫描竞争，不启动应用或连接共享缓存。 */
import "./_env.ts";
import assert from "node:assert/strict";
import { startIsolatedRedis } from "../tests/support/isolated-special.ts";
import type { Actor } from "../src/server/permission/actor.ts";

const cache = await startIsolatedRedis(process.env.FERONAVI_TEST_DIRECTORY!);
process.env.REDIS_URL = cache.url;
const presence = await import("../src/server/services/presence.service.ts");
const { realtimeRedis, closeRealtimeRedis } = await import("../src/server/services/realtime-redis.ts");
const redis = realtimeRedis()!;
const actor = { memberId: "presence-recovery-member", name: "恢复成员", username: "presence-recovery" } as Actor;
const originalRange = redis.zrangebyscore.bind(redis);
let touchedBetweenReadAndDelete = false;
try {
  await presence.markOnline(actor);
  await redis.zadd("presence:online", Date.now() - 61_000, actor.memberId);
  // 历史实现会先读取待删除成员，再删除元数据；在这个真实读结果边界强制插入心跳。
  // Lua 原子扫描没有该边界，只允许扫描完成后心跳重新登记。
  redis.zrangebyscore = (async (...args: Parameters<typeof originalRange>) => {
    const result = await originalRange(...args);
    if (args[0] === "presence:online" && args[1] === "-inf" && !touchedBetweenReadAndDelete) {
      touchedBetweenReadAndDelete = true;
      await presence.touchPresence(actor.memberId);
    }
    return result;
  }) as typeof redis.zrangebyscore;
  await presence.sweepStale();
  if (!touchedBetweenReadAndDelete) await presence.touchPresence(actor.memberId);
  const restored = (await presence.listOnline()).find(row => row.memberId === actor.memberId);
  assert.equal(restored?.username, actor.username, "扫描不能删除已刷新成员的元数据");
  assert.equal(restored?.name, actor.name);
  console.log("OK 过期扫描与心跳边界不丢成员名称/连接登记");
  redis.zrangebyscore = originalRange;
  for (let i = 0; i < 40; i++) {
    await redis.zadd("presence:online", Date.now() - 61_000, actor.memberId);
    await Promise.all([presence.sweepStale(), presence.touchPresence(actor.memberId)]);
    const online = await presence.listOnline();
    assert.equal(online[0]?.username, actor.username);
    assert.equal(online[0]?.name, actor.name);
  }
  console.log("OK 40轮真实缓存扫描/心跳并发保持完整在线成员");
  await presence.markOffline(actor.memberId);
  assert.equal((await presence.listOnline()).length, 0);
  console.log("OK 最后连接断开后完整移除在线登记");
} finally {
  redis.zrangebyscore = originalRange;
  await closeRealtimeRedis(); await cache.stop();
}
