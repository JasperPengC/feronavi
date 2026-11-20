import { db } from "../../../db/index.ts";
import { auditEntry, job, setupState } from "../../../db/schema.ts";
import { DomainError } from "../../../shared/errors.ts";
import {
  getRestoreRecord,
  transitionRestore,
} from "../../repos/system-transfer.repo.ts";
import {
  assertBusinessEmpty,
  manifestHash,
  restoreSummary,
} from "./validator.ts";
import {
  authenticateAndReadManifest,
  withAuthenticatedRestoreArchive,
} from "./restore-archive.ts";
import {
  consumeTemporaryKeyHandle,
  discardTemporaryKeyHandle,
  writeTemporaryKeyHandle,
} from "./storage.ts";
import {
  assertImportCapability,
  classifyRestoreError,
  importDatasets,
} from "./import-data.ts";
import { assertNotRestoring, withSystemRestoreLock } from "./restore-lock.ts";
import {
  cleanupRestoreBlobs,
  stageRestoreBlobs,
  promoteRestoreBlobs,
  rollbackPromotedBlobs,
  type StagedRestoreBlobs,
} from "./attachment-blobs.ts";
import { logRestoreCleanupFailure } from "./restore-recovery.ts";
import { masterKey } from "../crypto.service.ts";
import { readSourceMasterKey } from "./secret-rewrap.ts";
import { ensurePostRestoreRebuilds } from "./post-restore-rebuild.ts";

async function restoreAudit(
  id: string,
  action: "started" | "completed" | "failed",
  errorCode?: string,
) {
  await db.insert(auditEntry).values({
    actorId: null,
    actorSnapshot: "setup",
    severity: "SECURITY",
    action: `system_restore.${action}`,
    targetType: "system_restore",
    targetId: id,
    changes: errorCode ? { errorCode } : null,
  });
}

/** 不持久化密码；每次确认重新认证完整归档，只有目标主密钥封装的一次性opaque句柄进入job。 */
export async function confirmSystemRestore(id: string, password: string) {
  return withSystemRestoreLock(async () => {
    await assertNotRestoring();
    const record = await getRestoreRecord(id);
    if (!record || record.status !== "PREFLIGHT_PASSED")
      throw new DomainError("CONFLICT", "恢复状态已改变", null);
    await assertBusinessEmpty();
    let dataKey: Buffer | undefined;
    let handle: string | undefined;
    let enqueued = false;
    try {
      const authenticated = await authenticateAndReadManifest(
        record.uploadPath,
        password,
      );
      dataKey = authenticated.dataKey;
      const { manifest } = authenticated;
      if (
        !record.manifestHash ||
        record.manifestHash !== manifestHash(manifest) ||
        record.packageId !== manifest.packageId ||
        record.mode !== manifest.mode
      )
        throw new DomainError("INVALID_BACKUP", "迁移包在预检后发生变化", null);
      assertImportCapability(manifest);
      await assertBusinessEmpty();
      handle = (await writeTemporaryKeyHandle(id, dataKey)).handle;
      const summary = await db.transaction(async () => {
        const restoring = await transitionRestore(
          id,
          "PREFLIGHT_PASSED",
          "RESTORING",
          { lastError: null },
        );
        await db.insert(job).values({
          kind: "restore.system",
          payload: { restoreId: id, dataKeyHandle: handle },
          dedupeKey: `restore.system:${id}`,
          maxAttempts: 1,
        });
        await restoreAudit(id, "started");
        return restoreSummary(restoring);
      });
      enqueued = true;
      return summary;
    } finally {
      dataKey?.fill(0);
      if (handle && !enqueued) await discardTemporaryKeyHandle(handle);
    }
  }).catch((error) => {
    if (error instanceof DomainError && error.code === "CONFLICT") throw error;
    throw classifyRestoreError(error);
  });
}

/** 在认证ZIP回调内stage，导入事务内promote，提交失败补偿。
 * 在插入前用目标密钥重封装秘密，源密钥只在认证回调内存活。
 */
