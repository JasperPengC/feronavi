/**
 * 内置任务处理器（Round 25 第 45 项）
 *
 * 注册邮件、IM 通知和全量导出处理器，交给可重试队列执行。
 * 未配置邮件发送视为**成功跳过**（不是失败）—— 自托管实例可能永远不配邮件，
 * 不能因此把队列堆成死信。
 */
import { registerJobHandler, registerJobRecovery } from "./job.service.ts";
import { sendMail } from "./mail.service.ts";
import { writeFullExportPackage } from "./full-export.service.ts";
import { sendToChannel } from "./im.service.ts";
import { z } from "zod";
import { keyEnvelopeSchema } from "../../shared/schemas/system-backup.ts";
import { exportSystemBackup } from "./system-backup/exporter.ts";
import {
  cleanupInterruptedBackupArtifacts,
  discardTemporaryKeyHandle,
} from "./system-backup/storage.ts";
import {
  getBackupRecord,
  updateBackupRecord,
} from "../repos/system-transfer.repo.ts";
import { writeSecurityAudit } from "./audit.service.ts";
import { DomainError } from "../../shared/errors.ts";
import { importSystemBackup } from "./system-backup/importer.ts";
import { runPostRestoreRebuild } from "./system-backup/post-restore-rebuild.ts";

import { recoverInterruptedRestores } from "./system-backup/restore-recovery.ts";
import { reconcileInterruptedSystemBackups } from "./system-backup/recovery.ts";
import { registerAssistantExternalActionJobs } from "./assistant-external-action.service.ts";

export function registerBuiltinJobHandlers(): void {
  registerAssistantExternalActionJobs();
  registerJobRecovery("system-transfer", async () => {
  // 启动时仍有有效租约的恢复可能稍后才过期；协调内部隔离清理故障，锁忙跳过。
  await recoverInterruptedRestores();
  try {
    await reconcileInterruptedSystemBackups();
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    const classification =
      typeof code === "string" &&
      ["EACCES", "EPERM", "ENOTDIR", "EIO", "ENOSPC", "EROFS"].includes(code)
        ? code
        : "BACKUP_RECOVERY_FAILED";
    console.error("[job] 系统备份中断恢复失败，下轮重试", classification);
  }
  });
  registerJobHandler("webhook.attempt", async (payload) => {
    const { attemptDelivery } = await import("./webhook.service.ts");
    await attemptDelivery(z.string().uuid().parse(payload.deliveryId), { pendingOnly: true });
  });
  registerJobHandler("restore.rebuild", async (payload,row) => {
    await runPostRestoreRebuild(payload,row.id);
  });
  registerJobHandler("restore.system", async payload => {
    const input = z.strictObject({restoreId:z.string().uuid(),dataKeyHandle:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(payload);
    await importSystemBackup(input);
  });
  registerJobHandler("email.send", async (payload) => {
    const to = typeof payload.to === "string" ? payload.to : "";
    const subject = typeof payload.subject === "string" ? payload.subject : "";
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!to || !subject) throw new Error("email.send 缺少 to/subject");
    const r = await sendMail({ to, subject, text });
    if (!r.ok && r.reason !== "未配置邮件发送")
      throw new Error(r.reason ?? "邮件发送失败");
    if (!r.ok) console.warn("[job] 邮件发送未配置，email.send 跳过：", to);
  });

  // IM 通知（Round 76）：notification.service 扇出入队；失败抛错进入重试/死信
  registerJobHandler("im.send", async (payload) => {
    const channelId =
      typeof payload.channelId === "string" ? payload.channelId : "";
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!channelId || !text) throw new Error("im.send 缺少 channelId/text");
    await sendToChannel(channelId, text);
  });

  // 全量导出包（Round 46）：由 setting:manage 的 POST /system/exports 入队
  registerJobHandler("export.full", async (_payload, row) => {
    const r = await writeFullExportPackage(row.id);
    console.info("[job] 全量导出包已生成:", r.path, `${r.bytes} bytes`);
  });

  registerJobHandler("backup.system", async (payload) => {
    const backupId = z.string().uuid().parse(payload.backupId);
    const handle = z.string().min(32).parse(payload.dataKeyHandle);
    let record: Awaited<ReturnType<typeof getBackupRecord>> = null;
    let ownsAttempt = false;
    try {
      record = await getBackupRecord(backupId);
      if (!record) {
        await discardTemporaryKeyHandle(handle);
        throw new DomainError("NOT_FOUND", "备份记录不存在", null);
      }
      if (record.status !== "PENDING")
        throw new DomainError("CONFLICT", "备份记录已开始或已结束", null);
      await updateBackupRecord(backupId, { status: "RUNNING" }, "PENDING");
      ownsAttempt = true;
      const envelope = keyEnvelopeSchema.parse(record.headerDraft);
      const result = await exportSystemBackup({
        backupId,
        mode: record.mode as "safe" | "full",
        requestedBy: record.requestedBy ?? "system",
        dataKeyHandle: handle,
        keyEnvelope: envelope,
      });
      await updateBackupRecord(
        backupId,
        {
          status: "SUCCEEDED",
          headerDraft: result.header,
          packagePath: result.packagePath,
          bytes: result.bytes,
          manifestSummary: result.manifestSummary,
        },
        "RUNNING",
      );
    } catch (error) {
      const classification =
        error instanceof DomainError ? error.code : "EXPORT_FAILED";
      if (ownsAttempt && record) {
        await cleanupInterruptedBackupArtifacts(backupId, [handle]);
        await updateBackupRecord(
          backupId,
          { status: "FAILED" },
          "RUNNING",
        ).catch(() => {});
        await writeSecurityAudit({
          actorId: record.requestedBy,
          action: "system_backup.failed",
          targetType: "SYSTEM_BACKUP",
          targetId: backupId,
          changes: { status: "FAILED", error: classification },
        });
      }
      // 原异常可能含SQL参数/秘密；仅传播白名单分类，不把cause交给持久队列日志。
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`系统备份失败（${classification}）`);
    }
  });
}
