import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  backupPreflightSchema,
  createSystemBackupSchema,
} from "../../shared/schemas/system-backup.ts";
import type { BackupFailureCode } from "../../shared/schemas/system-backup.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import { writeSecurityAudit } from "../services/audit.service.ts";
import { verifyAdminReauth } from "../services/admin-reauth.service.ts";
import { createEncryptionEnvelope } from "../services/system-backup/crypto.ts";
import { estimateSystemBackup } from "../services/system-backup/exporter.ts";
import { assertRecoverableLocalAdmin } from "../services/system-backup/registry.ts";
import {
  backupPath,
  discardTemporaryKeyHandle,
  writeTemporaryKeyHandle,
} from "../services/system-backup/storage.ts";
import { enqueue } from "../services/job.service.ts";
import {
  consumeBackupDownload,
  createBackupRecord,
  deleteBackupRecord,
  deleteBackupRecordById,
  getBackupFailureCodes,
  getBackupRecord,
  listBackupRecords,
} from "../repos/system-transfer.repo.ts";
import { rm } from "node:fs/promises";
import {
  getCurrentPostRestoreRebuild,
  getPostRestoreRebuildSummary,
  retryPostRestoreRebuilds,
} from "../services/system-backup/post-restore-rebuild.ts";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

const DOWNLOAD_LIMIT = 5;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const idSchema = z.object({ id: z.string().uuid() });

function actorOf(req: { actor?: Actor }): Actor {
  if (!req.actor) throw forbidden();
  return req.actor;
}

function requireBackupPermission(actor: Actor): void {
  if (
    !can(
      actor,
      "setting:manage",
      { projectId: null, teamId: null },
      {
        memberProjectIds: new Set(),
        memberTeamIds: new Set(),
        memberId: actor.memberId,
      },
    )
  )
    throw forbidden();
}

