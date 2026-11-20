/**
 * 实时层共享 Valkey 客户端（Round 61 多副本）
 *
 * 与 `auth/cache.ts` 的分工：那里只在**配置了 REDIS_URL** 时启用（会话缓存可丢）；
 * 实时层同样**只在配置 REDIS_URL 时启用**：
 *   · 未配置 → 单进程内存模式（本仓开发默认；行为与 Round 60 之前一致）；
 *   · 配置了 → SSE 事件经 Pub/Sub 跨实例广播，presence 注册表跨实例共享。
 * 命令客户端与订阅客户端必须是**两条连接**（Redis 协议约束）；连接失败只记日志不阻断业务。
 */
import Redis from "ioredis";

type Client = InstanceType<typeof Redis>;
let commandClient: Client | null = null;
let initialized = false;
const subscribers = new Set<Client>();

export function realtimeRedis(): Client | null {
  if (!initialized) {
    initialized = true;
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        commandClient = new Redis(url, {
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          // ⚠️ 允许在**连接建立前**排队：presence 的首次 INCR/ZADD 恰好发生在新实例刚启动、
          //    ioredis 还在握手时；禁用离线队列会让首个连接写不进注册表（实测多副本 e2e 列表为空）。
          //    Redis 真不可用时 maxRetriesPerRequest=2 会快速拒绝，由调用方降级。
          enableOfflineQueue: true,
          connectTimeout: 5_000,
          retryStrategy: (times) => Math.min(times * 200, 3000),
        });
        commandClient.on("error", () => {
          /* 可丢，不刷日志 */
        });
      } catch {
        commandClient = null;
      }
    }
  }
  return commandClient;
}

/** 订阅专用连接（与命令连接分开）；未配置 REDIS_URL 返回 null */
export function realtimeSubscriber(): Client | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const sub = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
    sub.on("error", () => {
      /* 可丢，不刷日志 */
    });
    subscribers.add(sub);
    return sub;
  } catch {
    return null;
  }
}

/** 测试/关停用：断开连接（仅本进程创建的实例） */
export async function closeRealtimeRedis(): Promise<void> {
  for (const c of [commandClient, ...subscribers]) {
    if (c) {
      c.removeAllListeners("message");
      c.disconnect();
    }
  }
  subscribers.clear();
  commandClient = null;
  initialized = false;
}
