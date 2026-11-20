/** 登录双维度防线：Redis 在副本间共享，本地限额始终生效并覆盖缓存故障。 */
import Redis from "ioredis";
import { createHash } from "node:crypto";

const MAX_FAILURES = 10;
const LOCK_SECONDS = 600;
const MAX_ENTRIES = 10_000;
const counters = new Map<string, { count: number; expires: number }>();
const key = (kind: string, value: string) => `feronavi:login:${kind}:${createHash("sha256").update(value).digest("hex")}`;
const account = (username: string) => username.toLowerCase();
const failureKeys = (username: string, ip: string) => [key("failure:acct", account(username)), key("failure:ip", ip)];
const attemptKeys = (username: string, ip: string) => [key("attempt:acct", account(username)), key("attempt:ip", ip)];

function localCount(k: string): number {
  const entry = counters.get(k);
  if (!entry) return 0;
  if (entry.expires <= Date.now()) { counters.delete(k); return 0; }
  return entry.count;
}
function localIncrement(k: string, seconds: number): number {
  const count = localCount(k);
  if (!count && counters.size >= MAX_ENTRIES) {
    for (const [storedKey, entry] of counters) if (entry.expires <= Date.now()) counters.delete(storedKey);
    // 活跃条目不能被随机新账号挤掉；容量耗尽时拒绝新键，内存与计算队列均有界。
    if (counters.size >= MAX_ENTRIES) return Number.POSITIVE_INFINITY;
  }
  counters.set(k, { count: count + 1, expires: counters.get(k)?.expires ?? Date.now() + seconds * 1000 });
  return count + 1;
}

let client: Redis | undefined;
let connecting: Promise<Redis | null> | undefined;
let retryAfter = 0;
async function getClient(): Promise<Redis | null> {
  if (!process.env.REDIS_URL || Date.now() < retryAfter) return null;
  if (client?.status === "ready") return client;
  if (connecting) return connecting;
  client?.disconnect();
  const next = new Redis(process.env.REDIS_URL, {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
    connectTimeout: 250, commandTimeout: 250, retryStrategy: () => null,
  });
  next.on("error", () => {});
  client = next;
  connecting = next.connect().then(() => next).catch(() => {
    next.disconnect(); retryAfter = Date.now() + 5000; return null;
  }).finally(() => { connecting = undefined; });
  return connecting;
}
async function shared<T>(operation: (c: Redis) => Promise<T>): Promise<T | null> {
  try { const c = await getClient(); return c ? await operation(c) : null; }
  catch { client?.disconnect(); retryAfter = Date.now() + 5000; return null; }
}

/** 在昂贵校验前原子预留额度，避免并发请求全部通过“先查后记”。 */
export async function consumeLoginAttempt(username: string, ip: string): Promise<boolean> {
  const keys = attemptKeys(username, ip);
  const counts = keys.map((k) => localIncrement(k, 60));
  if (counts[0]! > 10 || counts[1]! > 20) return false;
  const result = await shared((c) => c.eval(`
    local a = redis.call('INCR', KEYS[1])
    if a == 1 then redis.call('EXPIRE', KEYS[1], 60) end
    local i = redis.call('INCR', KEYS[2])
    if i == 1 then redis.call('EXPIRE', KEYS[2], 60) end
    if a > 10 or i > 20 then return 0 end
    return 1
  `, 2, ...keys));
  return result === null || Number(result) === 1;
}

export async function isLockedOut(username: string, ip: string): Promise<boolean> {
  const keys = failureKeys(username, ip);
  if (keys.some((k) => localCount(k) >= MAX_FAILURES)) return true;
  const counts = await shared((c) => c.mget(...keys));
  return counts?.some((count) => Number(count ?? 0) >= MAX_FAILURES) ?? false;
}

export async function recordLoginFailure(username: string, ip: string): Promise<void> {
  const keys = failureKeys(username, ip);
  keys.forEach((k) => localIncrement(k, LOCK_SECONDS));
  await shared((c) => c.eval(`
    for _, k in ipairs(KEYS) do
      if redis.call('INCR', k) == 1 then redis.call('EXPIRE', k, ARGV[1]) end
    end
    return 1
  `, 2, ...keys, LOCK_SECONDS));
}

export async function clearLoginFailures(username: string, _ip: string): Promise<void> {
  // 成功仅清账号失败数：不能用自有账号登录清除同IP撞库累计，也不清请求额度。
  const k = failureKeys(username, "")[0]!;
  counters.delete(k);
  await shared((c) => c.del(k));
}
