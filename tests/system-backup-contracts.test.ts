import { describe, expect, it } from "vitest";
import {
  backupModeSchema,
  backupPreflightSchema,
  createSystemBackupSchema,
  manifestSchema,
  restoreConfirmSchema,
  restoreTransitionAllowed,
} from "../src/shared/schemas/system-backup.ts";

describe("system backup contracts", () => {
  it("只接受 safe/full 与 v1 manifest", () => {
    expect(backupModeSchema.parse("safe")).toBe("safe");
    expect(() => backupModeSchema.parse("raw-db")).toThrow();
    expect(manifestSchema.parse({
      format: "feronavi-system-backup",
      formatVersion: 1,
      dataSchemaVersion: 1,
      packageId: "00000000-0000-4000-8000-000000000001",
      mode: "safe",
      createdAt: "2026-11-14T00:00:00.000Z",
      sourceAppVersion: "1.0.0",
      sourceBuild: "test",
      sourceDatabaseRevision: "0061",
      requiredFeatures: [],
      capabilities: [],
      datasets: [],
      blobs: { count: 0, bytes: 0, entries: [] },
      excludedData: [],
      encryptionRewrapVersion: 1,
    }).formatVersion).toBe(1);
  });

  it("拒绝跳过预检直接恢复", () => {
    expect(restoreTransitionAllowed("UPLOADED", "RESTORING")).toBe(false);
    expect(restoreTransitionAllowed("PREFLIGHT_PASSED", "RESTORING")).toBe(true);
    expect(restoreTransitionAllowed("UPLOADED", "PREFLIGHT_PASSED")).toBe(true);
    expect(restoreTransitionAllowed("PREFLIGHT_PASSED", "FAILED")).toBe(true);
    expect(restoreTransitionAllowed("RESTORING", "SUCCEEDED")).toBe(true);
    expect(restoreTransitionAllowed("RESTORING", "FAILED")).toBe(true);
    expect(restoreTransitionAllowed("SUCCEEDED", "FAILED")).toBe(false);
    expect(restoreTransitionAllowed("FAILED", "UPLOADED")).toBe(false);
  });

  it("限制迁移密码长度并要求固定恢复确认短语", () => {
    expect(createSystemBackupSchema.safeParse({
      mode: "safe",
      migrationPassword: "123456789012",
      currentPassword: "current",
    }).success).toBe(true);
    expect(createSystemBackupSchema.safeParse({
      mode: "safe",
      migrationPassword: "too-short",
      currentPassword: "current",
    }).success).toBe(false);
    expect(restoreConfirmSchema.safeParse({
      migrationPassword: "123456789012",
      confirmation: "恢复此实例",
    }).success).toBe(true);
    expect(restoreConfirmSchema.safeParse({
      migrationPassword: "123456789012",
      confirmation: "恢复实例",
    }).success).toBe(false);
  });

  it("备份和预检默认 safe，同时保留显式 full", () => {
    expect(createSystemBackupSchema.parse({
      migrationPassword: "123456789012",
      currentPassword: "current",
    }).mode).toBe("safe");
    expect(createSystemBackupSchema.parse({
      mode: "full",
      migrationPassword: "123456789012",
      currentPassword: "current",
    }).mode).toBe("full");
    expect(backupPreflightSchema.parse({}).mode).toBe("safe");
    expect(backupPreflightSchema.parse({ mode: "full" }).mode).toBe("full");
    expect(() => manifestSchema.parse({ mode: undefined })).toThrow();
  });
});
