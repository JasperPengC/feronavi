import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import yauzl from "yauzl";
import { and, eq, inArray } from "drizzle-orm";
import { db, sql as pg } from "../src/db/index.ts";
import {
  auditEntry,
  job,
  member,
  role,
  roleAssignment,
  session,
  systemBackup,
  twoFactorSecret,
} from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { buildApp } from "../src/server/app.ts";
import {
  setup as setupTwoFactor,
  activate as activateTwoFactor,
} from "../src/server/services/two-factor.service.ts";
import { base32Decode, totp } from "../src/server/lib/totp.ts";
import {
  decryptPayload,
  unwrapDataKey,
} from "../src/server/services/system-backup/crypto.ts";
import { masterKey } from "../src/server/services/crypto.service.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import {
  getJobHandler,
  registerJobHandler,
  runJobWorkerOnce,
} from "../src/server/services/job.service.ts";
import {
  backupPath,
  createBackupFile,
  createBackupStageDirectory,
  pruneSystemTransferFiles,
} from "../src/server/services/system-backup/storage.ts";
import {
  createBackupRecord,
  updateBackupRecord,
} from "../src/server/repos/system-transfer.repo.ts";
import { ensureInitialized } from "./_test-helpers.ts";

if (
  !process.env.DATABASE_URL ||
  !process.env.FERONAVI_TEST_DIRECTORY ||
  !process.env.ATTACHMENT_DIR
)
  throw new Error("必须通过 scripts/run-isolated-test.ts 执行此测试");

function zipEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, autoClose: true },
      (error, zip) => {
        if (error || !zip) return reject(error ?? new Error("无法打开 ZIP"));
        const entries = new Map<string, Buffer>();
        zip.on("error", reject);
        zip.on("end", () => resolve(entries));
        zip.on("entry", (entry) => {
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream)
              return reject(streamError ?? new Error("无法读取 ZIP"));
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) =>
              chunks.push(Buffer.from(chunk)),
            );
            stream.on("error", reject);
            stream.on("end", () => {
              entries.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}

async function decryptInner(
  header: Record<string, unknown>,
  payload: Buffer,
  password: string,
): Promise<Buffer> {
  const key = await unwrapDataKey(password, header as never);
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  try {
    await decryptPayload(
      Readable.from(payload),
      output,
      key,
      (header as { encryption: { payloadNonce: string; payloadTag: string } })
        .encryption,
    );
    await finished(output);
    return Buffer.concat(chunks);
  } finally {
    key.fill(0);
  }
}

const runId = randomUUID();
const adminId = randomUUID();
const guestId = randomUUID();
const adminName = "backup-admin-" + runId.slice(0, 8);
const guestName = "backup-guest-" + runId.slice(0, 8);
const password = "backup-current-password";
const migrationPassword = "migration-password-123";
const sourceKey = Buffer.from(masterKey());
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let backupId: string | undefined;
let safeBackupId: string | undefined;
let pendingId: string | undefined;
let runningId: string | undefined;
let interruptedId: string | undefined;
let missingJobId: string | undefined;
let pendingHandle: string | undefined;
let runningHandle: string | undefined;
let interruptedHandle: string | undefined;
let missingJobHandle: string | undefined;
const protectedPaths: string[] = [];

try {
  await ensureInitialized();
  await db.insert(member).values([
    {
      id: adminId,
      username: adminName,
      email: adminName + "@test.invalid",
      name: "Task 5 Admin",
      status: "ACTIVE",
      passwordHash: await hashPassword(password),
    },
    {
      id: guestId,
      username: guestName,
      email: guestName + "@test.invalid",
      name: "Task 5 Guest",
      status: "ACTIVE",
      passwordHash: await hashPassword(password),
    },
  ]);
  const adminRole = (
    await db
      .select({ id: role.id })
      .from(role)
      .where(eq(role.key, "ADMIN"))
      .limit(1)
  )[0];
  assert.ok(adminRole, "isolated database must include ADMIN role");
  await db.insert(roleAssignment).values({
    memberId: adminId,
    roleId: adminRole.id,
    scopeType: "ORG",
    scopeId: null,
  });

  registerBuiltinJobHandlers();
  app = await buildApp({ logger: false });
  const port = Number(process.env.PORT ?? 3985);
  await app.listen({ port, host: "127.0.0.1" });
  const base = process.env.BASE ?? "http://127.0.0.1:" + port;
  const login = async (username: string) => {
    const response = await fetch(base + "/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200, "login for " + username);
    const body = (await response.json()) as { csrfToken: string };
    return {
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
      csrf: decodeURIComponent(body.csrfToken),
    };
  };
  const adminAuth = await login(adminName);
  const guestAuth = await login(guestName);
  const post = (auth: typeof adminAuth, body: unknown, withCsrf = true) =>
    fetch(base + "/api/v1/system/backups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: auth.cookie,
        ...(withCsrf ? { "x-csrf-token": auth.csrf } : {}),
      },
      body: JSON.stringify(body),
    });

  assert.equal(
    (
      await post(
        adminAuth,
        { mode: "safe", migrationPassword, currentPassword: password },
        false,
      )
    ).status,
    403,
    "create requires CSRF",
  );
  assert.equal(
    (
      await post(guestAuth, {
        mode: "safe",
        migrationPassword,
        currentPassword: password,
      })
    ).status,
    403,
    "user without setting:manage cannot create",
  );
  const submittedPassword = "submitted-password-must-not-be-logged";
  const wrongPassword = await post(adminAuth, {
    mode: "safe",
    migrationPassword,
    currentPassword: submittedPassword,
  });
  assert.equal(wrongPassword.status, 403, "wrong current password is rejected");
  assert.ok(
    !(await wrongPassword.text()).includes(submittedPassword),
    "response does not echo password",
  );

  const setup = await setupTwoFactor(adminId, { account: adminName });
  const secret = base32Decode(
    new URL(setup.otpauthUrl).searchParams.get("secret")!,
  );
  await activateTwoFactor(adminId, totp(secret));
  assert.equal(
    (
      await post(adminAuth, {
        mode: "safe",
        migrationPassword,
        currentPassword: password,
      })
    ).status,
    403,
    "2FA-enabled admin must provide a valid code",
  );

  const createdResponse = await post(adminAuth, {
    mode: "full",
    migrationPassword,
    currentPassword: password,
    totpCode: totp(secret),
  });
  assert.equal(
    createdResponse.status,
    201,
    await createdResponse.clone().text(),
  );
  const created = (await createdResponse.json()) as {
    id: string;
    status: string;
  };
  backupId = created.id;
  assert.equal(created.status, "PENDING");

  const jobRow = (
    await db.select().from(job).where(eq(job.kind, "backup.system")).limit(1)
  )[0]!;
  assert.deepEqual(Object.keys(jobRow.payload as object).sort(), [
    "backupId",
    "dataKeyHandle",
  ]);
  assert.ok(!JSON.stringify(jobRow.payload).includes(password));
  assert.ok(!JSON.stringify(jobRow.payload).includes(migrationPassword));

  const preflight = await fetch(base + "/api/v1/system/backups/preflight", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: adminAuth.cookie,
      "x-csrf-token": adminAuth.csrf,
    },
    body: JSON.stringify({ mode: "full" }),
  });
  assert.equal(preflight.status, 200);
  assert.equal(((await preflight.json()) as { mode: string }).mode, "full");
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups/preflight", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: guestAuth.cookie,
          "x-csrf-token": guestAuth.csrf,
        },
        body: JSON.stringify({ mode: "safe" }),
      })
    ).status,
    403,
    "preflight requires setting:manage",
  );
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups/preflight", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminAuth.cookie,
        },
        body: JSON.stringify({ mode: "safe" }),
      })
    ).status,
    403,
    "preflight requires CSRF",
  );

  assert.equal(
    (await runJobWorkerOnce("task5-" + runId, 1)).succeeded,
    1,
    "worker creates package",
  );
  const backupHandler = getJobHandler("backup.system");
  assert.ok(backupHandler);
  await assert.rejects(
    backupHandler(jobRow.payload as Record<string, unknown>, jobRow),
    "a duplicate dispatch must not replay a terminal backup",
  );
  assert.equal(
    existsSync(backupPath(created.id)),
    true,
    "duplicate dispatch must preserve the succeeded package",
  );
  assert.equal(
    (
      await db
        .select({ status: systemBackup.status })
        .from(systemBackup)
        .where(eq(systemBackup.id, created.id))
        .limit(1)
    )[0]?.status,
    "SUCCEEDED",
    "duplicate dispatch must preserve the terminal backup status",
  );
  const summaryResponse = await fetch(
    base + "/api/v1/system/backups/" + created.id,
    { headers: { cookie: adminAuth.cookie } },
  );
  const summary = (await summaryResponse.json()) as {
    status: string;
    downloadsRemaining: number;
  };
  assert.equal(summary.status, "SUCCEEDED");
  assert.equal(summary.downloadsRemaining, 5);
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups", {
        headers: { cookie: guestAuth.cookie },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups/" + created.id, {
        headers: { cookie: guestAuth.cookie },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups/" + created.id + "/download", {
        headers: { cookie: guestAuth.cookie },
      })
    ).status,
    403,
  );

  const firstDownload = await fetch(
    base + "/api/v1/system/backups/" + created.id + "/download",
    { headers: { cookie: adminAuth.cookie } },
  );
  assert.equal(firstDownload.status, 200, await firstDownload.clone().text());
  assert.equal(
    firstDownload.headers.get("content-type"),
    "application/vnd.feronavi.backup+zip",
  );
  assert.match(
    firstDownload.headers.get("content-disposition") ?? "",
    /\.fnbak"/,
  );
  const outer = await zipEntries(
    Buffer.from(await firstDownload.arrayBuffer()),
  );
  const header = JSON.parse(
    outer.get("header.json")!.toString("utf8"),
  ) as Record<string, unknown>;
  const encrypted = outer.get("payload.enc")!;
  assert.ok(
    !encrypted.includes(sourceKey),
    "source key is not present in ciphertext package bytes",
  );
  const inner = await decryptInner(header, encrypted, migrationPassword);
  assert.deepEqual(
    (await zipEntries(inner)).get("secrets/source-master-key.bin"),
    sourceKey,
    "full migration includes source key inside encrypted payload",
  );
  assert.deepEqual(masterKey(), sourceKey, "only copied source key is cleared");

  const nextDownloads = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetch(base + "/api/v1/system/backups/" + created.id + "/download", {
        headers: { cookie: adminAuth.cookie },
      }),
    ),
  );
  assert.equal(
    nextDownloads.filter((response) => response.status === 200).length,
    4,
    "concurrent requests consume the remaining four authorizations",
  );
  assert.equal(
    nextDownloads.filter((response) => response.status === 409).length,
    1,
    "concurrent sixth download is rejected",
  );
  await Promise.all(nextDownloads.map((response) => response.arrayBuffer()));
  const exhausted = await fetch(base + "/api/v1/system/backups/" + created.id, {
    headers: { cookie: adminAuth.cookie },
  });
  assert.equal(
    ((await exhausted.json()) as { downloadsRemaining: number })
      .downloadsRemaining,
    0,
  );

  const safeResponse = await post(adminAuth, {
    mode: "safe",
    migrationPassword,
    currentPassword: password,
    totpCode: totp(secret),
  });
  assert.equal(safeResponse.status, 201, await safeResponse.clone().text());
  const safeCreated = (await safeResponse.json()) as { id: string };
  safeBackupId = safeCreated.id;
  assert.equal(
    (await runJobWorkerOnce("task5-safe-" + runId, 1)).succeeded,
    1,
    "worker creates safe package",
  );
  const safeDownload = await fetch(
    base + "/api/v1/system/backups/" + safeCreated.id + "/download",
    { headers: { cookie: adminAuth.cookie } },
  );
  assert.equal(safeDownload.status, 200);
  const safeOuter = await zipEntries(
    Buffer.from(await safeDownload.arrayBuffer()),
  );
  const safeHeader = JSON.parse(
    safeOuter.get("header.json")!.toString("utf8"),
  ) as Record<string, unknown>;
  const safeInner = await decryptInner(
    safeHeader,
    safeOuter.get("payload.enc")!,
    migrationPassword,
  );
  assert.ok(
    !(await zipEntries(safeInner)).has("secrets/source-master-key.bin"),
    "safe migration omits source master key",
  );
  const safePackagePath = backupPath(safeCreated.id);
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups/" + safeCreated.id, {
        method: "DELETE",
        headers: { cookie: adminAuth.cookie },
      })
    ).status,
    403,
    "delete requires CSRF",
  );
  const deleted = await fetch(
    base + "/api/v1/system/backups/" + safeCreated.id,
    {
      method: "DELETE",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf },
    },
  );
  assert.equal(
    deleted.status,
    204,
    "successful backup can be deleted with CSRF",
  );
  assert.equal(
    existsSync(safePackagePath),
    false,
    "delete removes package file",
  );

  await db
    .update(systemBackup)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(systemBackup.id, created.id));
  assert.equal(
    (
      await fetch(base + "/api/v1/system/backups/" + created.id + "/download", {
        headers: { cookie: adminAuth.cookie },
      })
    ).status,
    403,
    "expired package cannot be downloaded",
  );
  await pruneSystemTransferFiles(Date.now() + 8 * 24 * 60 * 60 * 1000);
  assert.equal(
    existsSync(backupPath(created.id)),
    false,
    "retention removes expired package",
  );

  const pending = await createBackupRecord({
    requestedBy: adminId,
    mode: "safe",
    headerDraft: {},
    expiresAt: new Date(Date.now() + 1000),
  });
  pendingId = pending.id;
  const key =
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) =>
        storage.writeTemporaryKeyHandle(
          "pending-" + pending.id,
          Buffer.alloc(32, 7),
        ),
    );
  pendingHandle = key.handle;
  await db.insert(job).values({
    kind: "backup.system",
    payload: { backupId: pending.id, dataKeyHandle: key.handle },
    maxAttempts: 1,
  });
  const pendingFile = await createBackupFile(pending.id);
  const pendingFinish = once(pendingFile.stream, "finish");
  pendingFile.stream.end("pending package fixture");
  await pendingFinish;
  const pendingStage = await createBackupStageDirectory(pending.id);
  await writeFile(join(pendingStage, "partial"), "pending stage");
  protectedPaths.push(pendingFile.path, pendingStage);
  await utimes(key.path, new Date(0), new Date(0));

  const running = await createBackupRecord({
    requestedBy: adminId,
    mode: "safe",
    headerDraft: {},
    expiresAt: new Date(Date.now() + 1000),
  });
  runningId = running.id;
  await updateBackupRecord(running.id, { status: "RUNNING" }, "PENDING");
  const runningKey =
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) =>
        storage.writeTemporaryKeyHandle(
          "running-" + running.id,
          Buffer.alloc(32, 8),
        ),
    );
  runningHandle = runningKey.handle;
  await db.insert(job).values({
    kind: "backup.system",
    status: "RUNNING",
    payload: { backupId: running.id, dataKeyHandle: runningKey.handle },
    maxAttempts: 1,
    lockedBy: "task5-live-" + runId,
    lockedAt: new Date(),
  });
  const runningFile = await createBackupFile(running.id);
  const runningFinish = once(runningFile.stream, "finish");
  runningFile.stream.end("running package fixture");
  await runningFinish;
  const runningStage = await createBackupStageDirectory(running.id);
  await writeFile(join(runningStage, "partial"), "running stage");
  protectedPaths.push(runningFile.path, runningStage);
  await utimes(runningKey.path, new Date(0), new Date(0));

  const failed = await createBackupRecord({
    requestedBy: adminId,
    mode: "safe",
    headerDraft: {},
    expiresAt: new Date(Date.now() + 1000),
  });
  const failedStage = await createBackupStageDirectory(failed.id);
  await writeFile(join(failedStage, "partial"), "failed stage");
  await updateBackupRecord(failed.id, { status: "FAILED" }, "PENDING");
  await pruneSystemTransferFiles(Date.now() + 8 * 24 * 60 * 60 * 1000);
  assert.equal(
    existsSync(key.path),
    true,
    "retention protects handles owned by pending jobs",
  );
  assert.equal(
    existsSync(runningKey.path),
    true,
    "retention protects handles owned by running jobs",
  );
  assert.ok(
    protectedPaths.every(existsSync),
    "retention protects pending/running package and stage files: " +
      protectedPaths
        .map((path) => (existsSync(path) ? "kept" : "removed:" + path))
        .join(", "),
  );
  await updateBackupRecord(pending.id, { status: "RUNNING" }, "PENDING");
  await db
    .update(job)
    .set({ runAt: new Date(Date.now() + 60_000) })
    .where(and(eq(job.kind, "backup.system"), eq(job.status, "PENDING")));
  assert.equal(
    existsSync(failedStage),
    false,
    "retention removes failed task staging directories",
  );

  const interrupted = await createBackupRecord({
    requestedBy: adminId,
    mode: "safe",
    headerDraft: {},
    expiresAt: new Date(Date.now() + 1000),
  });
  interruptedId = interrupted.id;
  await updateBackupRecord(interrupted.id, { status: "RUNNING" }, "PENDING");
  const interruptedKey =
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) =>
        storage.writeTemporaryKeyHandle(interrupted.id, Buffer.alloc(32, 10)),
    );
  interruptedHandle = interruptedKey.handle;
  const interruptedClaimPath = interruptedKey.path + ".consume-crashed";
  await rename(interruptedKey.path, interruptedClaimPath);
  const interruptedPackage = await createBackupFile(interrupted.id);
  const interruptedPackageFinish = once(interruptedPackage.stream, "finish");
  interruptedPackage.stream.end("interrupted package fixture");
  await interruptedPackageFinish;
  const interruptedStage = await createBackupStageDirectory(interrupted.id);
  await writeFile(join(interruptedStage, "partial"), "interrupted stage");
  const [interruptedJob] = await db
    .insert(job)
    .values({
      kind: "backup.system",
      status: "RUNNING",
      payload: {
        backupId: interrupted.id,
        dataKeyHandle: interruptedKey.handle,
      },
      attempts: 1,
      maxAttempts: 1,
      lockedBy: "task5-expired-" + runId,
      lockedAt: new Date(Date.now() - 11 * 60_000),
    })
    .returning();
  assert.ok(interruptedJob);

  const missing = await createBackupRecord({
    requestedBy: adminId,
    mode: "safe",
    headerDraft: {},
    expiresAt: new Date(Date.now() + 1000),
  });
  missingJobId = missing.id;
  await updateBackupRecord(missing.id, { status: "RUNNING" }, "PENDING");
  const missingKey =
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) =>
        storage.writeTemporaryKeyHandle(missing.id, Buffer.alloc(32, 11)),
    );
  missingJobHandle = missingKey.handle;
  const missingPackage = await createBackupFile(missing.id);
  const missingPackageFinish = once(missingPackage.stream, "finish");
  missingPackage.stream.end("missing job package fixture");
  await missingPackageFinish;
  const missingStage = await createBackupStageDirectory(missing.id);
  await writeFile(join(missingStage, "partial"), "missing job stage");
  const missingClaimPath = missingKey.path + ".consume-crashed";
  await rename(missingKey.path, missingClaimPath);

  const keyDirectory = join(process.env.DATA_DIR!, "system-transfer", "keys");
  const savedKeyDirectory = keyDirectory + ".task5-retry";
  const unrelatedOutput = join(process.env.DATA_DIR!, "unrelated-job-output");
  registerJobHandler("test.backup-cleanup-independent", async (payload) => {
    await writeFile(unrelatedOutput, String(payload.message));
  });
  const [unrelatedJob] = await db
    .insert(job)
    .values({
      kind: "test.backup-cleanup-independent",
      payload: { message: "unrelated work completed " + runId },
      maxAttempts: 1,
    })
    .returning();
  assert.ok(unrelatedJob);
  const cleanupErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  await rename(keyDirectory, savedKeyDirectory);
  try {
    await writeFile(keyDirectory, "temporarily unavailable key directory");
    console.error = (...args: unknown[]) => {
      cleanupErrors.push(args);
    };
    await assert.doesNotReject(async () => {
      const result = await runJobWorkerOnce("task5-cleanup-error-" + runId);
      assert.equal(result.claimed, 1, "unrelated pending job is claimed");
      assert.equal(result.succeeded, 1, "unrelated pending job succeeds");
    }, "backup cleanup failure must not block unrelated jobs");
    assert.equal(
      await readFile(unrelatedOutput, "utf8"),
      "unrelated work completed " + runId,
      "unrelated handler performs its work despite backup cleanup failure",
    );
    assert.equal(
      (
        await db
          .select({ status: job.status })
          .from(job)
          .where(eq(job.id, unrelatedJob.id))
          .limit(1)
      )[0]?.status,
      "SUCCEEDED",
      "unrelated job completion is persisted",
    );
    const backupCleanupErrors = cleanupErrors.filter(
      ([message]) => message === "[job] 系统备份中断恢复失败，下轮重试",
    );
    assert.ok(
      backupCleanupErrors.some((args) => args.includes("ENOTDIR")),
      "cleanup IO failure classification remains visible in the worker error log",
    );
    assert.ok(
      backupCleanupErrors.every((args) =>
        args.every((value) => typeof value === "string"),
      ),
      "cleanup diagnostics must not contain raw error objects or stacks",
    );
    assert.ok(
      !backupCleanupErrors.flat().join(" ").includes(keyDirectory),
      "cleanup diagnostics must not expose storage paths",
    );
    assert.equal(
      (
        await db
          .select({ status: systemBackup.status })
          .from(systemBackup)
          .where(eq(systemBackup.id, missing.id))
          .limit(1)
      )[0]?.status,
      "RUNNING",
      "failed cleanup must not commit FAILED before its artifacts are removed",
    );
  } finally {
    console.error = originalConsoleError;
    await rm(keyDirectory, { force: true });
    await rename(savedKeyDirectory, keyDirectory);
  }

  assert.equal(
    (
      await Promise.all([
        runJobWorkerOnce("task5-recovery-a-" + runId),
        runJobWorkerOnce("task5-recovery-b-" + runId),
      ])
    ).reduce((count, result) => count + result.claimed, 0),
    0,
    "recovery tick should only reconcile stale jobs in this fixture",
  );
  assert.equal(
    (
      await db
        .select({ status: job.status })
        .from(job)
        .where(eq(job.id, interruptedJob.id))
        .limit(1)
    )[0]?.status,
    "DEAD",
    "expired one-attempt backup job becomes DEAD",
  );
  for (const id of [interrupted.id, missing.id]) {
    assert.equal(
      (
        await db
          .select({ status: systemBackup.status })
          .from(systemBackup)
          .where(eq(systemBackup.id, id))
          .limit(1)
      )[0]?.status,
      "FAILED",
      "interrupted backup is reconciled to FAILED: " + id,
    );
    assert.equal(existsSync(backupPath(id)), false, "final package removed");
    const stages = await import("node:fs/promises").then((fs) =>
      fs.readdir(join(process.env.DATA_DIR!, "system-transfer", "backups")),
    );
    assert.equal(
      stages.some((name) => name.startsWith("stage-" + id + "-")),
      false,
      "staging directory removed: " + id,
    );
  }
  for (const path of [
    interruptedKey.path,
    interruptedClaimPath,
    missingKey.path,
    missingClaimPath,
  ]) {
    assert.equal(
      existsSync(path),
      false,
      "key/claim artifact removed: " + path,
    );
  }
  assert.equal(
    (
      await db
        .select({ status: systemBackup.status })
        .from(systemBackup)
        .where(eq(systemBackup.id, running.id))
        .limit(1)
    )[0]?.status,
    "RUNNING",
    "backup with a live worker lease remains RUNNING",
  );
  assert.ok(
    protectedPaths.every(existsSync),
    "files owned by the live worker remain present",
  );
  for (const [id, path] of [
    [pending.id, key.path],
    [running.id, runningKey.path],
  ]) {
    assert.equal(
      (
        await db
          .select({ status: systemBackup.status })
          .from(systemBackup)
          .where(eq(systemBackup.id, id))
          .limit(1)
      )[0]?.status,
      "RUNNING",
      "pending jobs and live leases protect the backup control record",
    );
    assert.equal(existsSync(path), true, "active owner keeps its key handle");
  }
  const recoveryAudits = await db
    .select({ targetId: auditEntry.targetId })
    .from(auditEntry)
    .where(
      and(
        eq(auditEntry.action, "system_backup.failed"),
        inArray(auditEntry.targetId, [interrupted.id, missing.id]),
      ),
    );
  assert.equal(
    recoveryAudits.length,
    2,
    "concurrent recovery audits each transition once",
  );

  const residualPackage = await createBackupFile(missing.id);
  const residualPackageFinish = once(residualPackage.stream, "finish");
  residualPackage.stream.end("failed backup residual package");
  await residualPackageFinish;
  const residualStage = await createBackupStageDirectory(missing.id);
  await writeFile(
    join(residualStage, "partial"),
    "failed backup residual stage",
  );
  await writeFile(missingClaimPath, JSON.stringify({ ownerId: missing.id }));
  await runJobWorkerOnce("task5-failed-residual-" + runId);
  for (const path of [residualPackage.path, residualStage, missingClaimPath]) {
    assert.equal(
      existsSync(path),
      false,
      "a later tick cleans FAILED backup artifacts",
    );
  }

  const orphanId = randomUUID();
  const orphanKey =
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) =>
        storage.writeTemporaryKeyHandle(
          "orphan-" + orphanId,
          Buffer.alloc(32, 9),
        ),
    );
  await assert.rejects(
    backupHandler(
      { backupId: orphanId, dataKeyHandle: orphanKey.handle },
      {} as never,
    ),
  );
  assert.equal(
    existsSync(orphanKey.path),
    false,
    "worker failure discards the one-shot handle",
  );
  assert.deepEqual(masterKey(), sourceKey);

  const audits = await db
    .select({ action: auditEntry.action })
    .from(auditEntry)
    .where(inArray(auditEntry.actorId, [adminId, guestId]));
  assert.ok(audits.some((row) => row.action === "system_backup.reauth_failed"));
  assert.ok(
    !JSON.stringify(audits).includes(submittedPassword),
    "reauth audit has no submitted password",
  );
  console.log(
    "PASS system backup API permissions, CSRF, reauthentication, full package, job secrecy, download authorization and cleanup",
  );
} finally {
  if (app) await app.close();
  if (backupId) await rm(backupPath(backupId), { force: true });
  if (safeBackupId) await rm(backupPath(safeBackupId), { force: true });
  if (pendingHandle)
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) => storage.discardTemporaryKeyHandle(pendingHandle!),
    );
  if (runningHandle)
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) => storage.discardTemporaryKeyHandle(runningHandle!),
    );
  if (interruptedHandle)
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) => storage.discardTemporaryKeyHandle(interruptedHandle!),
    );
  if (missingJobHandle)
    await import("../src/server/services/system-backup/storage.ts").then(
      (storage) => storage.discardTemporaryKeyHandle(missingJobHandle!),
    );
  for (const path of protectedPaths)
    await rm(path, { recursive: true, force: true });
  const ids = [adminId, guestId];
  await db.delete(auditEntry).where(inArray(auditEntry.actorId, ids));
  await db.delete(session).where(inArray(session.memberId, ids));
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, adminId));
  await db.delete(twoFactorSecret).where(eq(twoFactorSecret.memberId, adminId));
  if (backupId)
    await db.delete(systemBackup).where(eq(systemBackup.id, backupId));
  if (safeBackupId)
    await db.delete(systemBackup).where(eq(systemBackup.id, safeBackupId));
  if (pendingId) {
    await db.delete(job).where(eq(job.kind, "backup.system"));
    await db.delete(systemBackup).where(eq(systemBackup.id, pendingId));
  }
  if (runningId)
    await db.delete(systemBackup).where(eq(systemBackup.id, runningId));
  if (interruptedId)
    await db.delete(systemBackup).where(eq(systemBackup.id, interruptedId));
  if (missingJobId)
    await db.delete(systemBackup).where(eq(systemBackup.id, missingJobId));
  await db.delete(member).where(inArray(member.id, ids));
  sourceKey.fill(0);
  await pg.end();
}
