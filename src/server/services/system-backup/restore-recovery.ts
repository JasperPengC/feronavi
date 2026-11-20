import { inArray } from "drizzle-orm";
import { db, sql } from "../../../db/index.ts";
import { auditEntry, setupState, systemRestore } from "../../../db/schema.ts";
import { transitionRestore } from "../../repos/system-transfer.repo.ts";
import { cleanupRestoreBlobs } from "./attachment-blobs.ts";
import { classifyRestoreError } from "./import-data.ts";
import { tryWithSystemRestoreLock } from "./restore-lock.ts";
import { localRestoreJobPredicate } from "./validator.ts";
import {
  discardTemporaryKeyHandlesForOwner,
  pruneSystemTransferFiles,
} from "./storage.ts";
import { ensurePostRestoreRebuilds } from "./post-restore-rebuild.ts";

export type RestoreCleanupLogger = (code: string) => void;
export const logRestoreCleanupFailure: RestoreCleanupLogger = (code) => {
  console.error("系统恢复清理失败", { code });
};

/** 与确认、worker、安装共用固定try-lock；锁忙表明另一个实例仍在运行，直接跳过。
 * 只扫描控制行，FAILED/SUCCEEDED也重试遗留清理，绝不凭目录名推断任务。
 */
export async function recoverInterruptedRestores(
  log: RestoreCleanupLogger = logRestoreCleanupFailure,
): Promise<void> {
  try {
    await tryWithSystemRestoreLock(async () => {
      const records = await db
        .select()
        .from(systemRestore)
        .where(
          inArray(systemRestore.status, ["RESTORING", "FAILED", "SUCCEEDED"]),
        );
      const [setup] = await db.select().from(setupState).limit(1);
      for (const record of records) {
        const committed =
          !!setup?.initializedAt &&
          !!record.packageId &&
          setup.restoredPackageId === record.packageId;
        if (record.status === "RESTORING" && !committed) {
          // confirm入队提交与worker领取之间同样释放固定锁；正常排队不是中断。
          const resumable = await sql`select 1 from job j
            where (${localRestoreJobPredicate()})
              and j.payload->>'restoreId' = ${record.id}
              and (j.status = 'PENDING' or (j.status = 'RUNNING'
                and j.locked_by is not null
                and j.locked_at >= now() - interval '10 minutes')) limit 1`;
          if (resumable.length) continue;
        }
        let cleanupError: unknown;
        try {
          await cleanupRestoreBlobs(record.id, record.packageId, committed);
          await discardTemporaryKeyHandlesForOwner(record.id);
        } catch (error) {
          cleanupError = error;
          log(classifyRestoreError(error).code);
        }
        if (record.status !== "RESTORING") {
          if (committed && record.status === "SUCCEEDED")
            await ensurePostRestoreRebuilds(record.packageId!);
          continue;
        }
        try {
          const failure = classifyRestoreError(cleanupError);
          await db.transaction(async () => {
            await transitionRestore(
              record.id,
              "RESTORING",
              committed ? "SUCCEEDED" : "FAILED",
              {
                completedAt: new Date(),
                lastError: committed
                  ? null
                  : `${failure.code}: ${failure.message}`,
              },
            );
            await db.insert(auditEntry).values({
              actorId: null,
              actorSnapshot: "setup",
              severity: "SECURITY",
              action: committed
                ? "system_restore.completed"
                : "system_restore.failed",
              targetType: "system_restore",
              targetId: record.id,
              changes: committed ? null : { errorCode: failure.code },
            });
          });
          if (committed) await ensurePostRestoreRebuilds(record.packageId!);
        } catch (error) {
          log(classifyRestoreError(error).code);
        }
      }
      // Task6随机preflight明文目录也沿现有保留期清理，保留所有活跃会话/句柄。
      try {
        await pruneSystemTransferFiles();
      } catch (error) {
        log(classifyRestoreError(error).code);
      }
    });
  } catch (error) {
    log(classifyRestoreError(error).code);
  }
}
