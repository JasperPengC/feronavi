import { deferAfterCommit } from "../../db/context.ts";
/**
 * SSE 事件总线（W5，REST 7c + 重放边界）
 *
 * 设计（全部按规范）：
 *   - cursor：Valkey INCR 单调数字，**不是时间戳**（同毫秒并发会乱）
 *   - 事件存 Valkey 有序集合（score=cursor），**24h 保留**、可丢（Valkey 非真相源）
 *   - 补取：单次 ≤500，超出 hasMore=true；窗口外 410
 *   - 进程内订阅：单节点部署（第 8.1 容量档）用 EventEmitter 即达；
 *     多副本时此处换 Valkey Pub/Sub，接口不变（预留）
 *   - 积压 >100 → 发 `dropped` 事件后主动断开，客户端全量刷新
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { realtimeRedis, realtimeSubscriber } from "./realtime-redis.ts";

export interface SseEvent {
  id: number;                       // cursor
  event: string;                    // notification.new / workitem.changed / ...
  data: Record<string, unknown>;
  /** 只推给该成员；null = 广播（本期全部定向，字段预留） */
  memberId: string | null;
}

const STREAM_KEY = "feronavi:events";
const CURSOR_KEY = "feronavi:events:cursor";
/** 实例标识：跨实例 Pub/Sub 时忽略自己发出的消息（本地已直接 emit 过，避免重复投递） */
const INSTANCE_ID = randomUUID();
const FANOUT_CHANNEL = "feronavi:events:fanout";
let fanoutStarted = false;
const RETENTION_MS = 24 * 60 * 60 * 1000;      // 24 小时
const REPLAY_LIMIT = 500;
const BACKLOG_LIMIT = 100;

/** 进程内事件分发（单节点） */
const bus = new EventEmitter();
bus.setMaxListeners(0);

/**
 * 发布：写 Valkey（可丢）+ 进程内分发。
 *
 * ⚠️ **Valkey 不可用时必须仍然投递进程内事件**（Round 48 浏览器验收真实踩到）：
 * 本机开发/未部署 Valkey 的实例里 `redis.incr` 直接 ECONNREFUSED —— 旧实现让它 reject，
 * `bus.emit` 永不执行 → **所有 SSE 实时事件静默失效**（通知/在线状态都像坏了一样）。
 * 规范对 Valkey 的定位是"可丢的信号"，因此这里降级为**内存 cursor**：实时照常，补取不可用。
 */
let fallbackCursor = 0;
export async function publish(event: string, data: Record<string, unknown>, memberId: string | null): Promise<number> {
  if (deferAfterCommit(() => publishNow(event, data, memberId))) return 0;
  return publishNow(event, data, memberId);
}
async function publishNow(event: string, data: Record<string, unknown>, memberId: string | null): Promise<number> {
  const redis = realtimeRedis();
  let id: number;
  let persisted = false;
  if (redis) {
    try {
      id = await redis.incr(CURSOR_KEY);
      const payload: SseEvent = { id, event, data, memberId };
      await redis.zadd(STREAM_KEY, String(id), JSON.stringify(payload));
      // 保留最近 N 万条（窗游标可丢，规范允许）
      await redis.zremrangebyrank(STREAM_KEY, 0, -50000);
      persisted = true;
    } catch {
      fallbackCursor += 1;
      id = Date.now() * 1000 + (fallbackCursor % 1000);
    }
  } else {
    fallbackCursor += 1;
    id = Date.now() * 1000 + (fallbackCursor % 1000);
  }
  const payload: SseEvent = { id, event, data, memberId };
  // 本实例订阅者直接投递（快路径）；其它副本由 Pub/Sub 接力
  bus.emit("event", payload);
  if (persisted) {
    void redis!.publish(FANOUT_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, payload })).catch(() => {});
  }
  return id;
}

/** 启动跨实例订阅（懒加载；未配置 REDIS_URL 或连接失败时保持单进程模式） */
function ensureFanoutSubscriber(): void {
  if (fanoutStarted) return;
  fanoutStarted = true;
  const sub = realtimeSubscriber();
  if (!sub) return;
  sub.on("message", (channel: string, message: string) => {
    if (channel !== FANOUT_CHANNEL) return;
    try {
      const parsed = JSON.parse(message) as { origin: string; payload: SseEvent };
      if (parsed.origin === INSTANCE_ID) return;   // 自己发的：本地已 emit
      bus.emit("event", parsed.payload);
    } catch { /* 坏消息不影响本实例 */ }
  });
  sub.subscribe(FANOUT_CHANNEL).catch(() => { /* Valkey 挂了退回单进程 */ });
}

/** 订阅（SSE 连接用） */
export function subscribe(fn: (e: SseEvent) => void): () => void {
  ensureFanoutSubscriber();
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

export { RETENTION_MS, REPLAY_LIMIT, BACKLOG_LIMIT };

/** 补取：since 之后的最多 500 条（本成员相关的） */
export async function replaySince(since: number, memberId: string): Promise<{
  items: { id: number; event: string; data: Record<string, unknown> }[];
  hasMore: boolean;
  gone: boolean;
}> {
  const redis = realtimeRedis();
  if (!redis) return { items: [], hasMore: false, gone: true };
  let cursorRaw: string | null;
  try {
    cursorRaw = await redis.get(CURSOR_KEY);
  } catch {
    // Valkey 不可用：无法补取 → 按"窗口已过期"处理，客户端全量刷新（不静默丢事件）
    return { items: [], hasMore: false, gone: true };
  }
  const cursor = cursorRaw ? Number(cursorRaw) : 0;
  // 窗口判断：since 距今超过保留窗口（近似用「最小保留 cursor」），或 since > 当前 cursor
  if (since > cursor + 1) {
    return { items: [], hasMore: false, gone: true };
  }
  const oldest = (await redis.zrange(STREAM_KEY, "0", "0")) as string[];
  if (oldest[0]) {
    const oldestId = (JSON.parse(oldest[0]) as SseEvent).id;
    if (since < oldestId - 1) {
      return { items: [], hasMore: false, gone: true };   // 窗口外（已被清理）
    }
  }
  const raw = (await redis.zrangebyscore(STREAM_KEY, since + 1, "+inf", "LIMIT", 0, REPLAY_LIMIT + 1)) as string[];
  const all = raw.map((r) => JSON.parse(r) as SseEvent)
    .filter((e) => e.memberId === null || e.memberId === memberId);
  const hasMore = raw.length > REPLAY_LIMIT;
  return {
    items: all.slice(0, REPLAY_LIMIT).map(({ id, event, data }) => ({ id, event, data })),
    hasMore,
    gone: false,
  };
}
