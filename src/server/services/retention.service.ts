/**
 * 历史日志保留与清理（规范第 8.4 节：保留期可配置，默认 1 年（安全类））
 *
 * 背景：Round 25 起登录失败、令牌、设置等安全事件都会写 `audit_entry`，攻击流量下这张表会持续增长；
 * `activity_entry` 同理。此前**没有任何清理机制** —— 表只增不减。
 *
 * 纪律：
 *   1 保留期**可配置**（`AUDIT_RETENTION_DAYS` / `ACTIVITY_RETENTION_DAYS`），默认 365 天；
 *      显式设 0 = 关闭该类清理（不误删）。
 *   2 **只删早于截止时间的行**；截止时间由「now - days」计算，便于测试注入固定 now。
 *   3 清理是**幂等**的：多副本/重跑只会重复删除同一批过期行，不会误伤新数据。
 *   4 清理失败只记日志，不影响服务（由调用方 catch）。
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { inArray, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { activityEntry, auditEntry, invite, knowledgeQueryLog, setting } from "../../db/schema.ts";
import { exportPackageDir } from "./full-export.service.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** 导出包保留期默认 24 小时（异步导出文件含组织全量业务数据，不能无限堆积） */
const DEFAULT_EXPORT_HOURS = 24;

export interface RetentionConfig { auditDays: number; activityDays: number; exportHours: number }

/** 从环境变量读取保留期（非法/负数回落到默认 365 天；0 = 关闭） */
export function retentionConfig(): RetentionConfig {
  const parse = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const rawExport = process.env.EXPORT_RETENTION_HOURS;
  const exportHours = rawExport === undefined || rawExport.trim() === ""
    ? DEFAULT_EXPORT_HOURS
    : (Number.isFinite(Number(rawExport)) && Number(rawExport) >= 0 ? Math.floor(Number(rawExport)) : DEFAULT_EXPORT_HOURS);
  return {
    auditDays: parse(process.env.AUDIT_RETENTION_DAYS, 365),
    activityDays: parse(process.env.ACTIVITY_RETENTION_DAYS, 365),
    exportHours,
  };
}

/**
 * 解析生效保留期：**显式环境变量优先**（运维可强制），其次 setting（管理员界面可配），
 * 最后默认 365 天。这样"规范要求可配置"有两条可执行路径，且不会互相打架。
 */
export async function resolveRetentionConfig(): Promise<RetentionConfig> {
  const env = retentionConfig();
  const explicit = (raw: string | undefined): boolean => raw !== undefined && raw.trim() !== "";
  const rows = await db.select().from(setting)
    .where(inArray(setting.key, ["audit.retentionDays", "activity.retentionDays", "export.retentionHours"]));
  const fromSetting = (key: string, max: number): number | null => {
    const v = rows.find((r) => r.key === key)?.value;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max) return v;
    return null;
  };
  return {
    auditDays: explicit(process.env.AUDIT_RETENTION_DAYS) ? env.auditDays : (fromSetting("audit.retentionDays", 3650) ?? env.auditDays),
    activityDays: explicit(process.env.ACTIVITY_RETENTION_DAYS) ? env.activityDays : (fromSetting("activity.retentionDays", 3650) ?? env.activityDays),
    exportHours: explicit(process.env.EXPORT_RETENTION_HOURS) ? env.exportHours : (fromSetting("export.retentionHours", 8760) ?? env.exportHours),
  };
}

/** 知识检索日志固定保留 30 天（规范 9 节：不随审计/活动保留期配置） */
export const KNOWLEDGE_QUERY_RETENTION_DAYS = 30;

