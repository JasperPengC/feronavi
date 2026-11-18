/**
 * 登录失败锁定 —— **IP + 账号双维度**（第 5.9 节：10 次失败 → 锁 10 分钟）
 *
 * 两个维度缺一不可：
 *   - 只按账号 → 攻击者可以拿一个账号把**别人**锁死（拒绝服务）
 *   - 只按 IP   → 攻击者换 IP 即可绕过；且 NAT 后面的整个办公室会被一起锁
 *   所以两边都记，任一维度超限即拒绝。
 *
 * 计数放 Valkey（**可丢**）：锁定状态丢了最坏是少挡几次尝试，
 * 不属于「真相」，不需要进 PG（与队列/会话的区别见第 4.4 节）。
 */
import Redis from "ioredis";

const MAX_FAILURES = 10;
const LOCK_SECONDS = 10 * 60;
const WINDOW_SECONDS = 10 * 60;

let client: Redis | null = null;
let disabled = false;

function getClient(): Redis | null {
  if (disabled) return null;
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) { disabled = true; return null; }
  try {
    client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    client.on("error", () => {});
    return client;
  } catch { disabled = true; return null; }
}

const acctKey = (u: string) => `feronavi:loginfail:acct:${u.toLowerCase()}`;
const ipKey = (ip: string) => `feronavi:loginfail:ip:${ip}`;

/**
 * 是否已锁定。
 * ⚠️ **Valkey 不可用时返回 false（放行）** —— 登录是入口，缓存故障不能把所有人挡在门外。
 * 代价是锁定在这段时间内失效，属可接受降级（真实防线是密码强度 + 速率限制）。
 */
export async function isLockedOut(username: string, ip: string): Promise<boolean> {
  try {
    const c = getClient();
    if (!c) return false;
    const [a, i] = await c.mget(acctKey(username), ipKey(ip));
    return Number(a ?? 0) >= MAX_FAILURES || Number(i ?? 0) >= MAX_FAILURES;
  } catch {
    return false;
  }
}

export async function recordLoginFailure(username: string, ip: string): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    const pipe = c.multi();
    pipe.incr(acctKey(username)); pipe.expire(acctKey(username), LOCK_SECONDS);
    pipe.incr(ipKey(ip));         pipe.expire(ipKey(ip), WINDOW_SECONDS);
    await pipe.exec();
  } catch { /* 降级：记不上就算了，不能因为计数失败让登录报错 */ }
}

export async function clearLoginFailures(username: string, ip: string): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    await c.del(acctKey(username), ipKey(ip));
  } catch { /* 同上 */ }
}
