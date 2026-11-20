/**
 * 启动时自动迁移（规范第 8.5 节「迁移执行机制」）
 *
 * 为什么需要：规范写的是「app 启动时自动执行，不依赖人工步骤」，但此前 `server.ts` 只是起 HTTP 服务，
 * 新库必须人工跑 `drizzle-kit migrate`；漏跑时表现为「登录/向导接口报 relation does not exist」。
 *
 * 锁：所有副本始终使用 PostgreSQL 会话级咨询锁，缓存可用性不改变互斥域。
 * 等待默认最多 5 分钟；连接被进程终止时 PG 自动释放锁。
 * 迁移与锁使用同一保留连接，DB_POOL_MAX=1 也不会自锁。
 *
 * 失败语义：抛错 → `server.ts` 记录后 `process.exit(1)`，**不启动 HTTP 服务**（避免半迁移对外服务）。
 * 可用 `MIGRATE_ON_START=0` 关闭（测试/特殊部署），`MIGRATIONS_DIR` 指定迁移目录。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, inTransaction, onReservedConnection } from "./index.ts";
import { pendingMigrations } from "./migration-history.ts";
import { loadMigrations } from "./migration-files.ts";

const LOCK_KEY = "feronavi:migrate";
const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** 迁移目录：环境变量优先，其次 cwd/drizzle，最后按源码与编译产物的相对位置各试一次 */
export function resolveMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) {
    if (!existsSync(join(process.env.MIGRATIONS_DIR, "meta", "_journal.json"))) throw new Error("指定的迁移目录缺少 meta/_journal.json");
    return process.env.MIGRATIONS_DIR;
  }
  const candidates = [
    join(process.cwd(), "drizzle"),
    fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    fileURLToPath(new URL("../../../drizzle/", import.meta.url)),
  ].filter((x): x is string => !!x);
  for (const dir of candidates) {
    if (existsSync(join(dir, "meta", "_journal.json"))) return dir;
  }
  throw new Error("未找到迁移目录（meta/_journal.json），已停止启动");
}

async function appliedCount(): Promise<number> {
  try {
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return rows[0]?.n ?? 0;
  } catch {
    return 0;   // 迁移记录表还不存在 = 从未迁移过
  }
}

/** 同一个数据库始终是最终互斥域，不再使用会因缓存分区而分叉的锁。 */
async function acquirePgLock() {
  const timeoutMs = Number(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? DEFAULT_LOCK_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("MIGRATION_LOCK_TIMEOUT_MS 必须为正整数");
  const reserved = await sql.reserve();
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const [row] = await reserved`select pg_try_advisory_lock(hashtext(${LOCK_KEY})) as acquired`;
      if (row?.acquired) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`等待 PostgreSQL 迁移锁超时（${timeoutMs}ms）`);
      await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)));
    }
  } catch (error) {
    reserved.release();
    throw error;
  }
  return {
    run: (fn: () => Promise<void>) => onReservedConnection(reserved, fn),
    release: async () => {
      try { await reserved`select pg_advisory_unlock(hashtext(${LOCK_KEY}))`; }
      finally { reserved.release(); }
    },
  };
}

/** 执行迁移；保留历史账本，按已验证的内容身份兼容两条既有升级路径。 */
export async function runMigrations(): Promise<void> {
  if (process.env.MIGRATE_ON_START === "0") {
    console.info("[migrate] MIGRATE_ON_START=0，跳过自动迁移");
    return;
  }
  const folder = resolveMigrationsFolder();
  const { migrations } = loadMigrations(folder);

  let before = 0, after = 0;
  let lock: Awaited<ReturnType<typeof acquirePgLock>> | undefined;
  try {
    lock = await acquirePgLock();
    await lock.run(async () => {
      before = await appliedCount();
      await inTransaction(async () => {
        await sql`create schema if not exists drizzle`;
        await sql`create table if not exists drizzle.__drizzle_migrations (
          id serial primary key, hash text not null, created_at bigint
        )`;
        const applied = await sql<{ hash: string; created_at: string | null }[]>`
          select hash, created_at from drizzle.__drizzle_migrations order by id`;
        for (const migration of pendingMigrations(migrations, applied)) {
          for (const statement of migration.sql) await sql.unsafe(statement);
          await sql`insert into drizzle.__drizzle_migrations(hash, created_at) values(${migration.hash}, ${migration.folderMillis})`;
        }
      });
      after = await appliedCount();
    });
  } finally {
    if (lock) await lock.release().catch(() => {});
  }
  console.info(`[migrate] 自动迁移完成：新应用 ${after - before} 个，累计 ${after}（锁=pg）`);
}
