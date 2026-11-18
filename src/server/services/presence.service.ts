/**
 * 在线状态（REST 7c `presence` 事件；Round 25 第 48 项，Round 61 多副本）
 *
 * 单实例：进程内 Map 记录连接数（同成员多标签页计数，最后一个关闭才 offline），TTL 60s 兜底。
 * 多副本（配置 REDIS_URL）：同一份注册表放 Valkey ——
 *   · `presence:online`（zset：memberId → lastSeen）
 *   · `presence:members`（hash：memberId → {name,username}）
 *   · `presence:conn:<memberId>`（hash：实例 → 连接数/心跳，可在缓存丢失后重建）
 * 任一 Redis 操作失败都**回落到进程内**，实时事件本身由 events.service 的 Pub/Sub 广播；
 * 不因缓存不可用而让在线状态整体失效。
 */
import type { Actor } from "../permission/actor.ts";
import { randomUUID } from "node:crypto";
import { publish } from "./events.service.ts";
import { realtimeRedis } from "./realtime-redis.ts";

const TTL_MS = 60_000;
const ONLINE_KEY = "presence:online";
const MEMBERS_KEY = "presence:members";
const CONN_PREFIX = "presence:conn:";
const INSTANCE_ID = randomUUID();

interface PresenceEntry {
  memberId: string; name: string; username: string;
  connections: number; lastSeen: number;
}
const online = new Map<string, PresenceEntry>();

function snapshot(): { memberId: string; name: string; username: string; lastSeen: number }[] {
  return [...online.values()].map((e) => ({ memberId: e.memberId, name: e.name, username: e.username, lastSeen: e.lastSeen }));
}
function isFresh(e: PresenceEntry, now: number): boolean { return now - e.lastSeen <= TTL_MS; }

/** 本地（单实例兜底）登记；返回是否为本实例首次上线 */
function localOnline(actor: Actor): boolean {
  const now = Date.now();
  const existing = online.get(actor.memberId);
  if (existing && isFresh(existing, now)) {
    existing.connections += 1; existing.lastSeen = now;
    return false;
  }
  online.set(actor.memberId, { memberId: actor.memberId, name: actor.name, username: actor.username, connections: 1, lastSeen: now });
  return true;
}

/** 每个实例提交自己的绝对连接数，重试/缓存重启不会重复累加；原子汇总仍在线的实例。 */
async function syncSharedPresence(memberId: string, entry?: PresenceEntry): Promise<number> {
  const r = realtimeRedis()!;
  const now = Date.now();
  return Number(await r.eval(`
    if tonumber(ARGV[5]) > 0 then
      redis.call('HSET', KEYS[3], ARGV[2], cjson.encode({connections=tonumber(ARGV[5]), lastSeen=tonumber(ARGV[3])}))
    else
      redis.call('HDEL', KEYS[3], ARGV[2])
    end
    local entries = redis.call('HGETALL', KEYS[3])
    local total = 0
    local latest = 0
    for i = 1, #entries, 2 do
      local value = cjson.decode(entries[i + 1])
      if tonumber(ARGV[3]) - value.lastSeen > tonumber(ARGV[4]) then
        redis.call('HDEL', KEYS[3], entries[i])
      else
        total = total + value.connections
        latest = math.max(latest, value.lastSeen)
      end
    end
    if total > 0 then
      redis.call('ZADD', KEYS[1], latest, ARGV[1])
      if ARGV[6] ~= '' then redis.call('HSET', KEYS[2], ARGV[1], ARGV[6]) end
      redis.call('EXPIRE', KEYS[3], 86400)
      redis.call('EXPIRE', KEYS[1], 86400)
      redis.call('EXPIRE', KEYS[2], 86400)
    else
      redis.call('ZREM', KEYS[1], ARGV[1])
      redis.call('HDEL', KEYS[2], ARGV[1])
      redis.call('DEL', KEYS[3])
    end
    return total
  `, 3, ONLINE_KEY, MEMBERS_KEY, `${CONN_PREFIX}${memberId}`,
  memberId, INSTANCE_ID, now, TTL_MS, entry?.connections ?? 0,
  entry ? JSON.stringify({ name: entry.name, username: entry.username }) : ""));
}

