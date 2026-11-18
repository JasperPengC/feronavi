/**
 * 会话热缓存（Valkey）
 *
 * ⚠️ **硬纪律：本模块的任何失败都不得影响可用性。**
 * 缓存的作用只有一个 —— 省掉每请求一次查库。它挂了，鉴权回落 PG 即可，
 * 只是慢一点。因此这里**吞掉所有异常**，绝不让缓存故障变成登录不可用。
 *
 * 与队列的区别（第 4.4 节）：队列的真相在 PG 表，Valkey 只发信号；
 * 会话的真相也在 PG，Valkey 只做热缓存。两处的 Valkey 都是**可丢**的。
 */
import Redis from "ioredis";
import type { SessionRow } from "./session.ts";

const PREFIX = "feronavi:session:";
const TTL_SECONDS = 10 * 60;   // 缓存 10 分钟；会话本身的有效期由 PG 判定

let client: Redis | null = null;
let disabled = false;

function getClient(): Redis | null {
  if (disabled) return null;
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) { disabled = true; return null; }
  try {
    client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,     // 缓存不可用时立刻失败，不要排队拖慢请求
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
    // 连接错误只记录，不影响可用性
    client.on("error", () => {});
    return client;
  } catch {
    disabled = true;
    return null;
  }
}

export async function cacheGet(token: string): Promise<SessionRow | null> {
  try {
    const c = getClient();
    if (!c) return null;
    const raw = await c.get(PREFIX + token);
    if (!raw) return null;
    const v = JSON.parse(raw) as { memberId: string; expiresAt: string };
    return { id: "", memberId: v.memberId, expiresAt: new Date(v.expiresAt) };
  } catch {
    return null;   // 缓存未命中/不可用 → 调用方回落 PG
  }
}

export async function cacheSet(token: string, s: { memberId: string; expiresAt: Date }): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    await c.set(PREFIX + token, JSON.stringify({ memberId: s.memberId, expiresAt: s.expiresAt }), "EX", TTL_SECONDS);
  } catch {
    /* 缓存是尽力而为 */
  }
}

export async function cacheDel(token: string): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    await c.del(PREFIX + token);
  } catch {
    /* 同上 */
  }
}

/**
 * 清空全部会话缓存（`logout-all` 用）。
 * 用 SCAN 而不是 KEYS —— KEYS 会阻塞整个实例，生产环境禁用。
 */
export async function cacheClearAll(): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", PREFIX + "*", "COUNT", 200);
      cursor = next;
      if (keys.length) await c.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* 缓存是尽力而为 */
  }
}

/** 健康检查用：缓存是否可用（不可用不算致命，见第 4.4 节） */
export async function cacheHealthy(): Promise<boolean> {
  try {
    const c = getClient();
    if (!c) return false;
    return (await c.ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function closeCache(): Promise<void> {
  try { await client?.quit(); } catch { /* 忽略 */ }
  client = null;
}

/** 事件总线等其它子系统复用同一客户端（连接复用，避免每个模块各开一个连接池） */
export function getRedisClient(): import("ioredis").default {
  if (!client) client = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 2,           // 与会话缓存同纪律：Valkey 可丢，快速失败回源
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  client.connect().catch(() => {});    // 已连接时是 no-op；失败由调用方按"可丢"处理
  return client;
}
