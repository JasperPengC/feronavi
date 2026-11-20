import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { job, systemBackup, systemRestore } from "../../db/schema.ts";
import {
  restoreTransitionAllowed,
  type BackupFailureCode,
  type BackupMode,
  type BackupStatus,
  type RestoreStatus,
} from "../../shared/schemas/system-backup.ts";
import { DomainError } from "../../shared/errors.ts";

export type BackupRecord = typeof systemBackup.$inferSelect;
export type RestoreRecord = typeof systemRestore.$inferSelect;

export interface CreateBackupRecordInput {
  requestedBy?: string | null;
  mode: BackupMode;
  headerDraft: object;
  expiresAt: Date;
}

export interface UpdateBackupRecordPatch {
  status?: BackupStatus;
  headerDraft?: object;
  packagePath?: string | null;
  bytes?: number | null;
  manifestSummary?: object | null;
  expiresAt?: Date;
}

export async function createBackupRecord(
  input: CreateBackupRecordInput,
): Promise<BackupRecord> {
  const rows = await db
    .insert(systemBackup)
    .values({
      requestedBy: input.requestedBy ?? null,
      mode: input.mode,
      headerDraft: input.headerDraft,
      expiresAt: input.expiresAt,
    })
    .returning();
  return rows[0]!;
}

/** 更新备份控制记录；传 expectedStatus 时使用 CAS，防止过期 worker 覆盖新状态。 */
export async function updateBackupRecord(
  id: string,
  patch: UpdateBackupRecordPatch,
  expectedStatus: BackupStatus,
): Promise<BackupRecord> {
  const rows = await db
    .update(systemBackup)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(systemBackup.id, id), eq(systemBackup.status, expectedStatus)),
    )
    .returning();
  if (rows.length !== 1)
    throw new DomainError("CONFLICT", "备份状态已改变", null);
  return rows[0]!;
}

export async function getBackupRecord(
  id: string,
): Promise<BackupRecord | null> {
  const rows = await db
    .select()
    .from(systemBackup)
    .where(eq(systemBackup.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listBackupRecords(): Promise<BackupRecord[]> {
  return db.select().from(systemBackup).orderBy(asc(systemBackup.createdAt));
}

/** Expose only explicitly whitelisted backup failure categories, never job diagnostics. */
export async function getBackupFailureCodes(
  backupIds: readonly string[],
): Promise<Map<string, BackupFailureCode>> {
  if (backupIds.length === 0) return new Map();
  const backupId = sql<string>`${job.payload}->>'backupId'`;
  const rows = await db
    .select({ backupId, lastError: job.lastError })
    .from(job)
    .where(
      and(eq(job.kind, "backup.system"), inArray(backupId, [...backupIds])),
    )
    .orderBy(desc(job.createdAt));
  const codes = new Map<string, BackupFailureCode>();
  for (const row of rows) {
    if (!row.backupId || codes.has(row.backupId)) continue;
    if (row.lastError === "任务执行租约已过期") {
      codes.set(row.backupId, "BACKUP_INTERRUPTED");
      continue;
    }
    const match = /^系统备份失败（([A-Z_]+)）$/u.exec(row.lastError ?? "");
    codes.set(
      row.backupId,
      match?.[1] === "INSUFFICIENT_STORAGE"
        ? "INSUFFICIENT_STORAGE"
        : "BACKUP_FAILED",
    );
  }
  return codes;
}

export async function deleteBackupRecord(
  id: string,
): Promise<BackupRecord | null> {
  const rows = await db
    .delete(systemBackup)
    .where(
      and(
        eq(systemBackup.id, id),
        sql`${systemBackup.status} not in ('PENDING','RUNNING')`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** 原子消费一次有限下载授权；并发请求不会超过上限。 */
export async function consumeBackupDownload(
  id: string,
  now = new Date(),
): Promise<BackupRecord | null> {
  const rows = await db
    .update(systemBackup)
    .set({
      downloadCount: sql`${systemBackup.downloadCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(systemBackup.id, id),
        eq(systemBackup.status, "SUCCEEDED"),
        gt(systemBackup.expiresAt, now),
        sql`${systemBackup.downloadCount} < 5`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function deleteBackupRecordById(id: string): Promise<void> {
  await db.delete(systemBackup).where(eq(systemBackup.id, id));
}

export interface CreateRestoreRecordInput {
  packageId?: string | null;
  uploadPath: string;
  ownerSessionHash?: string | null;
  mode?: BackupMode | null;
  sourceVersion?: string | null;
  manifestSummary?: object | null;
}

export async function createRestoreRecord(
  input: CreateRestoreRecordInput,
): Promise<RestoreRecord> {
  const rows = await db
    .insert(systemRestore)
    .values({
      packageId: input.packageId ?? null,
      uploadPath: input.uploadPath,
      ownerSessionHash: input.ownerSessionHash ?? null,
      mode: input.mode ?? null,
      sourceVersion: input.sourceVersion ?? null,
      manifestSummary: input.manifestSummary ?? null,
    })
    .returning();
  return rows[0]!;
}

export type RestoreTransitionPatch = Partial<
  Pick<
    RestoreRecord,
    | "packageId"
    | "mode"
    | "sourceVersion"
    | "manifestSummary"
    | "manifestHash"
    | "lastError"
    | "completedAt"
  >
>;

/** 严格按 id + 预期状态 CAS 流转；非法流转或并发冲突统一返回 CONFLICT。 */
export async function transitionRestore(
  id: string,
  from: RestoreStatus,
  to: RestoreStatus,
  patch: RestoreTransitionPatch = {},
): Promise<RestoreRecord> {
  if (!restoreTransitionAllowed(from, to)) {
    throw new DomainError(
      "CONFLICT",
      `恢复状态不能从 ${from} 转为 ${to}`,
      null,
    );
  }
  const rows = await db
    .update(systemRestore)
    .set({ ...patch, status: to, updatedAt: new Date() })
    .where(and(eq(systemRestore.id, id), eq(systemRestore.status, from)))
    .returning();
  if (rows.length !== 1)
    throw new DomainError("CONFLICT", "恢复状态已改变", null);
  return rows[0]!;
}

export async function getRestoreRecord(
  id: string,
): Promise<RestoreRecord | null> {
  const rows = await db
    .select()
    .from(systemRestore)
    .where(eq(systemRestore.id, id))
    .limit(1);
  return rows[0] ?? null;
}