export async function importSystemBackup(input: {
  restoreId: string;
  dataKeyHandle: string;
}): Promise<void> {
  return withSystemRestoreLock(async () => {
    const record = await getRestoreRecord(input.restoreId);
    if (!record || record.status !== "RESTORING")
      throw new DomainError("CONFLICT", "恢复状态已改变", null);
    let dataKey: Buffer | undefined;
    let sourceKey: Buffer | undefined;
    let targetKey: Buffer | undefined;
    let staged: StagedRestoreBlobs | undefined;
    let preserveForRecovery = false;
    try {
      dataKey = await consumeTemporaryKeyHandle(input.dataKeyHandle);
      await assertBusinessEmpty();
      await withAuthenticatedRestoreArchive(
        record.uploadPath,
        dataKey,
        async (path, manifest, releaseArchive) => {
          if (
            !record.manifestHash ||
            manifestHash(manifest) !== record.manifestHash ||
            manifest.packageId !== record.packageId
          )
            throw new DomainError(
              "INVALID_BACKUP",
              "迁移包在确认后发生变化",
              null,
            );
          assertImportCapability(manifest);
          try {
            if (manifest.mode === "full") {
              sourceKey = await readSourceMasterKey(path);
              targetKey = Buffer.from(masterKey());
            }
            staged = await stageRestoreBlobs(record.id, path, manifest.blobs);
            await db.transaction(async () => {
              await assertBusinessEmpty();
              await importDatasets(
                path,
                manifest,
                sourceKey && targetKey ? { sourceKey, targetKey } : undefined,
              );
              await promoteRestoreBlobs(staged!, manifest.packageId);
              // 清理失败也必须在业务事务内失败，不能在已初始化后改报恢复失败。
              await releaseArchive();
              await db.delete(setupState);
              await db.insert(setupState).values({
                initializedAt: new Date(),
                currentStep: 6,
                restoredPackageId: manifest.packageId,
              });
              await transitionRestore(record.id, "RESTORING", "SUCCEEDED", {
                completedAt: new Date(),
                lastError: null,
              });
              await restoreAudit(record.id, "completed");
            });
            await ensurePostRestoreRebuilds(manifest.packageId);
            // 业务已经提交；清理错误仅记录固定分类，由启动协调重试，不能改报FAILED。
            await cleanupRestoreBlobs(
              record.id,
              manifest.packageId,
              true,
            ).catch((error) =>
              logRestoreCleanupFailure(classifyRestoreError(error).code),
            );
          } catch (error) {
            if (staged) {
              // COMMIT回执可能丢失。读取提交证明之前不能删除本次附件或写FAILED。
              preserveForRecovery = true;
              const [setup] = await db
                .select()
                .from(setupState)
                .limit(1)
                .catch((proofError) => {
                  throw classifyRestoreError(proofError);
                });
              if (
                setup?.initializedAt &&
                setup.restoredPackageId === manifest.packageId
              ) {
                // 丢失COMMIT回执也已由目标marker确认，补队失败不得改报恢复失败。
                await ensurePostRestoreRebuilds(manifest.packageId);
                await cleanupRestoreBlobs(
                  record.id,
                  manifest.packageId,
                  true,
                ).catch((cleanupError) =>
                  logRestoreCleanupFailure(
                    classifyRestoreError(cleanupError).code,
                  ),
                );
                return;
              }
              preserveForRecovery = false;
              await rollbackPromotedBlobs(staged).catch((cleanupError) =>
                logRestoreCleanupFailure(
                  classifyRestoreError(cleanupError).code,
                ),
              );
            }
            throw classifyRestoreError(error);
          }
        },
      );
    } catch (error) {
      const failure = classifyRestoreError(error);
      if (preserveForRecovery) throw failure;
      await db.transaction(async () => {
        await transitionRestore(record.id, "RESTORING", "FAILED", {
          lastError: `${failure.code}: ${failure.message}`,
          completedAt: new Date(),
        });
        await restoreAudit(record.id, "failed", failure.code);
      });
      throw failure;
    } finally {
      dataKey?.fill(0);
      sourceKey?.fill(0);
      targetKey?.fill(0);
      await discardTemporaryKeyHandle(input.dataKeyHandle);
    }
  });
}
