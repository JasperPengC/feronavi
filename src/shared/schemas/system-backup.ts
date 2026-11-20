import { z } from "zod";

export const backupModeSchema = z.enum(["safe", "full"]);
export type BackupMode = z.infer<typeof backupModeSchema>;

export const keyDerivationSchema = z.object({
  name: z.literal("scrypt"),
  N: z.literal(65_536),
  r: z.literal(8),
  p: z.literal(1),
  keyBytes: z.literal(32),
  saltBytes: z.literal(16),
  maxmem: z.literal(134_217_728),
});

export const keyEnvelopeSchema = z.object({
  kdf: keyDerivationSchema,
  salt: z.string(),
  wrapNonce: z.string(),
  wrappedKey: z.string(),
  wrapTag: z.string(),
});
export type KeyEnvelope = z.infer<typeof keyEnvelopeSchema>;

export const payloadEncryptionSchema = z.object({
  payloadNonce: z.string(),
  payloadTag: z.string(),
});
export type PayloadEncryption = z.infer<typeof payloadEncryptionSchema>;

export const systemBackupHeaderSchema = z.object({
  format: z.literal("feronavi-system-backup"),
  formatVersion: z.literal(1),
  createdAt: z.string().datetime(),
  payloadBytes: z.number().int().nonnegative(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  encryption: keyEnvelopeSchema.merge(payloadEncryptionSchema),
});
export type SystemBackupHeader = z.infer<typeof systemBackupHeaderSchema>;

export const restoreStatusSchema = z.enum([
  "UPLOADED",
  "PREFLIGHT_PASSED",
  "RESTORING",
  "SUCCEEDED",
  "FAILED",
]);
export type RestoreStatus = z.infer<typeof restoreStatusSchema>;

export const postRestoreRebuildSummarySchema = z.object({
  status: z.enum(["NOT_STARTED", "PENDING", "RUNNING", "SUCCEEDED", "FAILED"]),
  message: z.string(),
  canRetry: z.boolean(),
});
export type PostRestoreRebuildSummary = z.infer<
  typeof postRestoreRebuildSummarySchema
>;

export const currentRestoreRebuildSchema = z.object({
  packageId: z.string().uuid(),
  rebuild: postRestoreRebuildSummarySchema,
});
export type CurrentRestoreRebuild = z.infer<typeof currentRestoreRebuildSchema>;

export const backupStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const backupFailureCodeSchema = z.enum([
  "INSUFFICIENT_STORAGE",
  "BACKUP_INTERRUPTED",
  "BACKUP_FAILED",
]);
export type BackupFailureCode = z.infer<typeof backupFailureCodeSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const datasetManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9_.-]+$/),
  schemaVersion: z.number().int().positive(),
  path: z.string().startsWith("data/"),
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema,
  dependsOn: z.array(z.string()),
});
export type DatasetManifest = z.infer<typeof datasetManifestSchema>;

export const manifestSchema = z.object({
  format: z.literal("feronavi-system-backup"),
  formatVersion: z.literal(1),
  dataSchemaVersion: z.literal(1),
  packageId: z.string().uuid(),
  mode: backupModeSchema,
  createdAt: z.string().datetime(),
  sourceAppVersion: z.string(),
  sourceBuild: z.string(),
  sourceDatabaseRevision: z.string(),
  requiredFeatures: z.array(z.string()),
  capabilities: z.array(z.string()),
  datasets: z.array(datasetManifestSchema),
  blobs: z.object({
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    entries: z.array(
      z.object({
        sha256: sha256Schema,
        bytes: z.number().int().nonnegative(),
        path: z.string().startsWith("blobs/"),
      }),
    ),
  }),
  excludedData: z.array(z.object({ key: z.string(), reason: z.string() })),
  encryptionRewrapVersion: z.literal(1),
});
export type SystemBackupManifest = z.infer<typeof manifestSchema>;

const migrationPasswordSchema = z.string().min(12).max(256);

export const createSystemBackupSchema = z.object({
  mode: backupModeSchema.default("safe"),
  migrationPassword: migrationPasswordSchema,
  currentPassword: z.string().min(1),
  totpCode: z.string().optional(),
});

export const backupPreflightSchema = z.object({
  mode: backupModeSchema.default("safe"),
});
export const restorePreflightSchema = z.object({
  migrationPassword: migrationPasswordSchema,
});
export const restoreConfirmSchema = z.object({
  migrationPassword: migrationPasswordSchema,
  confirmation: z.literal("恢复此实例"),
});

export const excludedDataSchema = z.object({
  key: z.string(),
  reason: z.string(),
});
export const backupPreflightResponseSchema = z.object({
  mode: backupModeSchema,
  datasets: z.array(
    z.object({ name: z.string(), rows: z.number().int().nonnegative() }),
  ),
  totalRows: z.number().int().nonnegative(),
  blobCount: z.number().int().nonnegative(),
  blobBytes: z.number().int().nonnegative(),
  excludedData: z.array(excludedDataSchema),
  warnings: z.array(z.string()),
});

export const backupSummarySchema = z.object({
  id: z.string().uuid(),
  mode: backupModeSchema,
  status: backupStatusSchema,
  failureCode: backupFailureCodeSchema.nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  manifestSummary: z.record(z.string(), z.unknown()).nullable(),
  downloadsRemaining: z.number().int().min(0).max(5),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BackupSummary = z.infer<typeof backupSummarySchema>;

export const restoreSummarySchema = z.object({
  id: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
  status: restoreStatusSchema,
  mode: backupModeSchema.nullable(),
  sourceVersion: z.string().nullable(),
  manifestSummary: z.record(z.string(), z.unknown()).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  rebuild: postRestoreRebuildSummarySchema.nullable().optional(),
});
export type RestoreSummary = z.infer<typeof restoreSummarySchema>;

export const createSystemBackupResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("PENDING"),
});
export const restorePreflightResponseSchema = restoreSummarySchema;
export const restoreConfirmResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("RESTORING"),
});

const RESTORE_TRANSITIONS: Record<RestoreStatus, ReadonlySet<RestoreStatus>> = {
  UPLOADED: new Set(["PREFLIGHT_PASSED", "FAILED"]),
  PREFLIGHT_PASSED: new Set(["RESTORING", "FAILED"]),
  RESTORING: new Set(["SUCCEEDED", "FAILED"]),
  SUCCEEDED: new Set(),
  FAILED: new Set(),
};

export function restoreTransitionAllowed(
  from: RestoreStatus,
  to: RestoreStatus,
): boolean {
  return RESTORE_TRANSITIONS[from].has(to);
}
