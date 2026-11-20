import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql as query } from "../../../db/index.ts";
import {
  DomainError,
  forbidden,
  SYSTEM_RESTORE_ERROR_CODES,
} from "../../../shared/errors.ts";
import type {
  RestoreSummary,
  SystemBackupManifest,
} from "../../../shared/schemas/system-backup.ts";
import {
  createRestoreRecord,
  getRestoreRecord,
  transitionRestore,
  type RestoreRecord,
} from "../../repos/system-transfer.repo.ts";
import { createRestoreUploadFile } from "./storage.ts";
import {
  authenticateAndReadManifest,
  readOuterHeader,
  restoreLimits,
} from "./restore-archive.ts";

export { authenticateAndReadManifest } from "./restore-archive.ts";
export interface BusinessEmptyCheck {
  empty: boolean;
  blockingTables: Array<{ table: string; rows: number }>;
  allowedSeedTables: string[];
}
const allowedSeedTables = [
  "permission",
  "role",
  "role_permission",
  "project_status_def",
  "workflow",
  "workflow_state",
  "workflow_transition",
];
// 精确允许的本地安装事件；不能把整张audit_entry当作空表。
export const SETUP_RESTORE_AUDIT_ACTIONS = [
  "system_restore.uploaded",
  "system_restore.preflighted",
  "system_restore.started",
  "system_restore.completed",
  "system_restore.failed",
] as const;

export function localRestoreAuditPredicate() {
  return query`a.actor_id is null and a.actor_snapshot is not distinct from 'setup'
    and a.severity = 'SECURITY' and a.action in ${query([...SETUP_RESTORE_AUDIT_ACTIONS])}
    and a.target_type = 'system_restore' and a.ip is null and a.user_agent is null
    and (a.changes is null or (a.action = 'system_restore.failed'
      and a.changes = jsonb_build_object('errorCode', a.changes->>'errorCode')
      and a.changes->>'errorCode' in ${query([...SYSTEM_RESTORE_ERROR_CODES])}))
    and exists (select 1 from system_restore r where r.id = a.target_id)`;
}

/** 只允许严格关联真实恢复控制行的内部任务，调用方固定使用job别名j。 */
export function localRestoreJobPredicate() {
  return query`j.kind = 'restore.system' and jsonb_typeof(j.payload) = 'object'
    and j.payload ?& array['restoreId','dataKeyHandle']
    and j.payload - 'restoreId' - 'dataKeyHandle' = '{}'::jsonb
    and jsonb_typeof(j.payload->'restoreId') = 'string'
    and jsonb_typeof(j.payload->'dataKeyHandle') = 'string'
    and j.payload->>'dataKeyHandle' ~ '^[A-Za-z0-9_-]{43}$'
    and exists (select 1 from system_restore r where r.id::text = j.payload->>'restoreId')`;
}

export function manifestHash(manifest: SystemBackupManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export async function assertBusinessEmpty(): Promise<BusinessEmptyCheck> {
  const blockingTables: BusinessEmptyCheck["blockingTables"] = [];
  const tables = await query<
    { tablename: string }[]
  >`select tablename from pg_tables where schemaname = 'public'`;
  for (const { tablename: table } of tables) {
    if (["system_restore", "system_backup"].includes(table)) continue;
    let rows: { count: number }[];
    if (table === "setup_state") {
      rows =
        await query`select count(*)::int as count from setup_state where initialized_at is not null`;
    } else if (
      ["permission", "role", "role_permission", "project_status_def"].includes(
        table,
      )
    ) {
      continue;
    } else if (table === "workflow") {
      rows =
        await query`select count(*)::int as count from workflow where project_id is not null or is_builtin is not true`;
    } else if (["workflow_state", "workflow_transition"].includes(table)) {
      rows =
        await query`select count(*)::int as count from ${query(table)} item where not exists
        (select 1 from workflow w where w.id = item.workflow_id and w.project_id is null and w.is_builtin = true)`;
    } else if (table === "audit_entry") {
      rows =
        await query`select count(*)::int as count from audit_entry a where (${localRestoreAuditPredicate()}) is not true`;
    } else if (table === "job") {
      rows =
        await query`select count(*)::int as count from job j where (${localRestoreJobPredicate()}) is not true`;
    } else {
      rows = await query`select count(*)::int as count from ${query(table)}`;
    }
    const count = rows[0]?.count ?? 0;
    if (count) blockingTables.push({ table, rows: count });
  }
  if (blockingTables.length)
    throw new DomainError(
      "TARGET_NOT_EMPTY",
      "目标实例已包含业务数据或已完成初始化",
      { blockingTables },
    );
  return {
    empty: true,
    blockingTables,
    allowedSeedTables: [...allowedSeedTables],
  };
}

export function restoreOwnerHash(cookie: string | undefined): string {
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) throw forbidden();
  return createHash("sha256").update(cookie).digest("hex");
}

