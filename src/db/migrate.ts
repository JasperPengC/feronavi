/**
 * 启动时自动迁移（规范第 8.5 节「迁移执行机制」）
 *
 * 为什么需要：规范写的是「app 启动时自动执行，不依赖人工步骤」，但此前 `server.ts` 只是起 HTTP 服务，
 * 新库必须人工跑 `drizzle-kit migrate`；漏跑时表现为「登录/向导接口报 relation does not exist」。
 *
 * 锁：迁移协调属于数据库职责，但规范指定 Valkey 令牌锁 —— 两个都支持：
 *   · 配置了 `REDIS_URL` → Valkey `SET NX PX` 令牌锁（TTL 5 分钟、心跳续期、只删自己的锁）；
 *     取不到锁 = 另一个副本在迁移 → 每秒重试，最多等 5 分钟；
 *   · 未配置 Valkey 或 Valkey 不可用 → 退回 **PostgreSQL 会话级咨询锁**（`pg_advisory_lock`），
 *     多副本共享同一数据库时同样不会并发迁移，且不依赖外部组件。
 *
 * 失败语义：抛错 → `server.ts` 记录后 `process.exit(1)`，**不启动 HTTP 服务**（避免半迁移对外服务）。
 * 可用 `MIGRATE_ON_START=0` 关闭（测试/特殊部署），`MIGRATIONS_DIR` 指定迁移目录。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql, onReservedConnection } from "./index.ts";

const LOCK_KEY = "feronavi:migrate";
const LOCK_TTL_MS = 5 * 60 * 1000;
const TTL_HEARTBEAT_MS = Math.floor(LOCK_TTL_MS / 5);

/** 迁移目录：环境变量优先，其次 cwd/drizzle，最后按源码与编译产物的相对位置各试一次 */
export function resolveMigrationsFolder(): string | null {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    join(process.cwd(), "drizzle"),
    fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    fileURLToPath(new URL("../../../drizzle/", import.meta.url)),
  ].filter((x): x is string => !!x);
  for (const dir of candidates) {
    if (existsSync(join(dir, "meta", "_journal.json"))) return dir;
  }
  return null;
}

async function appliedCount(): Promise<number> {
  try {
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return rows[0]?.n ?? 0;
  } catch {
    return 0;   // 迁移记录表还不存在 = 从未迁移过
  }
}

type Lock = { kind: "valkey"; release: () => Promise<void> }
  | { kind: "pg"; release: () => Promise<void>; run: (fn: () => Promise<void>) => Promise<void> };

/** Valkey 令牌锁（规范方案）；未配置 REDIS_URL 或连不上则返回 null 由调用方退回 PG 锁 */
async function acquireValkeyLock(): Promise<Lock | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1500,
    retryStrategy: () => null,   // 连不上就立刻失败，交给 PG 锁兜底
  });
  redis.on("error", () => {});   // 连接错误不影响可用性（失败会走兜底）
  try {
    await redis.connect();
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + LOCK_TTL_MS;
    let acquired = false;
    while (Date.now() < deadline) {
      const ok = await redis.set(LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX");
      if (ok === "OK") { acquired = true; break; }
      await new Promise((r) => setTimeout(r, 1000));   // 另一个副本在迁移 → 等锁
    }
    if (!acquired) { await redis.quit().catch(() => {}); throw new Error("等待迁移锁超时（5 分钟）"); }

    const heartbeat = setInterval(() => {
      void redis.pexpire(LOCK_KEY, LOCK_TTL_MS).catch(() => {});
    }, TTL_HEARTBEAT_MS);
    heartbeat.unref();

    return {
      kind: "valkey",
      release: async () => {
        clearInterval(heartbeat);
        // 只删自己的锁：Lua compare-and-del（避免误删别人的锁）
        await redis.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1, LOCK_KEY, token,
        ).catch(() => {});
        await redis.quit().catch(() => {});
      },
    };
  } catch (e) {
    await redis.quit().catch(() => {});
    console.warn(`[migrate] Valkey 锁不可用（${(e as Error).message.slice(0, 80)}），退回 PostgreSQL 咨询锁`);
    return null;
  }
}

/** PostgreSQL 会话级咨询锁（无 Valkey 时的兜底；多副本共享同一个库依然互斥） */
async function acquirePgLock(): Promise<Lock> {
  const reserved = await sql.reserve();
  try {
    await reserved`select pg_advisory_lock(hashtext(${LOCK_KEY}))`;
  } catch (e) {
    reserved.release();
    throw e;
  }
  return {
    kind: "pg",
    run: (fn) => onReservedConnection(reserved, fn),
    release: async () => {
      try {
        await reserved`select pg_advisory_unlock(hashtext(${LOCK_KEY}))`;
      } finally {
        reserved.release();
      }
    },
  };
}

/** 执行迁移（幂等；已是最新时只做一次计数查询）。失败直接抛错，由调用方决定退出 */
export async function runMigrations(): Promise<void> {
  if (process.env.MIGRATE_ON_START === "0") {
    console.info("[migrate] MIGRATE_ON_START=0，跳过自动迁移");
    return;
  }
  const folder = resolveMigrationsFolder();
  if (!folder) {
    console.warn("[migrate] 未找到 drizzle 迁移目录（meta/_journal.json），跳过自动迁移");
    return;
  }

  const before = await appliedCount();
  let lock: Lock | null = null;
  try {
    lock = await acquireValkeyLock();
    if (!lock) lock = await acquirePgLock();
    if (lock.kind === "pg") await lock.run(() => migrate(db, { migrationsFolder: folder }));
    else await migrate(db, { migrationsFolder: folder });
  } finally {
    if (lock) await lock.release().catch(() => {});
  }
  const after = await appliedCount();
  console.info(`[migrate] 自动迁移完成：新应用 ${after - before} 个，累计 ${after}（锁=${lock?.kind ?? "none"}）`);
}
