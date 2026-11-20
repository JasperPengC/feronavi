/** 升级自检与迁移历史校验；实际执行使用 db/migrate.ts 的 PostgreSQL 会话锁。 */
import { readdirSync } from "node:fs";
import { loadMigrations } from "../../db/migration-files.ts";
import { pendingMigrations } from "../../db/migration-history.ts";
import { resolveMigrationsFolder } from "../../db/migrate.ts";
import { sql } from "../../db/index.ts";
import { getSettingRaw } from "./setting.service.ts";

export interface MigrationStatus {
  applied: number;
  files: number;
  consistent: boolean;
  latestAppliedAt: string | null;
  pendingFiles: string[];
  /** 外部库：迁移照跑，但**平台不负责备份**（规范要求显式提示部署方） */
  externalDatabase: boolean;
  upgradeFlow: string[];
  notes: string[];
}

/** 迁移目录里的 SQL 文件名（字典序即执行序） */
export function migrationFiles(dir = "drizzle"): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }
}

export async function migrationStatus(): Promise<MigrationStatus> {
  const rows = await sql<{ hash: string; created_at: string | null }[]>`
    select hash, created_at from drizzle.__drizzle_migrations order by id
  `;
  const applied = rows.length;
  let files: string[] = [];
  const externalSetting = (await getSettingRaw("db.kind")) as string | null;
  const externalDatabase = externalSetting === "external" || (await getSettingRaw("db.externalPassword")) !== null;

  const notes: string[] = [];
  let pendingFiles: string[] = [];
  let consistent = false;
  try {
    const { names, migrations } = loadMigrations(resolveMigrationsFolder());
    files = names;
    const pending = new Set(pendingMigrations(migrations, rows).map(entry => entry.hash));
    pendingFiles = migrations.flatMap((entry, index) => pending.has(entry.hash) ? [files[index]!] : []);
    consistent = pending.size === 0;
    if (!consistent) notes.push(`还有 ${pending.size} 项迁移待执行`);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "迁移历史校验失败");
  }
  if (externalDatabase) {
    notes.push("检测到外部数据库：迁移仍会执行，但**备份不由平台保证** —— 升级前请确认你已完成备份（显式确认，不静默跳过）");
  }
  return {
    applied,
    files: files.length,
    consistent,
    latestAppliedAt: rows.length ? String(Math.max(...rows.map(row => Number(row.created_at)))) : null,
    pendingFiles,
    externalDatabase,
    // 规范给定的升级流程（顺序不可换：备份在最前，回滚在最后）
    upgradeFlow: [
      "1 备份（数据库 + 附件 + 密钥，三者缺一不可）",
      "2 拉取新镜像",
      "3 执行迁移（多副本需分布式锁，只跑一次）",
      "4 健康检查（/api/v1/system/status）",
      "5 失败则回滚镜像并恢复备份",
    ],
    notes,
  };
}

/**
 * 迁移用的分布式锁（Valkey SET NX）。
 * 规范：多副本下启动迁移会并发执行，必须保证只跑一次。
 */
export async function withMigrationLock<T>(fn: () => Promise<T>, opts: { ttlSeconds?: number; key?: string } = {}): Promise<T> {
  const { Redis } = await import("ioredis");
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
  const key = opts.key ?? "feronavi:migrate:lock";
  const token = `${process.pid}-${Date.now()}`;
  const ok = await redis.set(key, token, "EX", opts.ttlSeconds ?? 300, "NX");
  if (ok !== "OK") {
    redis.disconnect();
    throw new Error("已有实例正在执行迁移（未取到分布式锁）");
  }
  try {
    return await fn();
  } finally {
    // 只删自己的锁（比对 token），避免释放别人的锁
    const cur = await redis.get(key);
    if (cur === token) await redis.del(key);
    redis.disconnect();
  }
}