export async function getOwnedRestoreRecord(
  id: string,
  cookie: string | undefined,
): Promise<RestoreRecord> {
  const hash = restoreOwnerHash(cookie);
  const record = await getRestoreRecord(id);
  if (
    !record?.ownerSessionHash ||
    !timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(record.ownerSessionHash, "hex"),
    )
  )
    throw forbidden();
  return record;
}

export function restoreSummary(record: RestoreRecord): RestoreSummary {
  return {
    id: record.id,
    packageId: record.packageId,
    status: record.status as RestoreSummary["status"],
    mode: record.mode as RestoreSummary["mode"],
    sourceVersion: record.sourceVersion,
    manifestSummary: record.manifestSummary as Record<string, unknown> | null,
    lastError: record.lastError,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}

export async function streamRestoreUpload(
  fileStream: Readable,
  ownerSessionHash: string,
): Promise<RestoreSummary> {
  if (!/^[a-f0-9]{64}$/.test(ownerSessionHash)) throw forbidden();
  await assertBusinessEmpty();
  const maximum = restoreLimits().maxUploadBytes;
  const target = await createRestoreUploadFile(randomUUID());
  let bytes = 0;
  try {
    await pipeline(
      fileStream,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          done(
            bytes > maximum
              ? new DomainError("INVALID_BACKUP", "迁移包超过大小限制", null)
              : null,
            chunk,
          );
        },
      }),
      target.stream,
    );
    if ((fileStream as Readable & { truncated?: boolean }).truncated)
      throw new DomainError("INVALID_BACKUP", "迁移包超过大小限制", null);
    await readOuterHeader(target.path);
    const record = await createRestoreRecord({
      uploadPath: target.path,
      ownerSessionHash,
    });
    return restoreSummary(record);
  } catch (error) {
    await rm(target.path, { force: true });
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      throw new DomainError(
        "INSUFFICIENT_STORAGE",
        "目标实例磁盘空间不足",
        null,
      );
    throw error;
  }
}

function preflightSummary(
  manifest: SystemBackupManifest,
): Record<string, unknown> {
  return {
    packageId: manifest.packageId,
    mode: manifest.mode,
    sourceVersion: manifest.sourceAppVersion,
    createdAt: manifest.createdAt,
    datasetCount: manifest.datasets.length,
    totalRows: manifest.datasets.reduce(
      (sum, dataset) => sum + dataset.rows,
      0,
    ),
    blobCount: manifest.blobs.count,
    blobBytes: manifest.blobs.bytes,
    // 固定排除项与警告，绝不回显不可信manifest自由文本。
    excludedData:
      manifest.mode === "safe"
        ? [
            "sessions",
            "one_time_credentials",
            "third_party_secrets",
            "two_factor",
            "api_tokens",
          ]
        : ["sessions", "one_time_credentials"],
    warnings:
      manifest.mode === "full"
        ? ["完整迁移包含敏感凭据，请仅在可信环境使用"]
        : [],
  };
}

export async function preflightRestore(
  id: string,
  password: string,
): Promise<RestoreSummary> {
  const restore = await getRestoreRecord(id);
  if (!restore) throw forbidden();
  if (restore.status !== "UPLOADED")
    throw new DomainError("CONFLICT", "恢复状态已改变", null);
  await assertBusinessEmpty();
  const { dataKey, manifest } = await authenticateAndReadManifest(
    restore.uploadPath,
    password,
  );
  try {
    await assertBusinessEmpty();
    return restoreSummary(
      await transitionRestore(id, "UPLOADED", "PREFLIGHT_PASSED", {
        packageId: manifest.packageId,
        mode: manifest.mode,
        sourceVersion: manifest.sourceAppVersion,
        manifestSummary: preflightSummary(manifest),
        manifestHash: manifestHash(manifest),
        lastError: null,
      }),
    );
  } finally {
    dataKey.fill(0);
  }
}

/** 重试清理只删上传文件，保留控制行让本地安装审计仍可严格关联。 */
export async function discardRestoreUpload(
  record: RestoreRecord,
): Promise<void> {
  if (!["UPLOADED", "PREFLIGHT_PASSED", "FAILED"].includes(record.status))
    throw new DomainError("CONFLICT", "当前恢复状态不能删除上传", null);
  if (record.status !== "FAILED")
    await transitionRestore(
      record.id,
      record.status as "UPLOADED" | "PREFLIGHT_PASSED",
      "FAILED",
      { lastError: "上传已取消" },
    );
  await rm(record.uploadPath, { force: true });
}
