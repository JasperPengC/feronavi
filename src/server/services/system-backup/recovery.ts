import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { job, systemBackup } from "../../../db/schema.ts";
import { writeSecurityAudit } from "../audit.service.ts";
import { cleanupInterruptedBackupArtifacts } from "./storage.ts";

/** Fail interrupted one-shot backup attempts after job lease recovery. */
export async function reconcileInterruptedSystemBackups(): Promise<number> {
  const failed = await db.transaction(async (tx) => {
    const backups = await tx
      .select({
        id: systemBackup.id,
        requestedBy: systemBackup.requestedBy,
        status: systemBackup.status,
      })
      .from(systemBackup)
      .where(inArray(systemBackup.status, ["RUNNING", "FAILED"]))
      .orderBy(systemBackup.id)
      .for("update");
    const reconciled: typeof backups = [];

    for (const backup of backups) {
      const backupJobs = await tx
        .select({
          status: job.status,
          payload: job.payload,
          hasLiveLease: sql<boolean>`${job.lockedAt} is not null and ${job.lockedAt} >= now() - interval '10 minutes'`,
        })
        .from(job)
        .where(
          and(
            eq(job.kind, "backup.system"),
            sql`${job.payload}->>'backupId' = ${backup.id}`,
          ),
        )
        .for("update");
      if (
        backupJobs.some(
          (row) =>
            row.status === "PENDING" ||
            (row.status === "RUNNING" && row.hasLiveLease),
        )
      )
        continue;

      await cleanupInterruptedBackupArtifacts(
        backup.id,
        backupJobs.flatMap((row) => {
          const handle = (row.payload as { dataKeyHandle?: unknown })
            .dataKeyHandle;
          return typeof handle === "string" ? [handle] : [];
        }),
      );
      if (backup.status === "FAILED") continue;
      const rows = await tx
        .update(systemBackup)
        .set({ status: "FAILED", updatedAt: sql`now()` })
        .where(
          and(
            eq(systemBackup.id, backup.id),
            eq(systemBackup.status, "RUNNING"),
          ),
        )
        .returning({ id: systemBackup.id });
      if (rows.length === 1) reconciled.push(backup);
    }
    return reconciled;
  });

  for (const backup of failed) {
    await writeSecurityAudit({
      actorId: backup.requestedBy,
      action: "system_backup.failed",
      targetType: "SYSTEM_BACKUP",
      targetId: backup.id,
      changes: { status: "FAILED", type: "WORKER_INTERRUPTED" },
    });
  }
  return failed.length;
}
