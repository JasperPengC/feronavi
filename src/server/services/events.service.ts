import { deferAfterCommit } from "../../db/context.ts";
/**
 * SSE 事件总线（W5，REST 7c + 重放边界）
 *
 * 设计（全部按规范）：
 *   - cursor：Valkey INCR 单调数字，**不是时间戳**（同毫秒并发会乱）
 *   - 事件存 Valkey 有序集合（score=cursor），**最多约5万条保留**、可丢（Valkey 非真相源）
 *   - 补取：单次扫描 ≤500，nextCursor跨成员推进；保留的5万条游标窗口外410
 *   - 进程内订阅：单节点部署（第 8.1 容量档）用 EventEmitter 即达；
 *     多副本时此处换 Valkey Pub/Sub，接口不变（预留）
 *   - 积压 >100 → 发 `dropped` 事件后主动断开，客户端全量刷新
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { realtimeRedis, realtimeSubscriber } from "./realtime-redis.ts";
import type { ResourceScope } from "../../shared/resource-events.ts";
import { canDeliverEvent, legacyEventScope } from "./event-access.service.ts";
export { canDeliverEvent } from "./event-access.service.ts";

export interface SseEvent {
  id: number; // cursor
  event: string; // notification.new / workitem.changed / ...
  data: Record<string, unknown>;
  /** 只推给该成员；null = 广播（本期全部定向，字段预留） */
  memberId: string | null;
  /** 仅用于服务端实时/重放授权，不序列化到浏览器。 */
  scope?: ResourceScope;
}

const STREAM_KEY = "feronavi:events";
const CURSOR_KEY = "feronavi:events:cursor";
/** 实例标识：跨实例 Pub/Sub 时忽略自己发出的消息（本地已直接 emit 过，避免重复投递） */
const INSTANCE_ID = randomUUID();
const FANOUT_CHANNEL = "feronavi:events:fanout";
let fanoutStarted = false;
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 小时
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
export async function publish(event: string, data: Record<string, unknown>, memberId: string | null, scope?: ResourceScope): Promise<number> {
  if (deferAfterCommit(() => publishNow(event, data, memberId, scope))) return 0;
  return publishNow(event, data, memberId, scope);
}
async function publishNow(event: string, data: Record<string, unknown>, memberId: string | null, scope?: ResourceScope): Promise<number> {
  if (!scope && (event.startsWith("workitem.") || event.startsWith("comment."))) {
    scope = await legacyEventScope(event, data) ?? undefined;
    if (!scope) return 0;
    data = { ...data, projectId: scope.projectId };
  }
  const redis = realtimeRedis();
  let id: number;
  let persisted = false;
  if (redis) {
    try {
      id = await redis.incr(CURSOR_KEY);
      const payload: SseEvent = { id, event, data, memberId, ...(scope ? { scope } : {}) };
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
  const payload: SseEvent = { id, event, data, memberId, ...(scope ? { scope } : {}) };
  // 本实例订阅者直接投递（快路径）；其它副本由 Pub/Sub 接力
  bus.emit("event", payload);
  if (persisted) {
    void redis!
      .publish(FANOUT_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, payload }))
      .catch(() => {});
  }
  return id;
}

/** 启动跨实例订阅（懒加载；未配置 REDIS_URL 或连接失败时保持单进程模式） */
function ensureFanoutSubscriber(): void {
  if (fanoutStarted) return;
  fanoutStarted = true;
  const sub = realtimeSubscriber();
  if (!sub) return;
  sub.once("end", () => {
    fanoutStarted = false;
  });
  let interrupted = false;
  sub.on("close", () => {
    interrupted = true;
  });
  sub.on("ready", () => {
    void sub
      .subscribe(FANOUT_CHANNEL)
      .then(() => {
        if (interrupted) {
          interrupted = false;
          bus.emit("recovery");
        }
      })
      .catch(() => {
        interrupted = true;
      });
  });
  sub.on("message", (channel: string, message: string) => {
    if (channel !== FANOUT_CHANNEL) return;
    try {
      const parsed = JSON.parse(message) as {
        origin: string;
        payload: SseEvent;
      };
      if (parsed.origin === INSTANCE_ID) return; // 自己发的：本地已 emit
      bus.emit("event", parsed.payload);
    } catch {
      /* 坏消息不影响本实例 */
    }
  });
}

/** 订阅（SSE 连接用） */
export function subscribe(fn: (e: SseEvent) => void): () => void {
  ensureFanoutSubscriber();
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

/** Local-only control signal after a subscriber reconnect; contains no business payload. */
export function subscribeRecovery(fn: () => void): () => void {
  bus.on("recovery", fn);
  return () => {
    bus.off("recovery", fn);
  };
}

export { RETENTION_MS, REPLAY_LIMIT, BACKLOG_LIMIT };

/** 补取：since 之后的最多 500 条（本成员相关的） */
export async function replaySince(
  since: number,
  memberId: string,
): Promise<{
  items: Pick<SseEvent, "id" | "event" | "data">[];
  hasMore: boolean;
  gone: boolean;
  nextCursor: number;
}> {
  const gone = { items: [], hasMore: false, gone: true, nextCursor: since };
  try {
    const redis = realtimeRedis();
    if (!redis) return gone;
    const cursorRaw = await redis.get(CURSOR_KEY);
    const cursor = cursorRaw ? Number(cursorRaw) : 0;
    if (!Number.isSafeInteger(cursor) || since > cursor) return gone;
    const oldest = await redis.zrange(STREAM_KEY, "0", "0");
    if (oldest[0] && since < (JSON.parse(oldest[0]) as SseEvent).id - 1)
      return gone;
    const raw = await redis.zrangebyscore(
      STREAM_KEY,
      since + 1,
      "+inf",
      "LIMIT",
      0,
      REPLAY_LIMIT + 1,
    );
    const scanned = raw.map((value) => JSON.parse(value) as SseEvent);
    // INCR and the retained set are only a lossy signal cache. A missing global cursor,
    // including deletion between oldest and range reads, requires snapshot recovery.
    if (
      scanned.some(
        (e, index) => !Number.isSafeInteger(e.id) || e.id !== since + index + 1,
      )
    )
      return gone;
    if (raw.length <= REPLAY_LIMIT && (scanned.at(-1)?.id ?? since) < cursor)
      return gone;
    const page = scanned.slice(0, REPLAY_LIMIT);
    const visible: SseEvent[] = [];
    for (const event of page) if (await canDeliverEvent(memberId, event)) visible.push(event);
    return {
      items: visible
        .map(({ id, event, data }) => ({
          id,
          event,
          data,
        })),
      hasMore: raw.length > REPLAY_LIMIT,
      gone: false,
      nextCursor: page.at(-1)?.id ?? since,
    };
  } catch {
    return gone;
  }
}