/** 导出包目录统计（运维只读；目录不存在按 0 处理） */
export async function exportPackageStats(dir = exportPackageDir()): Promise<{ files: number; bytes: number }> {
  try {
    const entries = await readdir(dir);
    let files = 0, bytes = 0;
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const st = await stat(join(dir, name)).catch(() => null);
      if (st?.isFile()) { files++; bytes += st.size; }
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

/**
 * 清理过期导出包（Round 47）：默认保留 24h，`export.retentionHours`/`EXPORT_RETENTION_HOURS=0` 关闭。
 * 只按 **文件 mtime** 与现在比较，幂等；失败的文件跳过，不阻断整轮清理。
 */
export async function pruneExportPackages(opts: { now?: Date; hours?: number; dir?: string } = {}): Promise<{ deleted: number; bytesFreed: number; hours: number }> {
  const hours = opts.hours ?? (await resolveRetentionConfig()).exportHours;
  if (hours <= 0) return { deleted: 0, bytesFreed: 0, hours };
  const now = opts.now ?? new Date();
  const dir = opts.dir ?? exportPackageDir();
  const cutoff = now.getTime() - hours * HOUR_MS;
  let deleted = 0, bytesFreed = 0;
  let entries: string[];
  try { entries = await readdir(dir); } catch { return { deleted: 0, bytesFreed: 0, hours }; }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    const st = await stat(path).catch(() => null);
    if (!st?.isFile() || st.mtimeMs >= cutoff) continue;
    const size = st.size;
    try { await unlink(path); deleted++; bytesFreed += size; } catch { /* 并发删除/无权限：跳过 */ }
  }
  return { deleted, bytesFreed, hours };
}

/**
 * 邀请台账清理（Round 50）：已用超 7 天 / 未用且过期超 30 天的记录删除（令牌哈希无保留价值）。
 * 返回真实删除数；失败由调用方 catch。
 */
export async function pruneInvites(opts: { now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const usedCutoff = new Date(now.getTime() - 7 * DAY_MS);
  const expiredCutoff = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db.delete(invite).where(sql`
    (used_at is not null and used_at < ${usedCutoff.toISOString()})
    or (used_at is null and expires_at < ${expiredCutoff.toISOString()})
  `).returning({ id: invite.id });
  return rows.length;
}

export interface RetentionResult {
  auditDeleted: number;
  activityDeleted: number;
  knowledgeDeleted: number;
  auditDays: number;
  activityDays: number;
  exportDeleted: number;
  exportBytesFreed: number;
  exportHours: number;
  invitesDeleted: number;
}

/**
 * 清理历史日志。`opts` 供测试注入固定时间/保留期；生产由定时任务调用（见 server.ts）。
 */
export async function pruneHistoricalLogs(opts: {
  now?: Date; auditDays?: number; activityDays?: number; exportHours?: number; exportDir?: string;
} = {}): Promise<RetentionResult> {
  // 未显式传参时才走"环境变量 → setting → 默认"的解析（测试注入固定值不受 DB 影响）
  const cfg = opts.auditDays === undefined || opts.activityDays === undefined
    ? await resolveRetentionConfig()
    : retentionConfig();
  const now = opts.now ?? new Date();
  const auditDays = opts.auditDays ?? cfg.auditDays;
  const activityDays = opts.activityDays ?? cfg.activityDays;

  let auditDeleted = 0;
  let activityDeleted = 0;

  if (auditDays > 0) {
    const cutoff = new Date(now.getTime() - auditDays * DAY_MS);
    const rows = await db.delete(auditEntry).where(lt(auditEntry.createdAt, cutoff)).returning({ id: auditEntry.id });
    auditDeleted = rows.length;
  }
  if (activityDays > 0) {
    const cutoff = new Date(now.getTime() - activityDays * DAY_MS);
    const rows = await db.delete(activityEntry).where(lt(activityEntry.createdAt, cutoff)).returning({ id: activityEntry.id });
    activityDeleted = rows.length;
  }

  // 知识检索日志：固定 30 天（规范 9 节），与上面两类保留期配置解耦
  const knowledgeCutoff = new Date(now.getTime() - KNOWLEDGE_QUERY_RETENTION_DAYS * DAY_MS);
  const knowledgeDeleted = (await db.delete(knowledgeQueryLog)
    .where(lt(knowledgeQueryLog.createdAt, knowledgeCutoff)).returning({ id: knowledgeQueryLog.id })).length;

  // 导出包清理：显式注入 now 的调用（测试）默认不动真实目录，除非显式给 exportHours
  const exportHours = opts.exportHours ?? (opts.now ? 0 : cfg.exportHours);
  const exportPrune = await pruneExportPackages({ now, hours: exportHours, dir: opts.exportDir });
  const invitesDeleted = await pruneInvites({ now });
  return {
    auditDeleted, activityDeleted, knowledgeDeleted, auditDays, activityDays,
    exportDeleted: exportPrune.deleted, exportBytesFreed: exportPrune.bytesFreed, exportHours: exportPrune.hours,
    invitesDeleted,
  };
}
