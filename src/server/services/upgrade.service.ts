/**
 * 升级与迁移自检（第十二期，规范第 8 章「升级与迁移策略」）
 *
 * 规范要点（逐条落地或明确登记为未做）：
 *   1 **迁移账本与迁移文件必须对得上** —— 这正是第二期踩过的坑：手工补的迁移文件没登记进
 *      `drizzle.__drizzle_migrations` 时 drizzle 会静默跳过或重放。自检页要能一眼看出来。
 *   2 **外部 PG 场景**：迁移照跑，但备份不由平台保证 → 自检页必须显示该状态，
 *      并要求部署方显式确认"我已备份"（不静默跳过）。
 *   3 **多副本下迁移要加分布式锁**（Valkey SET NX）—— 本期提供锁工具；
 *      真正的"启动时自动迁移"仍需部署编排调用（已在文档写明调用方式）。
 *   4 **N-2 直升**：迁移脚本按序串行执行即可满足；破坏性变更跨两个次版本属发布纪律，
 *      在文档里写明，代码无法强制。
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
  const rows = await sql<{ n: number; latest: string | null }[]>`
    select count(*)::int as n, max(created_at)::text as latest from drizzle.__drizzle_migrations
  `;
  const applied = rows[0]?.n ?? 0;
  const files = migrationFiles();
  const externalSetting = (await getSettingRaw("db.kind")) as string | null;
  const externalDatabase = externalSetting === "external" || (await getSettingRaw("db.externalPassword")) !== null;

  const notes: string[] = [];
  if (applied !== files.length) {
    notes.push(`迁移账本 ${applied} 条与文件 ${files.length} 个不一致 —— 手工补写的迁移文件必须登记进 drizzle.__drizzle_migrations，否则会静默跳过或重放`);
  }
  if (externalDatabase) {
    notes.push("检测到外部数据库：迁移仍会执行，但**备份不由平台保证** —— 升级前请确认你已完成备份（显式确认，不静默跳过）");
  }
  return {
    applied,
    files: files.length,
    consistent: applied === files.length,
    latestAppliedAt: rows[0]?.latest ?? null,
    // 账本只记 hash，无法逐条对文件名 —— 因此只报数量差与总数，不做假精确的"缺失文件列表"
    pendingFiles: [],
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

void join;
