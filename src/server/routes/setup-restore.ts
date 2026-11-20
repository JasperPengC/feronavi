import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { getPostRestoreRebuildSummary } from "../services/system-backup/post-restore-rebuild.ts";
import { DomainError } from "../../shared/errors.ts";
import {
  restorePreflightSchema,
  restoreConfirmSchema,
} from "../../shared/schemas/system-backup.ts";
import { confirmSystemRestore } from "../services/system-backup/importer.ts";
import { writeSecurityAudit } from "../services/audit.service.ts";
import {
  discardRestoreUpload,
  getOwnedRestoreRecord,
  preflightRestore,
  restoreOwnerHash,
  restoreSummary,
  streamRestoreUpload,
} from "../services/system-backup/validator.ts";
import { restoreLimits } from "../services/system-backup/restore-archive.ts";

export const SETUP_RESTORE_COOKIE = "setup_restore_session";
const ids = z.object({ id: z.string().uuid() });
const strictRate = { max: 5, timeWindow: "1 minute" };

export function restoreId(req: FastifyRequest): string {
  const parsed = ids.safeParse(req.params);
  if (!parsed.success)
    throw new DomainError("VALIDATION", "恢复标识不合法", null);
  return parsed.data.id;
}

export function ownedRestore(req: FastifyRequest) {
  return getOwnedRestoreRecord(
    restoreId(req),
    req.cookies[SETUP_RESTORE_COOKIE],
  );
}

async function audit(
  action: "system_restore.uploaded" | "system_restore.preflighted",
  id: string,
) {
  await writeSecurityAudit({
    actorId: null,
    actorSnapshot: "setup",
    action,
    targetType: "system_restore",
    targetId: id,
  });
}

export async function registerSetupRestoreRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/api/v1/setup/restore/bootstrap",
    { config: { rateLimit: strictRate } },
    async (req, reply) => {
      const existing = req.cookies[SETUP_RESTORE_COOKIE];
      const session =
        existing && /^[A-Za-z0-9_-]{43}$/.test(existing)
          ? existing
          : randomBytes(32).toString("base64url");
      const cookie = {
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict" as const,
        path: "/",
        maxAge: 24 * 60 * 60,
      };
      reply.setCookie(SETUP_RESTORE_COOKIE, session, {
        ...cookie,
        httpOnly: true,
      });
      const csrfToken = await reply.generateCsrf({ ...cookie, httpOnly: true });
      reply.setCookie("csrf_token", csrfToken, { ...cookie, httpOnly: false });
      reply.header("cache-control", "no-store");
      return { csrfToken };
    },
  );

  app.post(
    "/api/v1/setup/restore/upload",
    { onRequest: app.csrfProtection, config: { rateLimit: strictRate } },
    async (req) => {
      const ownerHash = restoreOwnerHash(req.cookies[SETUP_RESTORE_COOKIE]);
      const file = await req.file({
        limits: {
          fileSize: restoreLimits().maxUploadBytes,
          files: 1,
          fields: 0,
        },
      });
      if (!file) throw new DomainError("VALIDATION", "缺少迁移包", null);
      try {
        const summary = await streamRestoreUpload(file.file, ownerHash);
        await audit("system_restore.uploaded", summary.id);
        return { id: summary.id, status: summary.status };
      } catch (error) {
        if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE")
          throw new DomainError("INVALID_BACKUP", "迁移包超过大小限制", null);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/setup/restore/:id/preflight",
    { onRequest: app.csrfProtection, config: { rateLimit: strictRate } },
    async (req) => {
      const record = await ownedRestore(req);
      const parsed = restorePreflightSchema.safeParse(req.body);
      if (!parsed.success)
        throw new DomainError("VALIDATION", "迁移密码至少需要12个字符", null);
      const result = await preflightRestore(
        record.id,
        parsed.data.migrationPassword,
      );
      await audit("system_restore.preflighted", record.id);
      return result;
    },
  );

  app.post(
    "/api/v1/setup/restore/:id/confirm",
    { onRequest: app.csrfProtection, config: { rateLimit: strictRate } },
    async (req) => {
      const record = await ownedRestore(req);
      const parsed = restoreConfirmSchema.safeParse(req.body);
      if (!parsed.success)
        throw new DomainError(
          "VALIDATION",
          "请填写迁移密码并确认恢复此实例",
          null,
        );
      return confirmSystemRestore(record.id, parsed.data.migrationPassword);
    },
  );

  const status = async (
    req: FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    reply.header("cache-control", "no-store");
    const record = await ownedRestore(req);
    return {
      ...restoreSummary(record),
      rebuild:
        record.status === "SUCCEEDED" && record.packageId
          ? await getPostRestoreRebuildSummary(record.packageId)
          : null,
    };
  };
  app.get(
    "/api/v1/setup/restore/:id/status",
    { config: { rateLimit: strictRate } },
    status,
  );
  app.get(
    "/api/v1/setup/restore/:id",
    { config: { rateLimit: strictRate } },
    status,
  );

  app.delete(
    "/api/v1/setup/restore/:id",
    { onRequest: app.csrfProtection, config: { rateLimit: strictRate } },
    async (req) => {
      await discardRestoreUpload(await ownedRestore(req));
      return { ok: true };
    },
  );
}