/** 连接建立；返回是否"该成员首次上线"（用于只广播一次 online） */
export async function markOnline(actor: Actor): Promise<boolean> {
  const localFirst = localOnline(actor);
  const r = realtimeRedis();
  if (!r) return localFirst;
  try {
    return await syncSharedPresence(actor.memberId, online.get(actor.memberId)) === 1;
  } catch {
    return localFirst;
  }
}

/** 心跳：刷新 lastSeen（半开连接也不会立刻掉线） */
export async function touchPresence(memberId: string): Promise<void> {
  const e = online.get(memberId);
  if (e) e.lastSeen = Date.now();
  const r = realtimeRedis();
  if (!r || !e) return;
  try { await syncSharedPresence(memberId, e); } catch { /* 可丢 */ }
}

/** 连接关闭；返回是否已完全离线（需要广播 offline） */
export async function markOffline(memberId: string): Promise<boolean> {
  const e = online.get(memberId);
  let localGone = false;
  if (e) {
    e.connections -= 1;
    if (e.connections <= 0) { online.delete(memberId); localGone = true; }
  }
  const r = realtimeRedis();
  if (!r) return localGone;
  try {
    return await syncSharedPresence(memberId, online.get(memberId)) === 0;
  } catch {
    return localGone;
  }
}

/** 清理超时条目（心跳/列表查询时顺带执行），返回被清理的成员 id（本地视角） */
export async function sweepStale(now = Date.now()): Promise<string[]> {
  const stale: string[] = [];
  for (const [id, e] of online) {
    if (!isFresh(e, now)) { online.delete(id); stale.push(id); }
  }
  const r = realtimeRedis();
  if (r) {
    try {
      const cutoff = now - TTL_MS;
      // 选取与删除同属一个原子操作，不能删掉其它实例刚刷新后的成员信息。
      await r.eval(`
        local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        for _, id in ipairs(expired) do
          redis.call('ZREM', KEYS[1], id)
          redis.call('HDEL', KEYS[2], id)
          redis.call('DEL', ARGV[2] .. id)
        end
        return #expired
      `, 2, ONLINE_KEY, MEMBERS_KEY, cutoff, CONN_PREFIX);
    } catch { /* 可丢 */ }
  }
  return stale;
}

export async function listOnline(now = Date.now()): Promise<{ memberId: string; name: string; username: string; lastSeen: number }[]> {
  await sweepStale(now);
  const r = realtimeRedis();
  if (r) {
    try {
      const ids = await r.zrangebyscore(ONLINE_KEY, now - TTL_MS, "+inf", "WITHSCORES");
      const out: { memberId: string; name: string; username: string; lastSeen: number }[] = [];
      for (let i = 0; i + 1 < ids.length; i += 2) {
        const memberId = ids[i]!;
        const lastSeen = Number(ids[i + 1]);
        const info = await r.hget(MEMBERS_KEY, memberId);
        const meta = info ? JSON.parse(info) as { name?: string; username?: string } : {};
        out.push({ memberId, name: meta.name ?? "", username: meta.username ?? "", lastSeen });
      }
      return out.sort((a, b) => b.lastSeen - a.lastSeen);
    } catch { /* 回落本地 */ }
  }
  return snapshot();
}

/** 供路由/测试使用：SSE 连接绑定与解绑（含广播 presence 事件；事件由 Pub/Sub 跨实例） */
export async function presenceConnected(actor: Actor): Promise<void> {
  const first = await markOnline(actor);
  if (first) await publish("presence", { memberId: actor.memberId, online: true }, null).catch(() => {});
}

export async function presenceDisconnected(memberId: string): Promise<void> {
  if (await markOffline(memberId)) await publish("presence", { memberId, online: false }, null).catch(() => {});
}

/** 测试隔离用（同时清 Valkey 注册表，避免跨套件残留） */
export async function resetPresenceForTests(): Promise<void> {
  online.clear();
  const r = realtimeRedis();
  if (r) { try {
    const ids = await r.zrange(ONLINE_KEY, "0", "-1");
    await r.del(ONLINE_KEY, MEMBERS_KEY, "presence:conn", ...ids.map(id => `${CONN_PREFIX}${id}`));
  } catch { /* ignore */ } }
}