function summary(
  record: Awaited<ReturnType<typeof getBackupRecord>> extends infer R
    ? NonNullable<R>
    : never,
  failureCode: BackupFailureCode | null = null,
) {
  return {
    id: record.id,
    mode: record.mode as "safe" | "full",
    status: record.status as "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED",
    failureCode:
      record.status === "FAILED" ? (failureCode ?? "BACKUP_FAILED") : null,
    bytes: record.bytes,
    manifestSummary: record.manifestSummary as Record<string, unknown> | null,
    downloadsRemaining: Math.max(0, DOWNLOAD_LIMIT - record.downloadCount),
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function registerSystemBackupRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/system/restores/current", async (req, reply) => {
    requireBackupPermission(actorOf(req));
    reply.header("cache-control", "no-store");
    return getCurrentPostRestoreRebuild();
  });
  app.get("/api/v1/system/restores/:packageId/rebuild", async (req) => {
    requireBackupPermission(actorOf(req));
    const { packageId } = z
      .object({ packageId: z.string().uuid() })
      .parse(req.params);
    return getPostRestoreRebuildSummary(packageId);
  });
  app.post(
    "/api/v1/system/restores/:packageId/rebuild/retry",
    { onRequest: app.csrfProtection },
    async (req) => {
      requireBackupPermission(actorOf(req));
      const { packageId } = z
        .object({ packageId: z.string().uuid() })
        .parse(req.params);
      return retryPostRestoreRebuilds(packageId);
    },
  );
  app.post(
    "/api/v1/system/backups/preflight",
    { onRequest: app.csrfProtection },
    async (req) => {
      const actor = actorOf(req);
      requireBackupPermission(actor);
      const parsed = backupPreflightSchema.safeParse(req.body);
      if (!parsed.success)
        throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
      const estimate = await estimateSystemBackup(parsed.data.mode);
      const response = {
        mode: estimate.mode,
        datasets: estimate.datasets,
        totalRows: estimate.totalRows,
        blobCount: estimate.blobCount,
        blobBytes: estimate.blobBytes,
        excludedData: estimate.excludedData,
        warnings:
          estimate.mode === "full"
            ? ["完整迁移包含敏感凭据，请仅在可信环境使用"]
            : [],
      };
      await writeSecurityAudit({
        actorId: actor.memberId,
        actorSnapshot: actor.username,
        action: "system_backup.preflighted",
        targetType: "SYSTEM_BACKUP",
        changes: {
          mode: estimate.mode,
          totalRows: estimate.totalRows,
          blobCount: estimate.blobCount,
        },
      });
      return response;
    },
  );

  app.post(
    "/api/v1/system/backups",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const actor = actorOf(req);
      requireBackupPermission(actor);
      const parsed = createSystemBackupSchema.safeParse(req.body);
      if (!parsed.success)
        throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
      await verifyAdminReauth(actor, {
        currentPassword: parsed.data.currentPassword,
        totpCode: parsed.data.totpCode,
        ip: req.ip,
      });
      await assertRecoverableLocalAdmin(parsed.data.mode);

      const { dataKey, keyEnvelope } = await createEncryptionEnvelope(
        parsed.data.migrationPassword,
      );
      let handle: string | undefined;
      let backupId: string | undefined;
      try {
        const record = await createBackupRecord({
          requestedBy: actor.memberId,
          mode: parsed.data.mode,
          headerDraft: keyEnvelope,
          expiresAt: new Date(Date.now() + RETENTION_MS),
        });
        backupId = record.id;
        const key = await writeTemporaryKeyHandle(record.id, dataKey);
        handle = key.handle;
        const job = await enqueue({
          kind: "backup.system",
          payload: { backupId: record.id, dataKeyHandle: key.handle },
          maxAttempts: 1,
        });
        if (!job) throw new Error("backup job was not enqueued");
        await writeSecurityAudit({
          actorId: actor.memberId,
          actorSnapshot: actor.username,
          action: "system_backup.created",
          targetType: "SYSTEM_BACKUP",
          targetId: record.id,
          changes: { mode: record.mode, status: record.status },
        });
        reply.status(201);
        return { id: record.id, status: "PENDING" as const };
      } catch (error) {
        if (handle) await discardTemporaryKeyHandle(handle);
        if (backupId) {
          await rm(backupPath(backupId), { force: true }).catch(() => {});
          await deleteBackupRecordById(backupId).catch(() => {});
        }
        throw error;
      } finally {
        dataKey.fill(0);
      }
    },
  );

  app.get("/api/v1/system/backups", async (req) => {
    const actor = actorOf(req);
    requireBackupPermission(actor);
    const records = await listBackupRecords();
    const failureCodes = await getBackupFailureCodes(
      records
        .filter((record) => record.status === "FAILED")
        .map((record) => record.id),
    );
    return {
      backups: records.map((record) =>
        summary(record, failureCodes.get(record.id) ?? null),
      ),
    };
  });

  app.get("/api/v1/system/backups/:id", async (req) => {
    const actor = actorOf(req);
    requireBackupPermission(actor);
    const { id } = idSchema.parse(req.params);
    const record = await getBackupRecord(id);
    if (!record) throw forbidden();
    const failureCodes = await getBackupFailureCodes([record.id]);
    return summary(record, failureCodes.get(record.id) ?? null);
  });

  app.get("/api/v1/system/backups/:id/download", async (req, reply) => {
    const actor = actorOf(req);
    requireBackupPermission(actor);
    const { id } = idSchema.parse(req.params);
    const current = await getBackupRecord(id);
    if (
      !current ||
      current.status !== "SUCCEEDED" ||
      current.expiresAt.getTime() <= Date.now()
    )
      throw forbidden();
    if (current.downloadCount >= DOWNLOAD_LIMIT) {
      throw new DomainError("CONFLICT", "下载次数已用完，请重新生成备份包", {
        downloadsRemaining: 0,
      });
    }
    const authorized = await consumeBackupDownload(id);
    if (!authorized) {
      const latest = await getBackupRecord(id);
      if (
        latest?.status === "SUCCEEDED" &&
        latest.expiresAt.getTime() > Date.now() &&
        latest.downloadCount >= DOWNLOAD_LIMIT
      ) {
        throw new DomainError("CONFLICT", "下载次数已用完，请重新生成备份包", {
          downloadsRemaining: 0,
        });
      }
      throw forbidden();
    }
    await writeSecurityAudit({
      actorId: actor.memberId,
      actorSnapshot: actor.username,
      action: "system_backup.downloaded",
      targetType: "SYSTEM_BACKUP",
      targetId: id,
      changes: {
        mode: authorized.mode,
        downloadsRemaining: DOWNLOAD_LIMIT - authorized.downloadCount,
      },
    });
    return reply
      .header("content-type", "application/vnd.feronavi.backup+zip")
      .header(
        "content-disposition",
        `attachment; filename="feronavi-system-backup-${id}.fnbak"`,
      )
      .header("cache-control", "no-store")
      .send(createReadStream(authorized.packagePath ?? backupPath(id)));
  });

  app.delete(
    "/api/v1/system/backups/:id",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const actor = actorOf(req);
      requireBackupPermission(actor);
      const { id } = idSchema.parse(req.params);
      const record = await deleteBackupRecord(id);
      if (!record) throw forbidden();
      await rm(record.packagePath ?? backupPath(id), { force: true }).catch(
        () => {},
      );
      await writeSecurityAudit({
        actorId: actor.memberId,
        actorSnapshot: actor.username,
        action: "system_backup.deleted",
        targetType: "SYSTEM_BACKUP",
        targetId: id,
        changes: { mode: record.mode, status: record.status },
      });
      return reply.status(204).send();
    },
  );
}
