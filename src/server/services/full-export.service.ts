/**
 * 兼容合规 JSON 导出（inline / async），不用于系统迁移。
 * 数据范围和字段脱敏由 registry 的 safe + compliance 投影决定；
 * migration safe 保留密码哈希，绝不能直接用于本接口。系统迁移使用 /system/backups。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";
import { listSettings } from "./setting.service.ts";
import { datasetRegistry, orderedDatasets, tableClassifications } from "./system-backup/registry.ts";

export const FULL_EXPORT_SCHEMA_VERSION = "1";

/** 明确排除的表及原因（导出必须能解释自己少了什么） */
export const EXCLUDED_TABLES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(tableClassifications).map(([name, disposition]) => [name,
    disposition === "rebuild" ? "派生索引或统计，不属于合规业务数据" : "临时状态、控制记录或安全材料不导出",
  ])),
  ...Object.fromEntries(datasetRegistry.filter((dataset) => dataset.minimumMode === "full")
    .map((dataset) => [dataset.tableName, "含安全材料，不属于 safe 合规数据范围"])),
  member: "仅导出非敏感字段（不含密码哈希）",
  session: "会话令牌哈希属安全材料",
  api_token: "令牌哈希属安全材料（元数据见 /me/data-export）",
  password_reset_token: "重置令牌属安全材料",
  invite: "邀请令牌哈希属安全材料",
  two_factor_secret: "双因素密钥与恢复码属安全材料",
  setting: "按掩码导出（敏感键不可回显）",
};

function assertExport(actor: Actor) {
  const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
  if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
}
async function buildExport() {
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};

  for (const dataset of orderedDatasets("safe")) {
    const databaseRows = await db.execute<Record<string, unknown>>(sql`
      select ${sql.join(dataset.columns.map((column) => sql.identifier(column)), sql`, `)}
      from ${sql.identifier(dataset.tableName)}
      order by ${sql.join(dataset.orderBy.map((column) => sql.identifier(column)), sql`, `)} limit 20000
    `);
    const rows = databaseRows.flatMap((databaseRow) => {
      const row = dataset.encodeRow(databaseRow, { mode: "safe", purpose: "compliance" });
      return row ? [row] : [];
    });
    if (dataset.tableName === "setting") {
      // registry 不回显 setting.value，且会过滤秘密行；兼容层只消费已经脱敏的公开视图。
      // 普通设置必须存在于合规投影；秘密设置仅保留公开接口的掩码占位，不补回数据库原值。
      const projectedKeys = new Set(rows.map((row) => row.key));
      const settings = (await listSettings()).filter((row) => row.isSecret || projectedKeys.has(row.key));
      data.setting = settings;
      counts.setting = settings.length;
    } else {
      data[dataset.tableName] = rows;
      counts[dataset.tableName] = rows.length;
    }
  }

  return {
    schemaVersion: FULL_EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    excludedTables: EXCLUDED_TABLES,
    orderHint: "兼容合规导出不提供恢复或导入顺序；系统迁移请使用 /system/backups 的加密迁移包。",
    counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    data,
  };
}

/** 同步导出（保留：接口 no-store、适合小库；异步包见 writeFullExportPackage） */
export async function fullExport(actor: Actor) {
  assertExport(actor);
  const base = await buildExport();
  return {
    ...base,
    mode: "inline" as const,
    note: "同步导出（未落盘）。大库请用 POST /system/exports 走异步打包。",
  };
}

/**
 * 异步导出包（Round 46）：任务队列里生成 JSON 文件，GET /system/exports/:id 下载。
 * 落盘目录 DATA_DIR/exports（0700），文件名 = 任务 id；**包含敏感掩码口径与内联导出完全一致**。
 */
export function exportPackageDir(): string {
  return join(process.env.DATA_DIR ?? "/tmp/feronavi-data", "exports");
}
export function exportPackagePath(jobId: string): string {
  return join(exportPackageDir(), `${jobId}.json`);
}

export async function writeFullExportPackage(jobId: string): Promise<{ path: string; bytes: number; schemaVersion: string }> {
  const base = await buildExport();
  const payload = {
    ...base,
    mode: "async" as const,
    note: "异步导出包：由任务队列生成；下载后请妥善保管（含组织全量业务数据，敏感材料按口径掩码）。",
  };
  const text = JSON.stringify(payload);
  await mkdir(exportPackageDir(), { recursive: true, mode: 0o700 });
  const path = exportPackagePath(jobId);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  return { path, bytes: Buffer.byteLength(text), schemaVersion: FULL_EXPORT_SCHEMA_VERSION };
}

export async function readFullExportPackage(jobId: string): Promise<Buffer> {
  return readFile(exportPackagePath(jobId));
}
