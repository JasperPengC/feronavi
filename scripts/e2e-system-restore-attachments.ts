import "./_env.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import {
  attachment,
  auditEntry,
  job,
  member,
  organization,
  page,
  project,
  role,
  roleAssignment,
  setupState,
  systemRestore,
} from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { manifestHash } from "../src/server/services/system-backup/validator.ts";
import {
  backupFixture,
  fixturePassword,
} from "../tests/support/system-backup-fixture.ts";
import {
  stageRestoreBlobs,
  promoteRestoreBlobs,
} from "../src/server/services/system-backup/attachment-blobs.ts";
import { recoverInterruptedRestores } from "../src/server/services/system-backup/restore-recovery.ts";
import {
  importSystemBackup,
  confirmSystemRestore,
} from "../src/server/services/system-backup/importer.ts";
import { writeInnerArchive } from "../src/server/services/system-backup/archive.ts";
import {
  createRestoreUploadFile,
  pruneSystemTransferFiles,
  writeTemporaryKeyHandle,
} from "../src/server/services/system-backup/storage.ts";
import {
  authenticateAndReadManifest,
  withAuthenticatedRestoreArchive,
} from "../src/server/services/system-backup/restore-archive.ts";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";

const root = process.env.DATA_DIR!;
// 在首次加载app/attachment service前，将普通附件根与迁移附件固定根分开。
process.env.ATTACHMENT_DIR = join(root, "custom-attachment-root");
const { download, remove: removeAttachment } =
  await import("../src/server/services/attachment.service.ts");
const { buildApp } = await import("../src/server/app.ts");
const bytes = Buffer.from("same attachment referenced by two source rows");
const hash = createHash("sha256").update(bytes).digest("hex");
const blobs = {
  count: 1,
  bytes: bytes.length,
  entries: [{ sha256: hash, bytes: bytes.length, path: `blobs/${hash}` }],
};
const messages: string[] = [];
const logs = (code: string) => messages.push(code);
let adminId = "",
  firstAttachment = "";
const datasetRows: Record<string, Record<string, unknown>[]> = {};
const rollback = new Error("source fixture rollback");
async function record(packageId = randomUUID()) {
  const [row] = await db
    .insert(systemRestore)
    .values({
      packageId,
      status: "RESTORING",
      uploadPath: join(root, "unused.upload"),
    })
    .returning();
  return row!;
}
async function promotedRecord() {
  const row = await record();
  const archive = join(root, `${row.id}.zip`);
  await writeInnerArchive(archive, [{ path: `blobs/${hash}`, source: bytes }]);
  const staged = await stageRestoreBlobs(row.id, archive, blobs);
  await promoteRestoreBlobs(staged, row.packageId!);
  return {
    row,
    staged,
    target: join(root, "attachments", "restored", row.packageId!),
  };
}
async function state(id: string) {
  return (
    await db.select().from(systemRestore).where(eq(systemRestore.id, id))
  )[0]!;
}
async function absent(path: string) {
  await assert.rejects(fs.stat(path), { code: "ENOENT" });
}
async function expectedCommitDiagnostics<T>(
  run: () => Promise<T>,
  cleanupFailure = false,
): Promise<T> {
  const log = console.log,
    error = console.error;
  const notices: unknown[] = [],
    cleanup: unknown[] = [];
  console.log = (...args) => {
    const notice =
      args.length === 1
        ? (args[0] as { code?: string; message?: string })
        : undefined;
    if (
      notice?.code === "25P01" &&
      notice.message === "there is no transaction in progress"
    )
      notices.push(notice);
    else log(...args);
  };
  console.error = (...args) => {
    if (
      args.length === 2 &&
      args[0] === "系统恢复清理失败" &&
      JSON.stringify(args[1]) === '{"code":"RESTORE_FAILED"}'
    )
      cleanup.push(args[1]);
    else error(...args);
  };
  try {
    const result = await run();
    assert.equal(
      notices.length,
      1,
      "每次注入COMMIT故障应仅产生一个已知25P01 notice",
    );
    assert.equal(
      cleanup.length,
      cleanupFailure ? 1 : 0,
      "只允许预期的固定分类清理日志",
    );
    return result;
  } finally {
    console.log = log;
    console.error = error;
  }
}

try {
  // 真实固定advisory lock：另一个活跃实例持锁时，启动不能改记录或清文件。
  const interrupted = await promotedRecord();
  const blocker = await sql.reserve();
  try {
    await blocker`select pg_advisory_lock(hashtextextended('feronavi.system-restore.v1',0))`;
    await recoverInterruptedRestores(logs);
    assert.equal((await state(interrupted.row.id)).status, "RESTORING");
    assert.deepEqual(await fs.readFile(join(interrupted.target, hash)), bytes);
  } finally {
    await blocker`select pg_advisory_unlock(hashtextextended('feronavi.system-restore.v1',0))`;
    blocker.release();
  }
  await db.insert(setupState).values({
    initializedAt: new Date(),
    currentStep: 6,
    restoredPackageId: randomUUID(),
  });
  await recoverInterruptedRestores(logs);
  assert.equal(
    (await state(interrupted.row.id)).status,
    "FAILED",
    "initialized marker不匹配不能证明提交",
  );
  await absent(interrupted.target);
  await db.delete(setupState);
  console.log("PASS 启动锁保护与marker不匹配回滚");

  // 清理失败不阻断buildApp/health，FAILED记录下一次仍需重试清理。
  const retry = await promotedRecord();
  const remove = fs.rm;
  fs.rm = async (path, options) => {
    if (String(path) === retry.target)
      throw Object.assign(new Error("private SQL payload"), { code: "EACCES" });
    return remove(path, options);
  };
  try {
    const app = await buildApp();
    assert.equal(
      (await app.inject({ method: "GET", url: "/health" })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/v1/setup/state" }))
        .statusCode,
      200,
    );
    await app.close();
    assert.equal((await state(retry.row.id)).status, "FAILED");
    assert.equal(
      (await state(retry.row.id)).lastError,
      "RESTORE_FAILED: 系统数据恢复失败",
    );
    assert.deepEqual(await fs.readFile(join(retry.target, hash)), bytes);
  } finally {
    fs.rm = remove;
  }
  await recoverInterruptedRestores(logs);
  await absent(retry.target);
  const [failedAudit] = await db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.targetId, retry.row.id));
  assert.deepEqual(failedAudit!.changes, { errorCode: "RESTORE_FAILED" });
  console.log("PASS 启动清理失败可见且可重试，健康检查可用");

  const committed = await promotedRecord();
  await db.insert(setupState).values({
    initializedAt: new Date(),
    currentStep: 6,
    restoredPackageId: committed.row.packageId,
  });
  await recoverInterruptedRestores(logs);
  assert.equal((await state(committed.row.id)).status, "SUCCEEDED");
  assert.deepEqual(await fs.readFile(join(committed.target, hash)), bytes);
  await absent(join(root, "system-restores", committed.row.id));
  const rebuildId = (await state(committed.row.id)).rebuildJobId;
  assert.ok(rebuildId, "精确marker成功恢复后须补建真实重建任务");
  const [rebuild] = await db.select().from(job).where(eq(job.id,rebuildId));
  assert.equal(rebuild!.kind,"restore.rebuild");
  assert.deepEqual(rebuild!.payload,{packageId:committed.row.packageId});
  // 此段是无业务行的合成提交证明；独立重建不属于后续附件事务故障用例。
  await db.delete(job).where(eq(job.id,rebuildId));
  await db.delete(setupState);
  console.log("PASS 精确提交marker修复SUCCEEDED并保留附件");

  // 即使同packageId控制行存在，也不能接管没有本次journal的目录。
  const foreign = await record();
  const foreignTarget = join(
    root,
    "attachments",
    "restored",
    foreign.packageId!,
  );
  await fs.mkdir(foreignTarget);
  await fs.writeFile(join(foreignTarget, "foreign"), "keep");
  await recoverInterruptedRestores(logs);
  assert.equal(
    await fs.readFile(join(foreignTarget, "foreign"), "utf8"),
    "keep",
  );

  const leased = await record();
  const [leasedJob] = await db
    .insert(job)
    .values({
      kind: "restore.system",
      payload: { restoreId: leased.id, dataKeyHandle: "A".repeat(43) },
      status: "RUNNING",
      attempts: 1,
      maxAttempts: 1,
      lockedBy: "other-worker",
      lockedAt: new Date(),
    })
    .returning();
  await recoverInterruptedRestores(logs);
  assert.equal(
    (await state(leased.id)).status,
    "RESTORING",
    "有效租约不是中断恢复",
  );
  await sql`update job set locked_at=now()-interval '11 minutes' where id=${leasedJob!.id}`;
  registerBuiltinJobHandlers();
  await runJobWorkerOnce("attachment-expired-restore", 1);
  assert.equal(
    (await state(leased.id)).status,
    "FAILED",
    "租约过期后worker周期必须补偿，不依赖再次启动app",
  );
  await db.delete(job).where(eq(job.id, leasedJob!.id));
  for (const badPayload of [
    { dataKeyHandle: "A".repeat(43), extra: true },
    { dataKeyHandle: "bad" },
    { dataKeyHandle: "A".repeat(43), restoreId: randomUUID() },
  ]) {
    const invalid = await record();
    const [invalidJob] = await db
      .insert(job)
      .values({
        kind: "restore.system",
        payload: { restoreId: invalid.id, ...badPayload },
      })
      .returning();
    await recoverInterruptedRestores(logs);
    assert.equal(
      (await state(invalid.id)).status,
      "FAILED",
      "无效或不关联的PENDING任务不能阻止清理",
    );
    await db.delete(job).where(eq(job.id, invalidJob!.id));
  }
  console.log("PASS 严格任务关联、有效租约保留与过期租约清理");

  // 源数据只在回滚事务内生成；两个attachment行共享一个blob。
  try {
    await db.transaction(async () => {
      await db.insert(organization).values({ name: "附件来源组织" });
      const [admin] = await db
        .insert(member)
        .values({
          username: "blob_admin",
          email: "blob@example.test",
          name: "管理员",
          passwordHash: await hashPassword("admin-password-123"),
          status: "ACTIVE",
        })
        .returning();
      adminId = admin!.id;
      const [adminRole] = await db
        .select()
        .from(role)
        .where(eq(role.key, "ADMIN"));
      await db.insert(roleAssignment).values({
        memberId: adminId,
        roleId: adminRole!.id,
        scopeType: "ORG",
        scopeId: null,
      });
      const [proj] = await db
        .insert(project)
        .values({ key: "BLOB", name: "附件恢复", createdBy: adminId })
        .returning();
      const [p] = await db
        .insert(page)
        .values({ projectId: proj!.id, title: "附件页面", slug: "blobs" })
        .returning();
      for (let i = 0; i < 2; i++) {
        const [row] = await db
          .insert(attachment)
          .values({
            targetType: "PAGE",
            targetId: p!.id,
            uploaderId: adminId,
            originalName: `source-${i}.txt`,
            storagePath: "source/s3/untrusted-path",
            storageBackend: "s3",
            mimeType: "text/plain",
            sizeBytes: bytes.length,
            contentHash: hash,
          })
          .returning();
        firstAttachment = row!.id;
      }
      for (const dataset of orderedDatasets("safe")) {
        // 源实例不包含本测试目标此前产生的本地恢复审计；目标基线由importer原样保留。
        if (dataset.tableName === "audit_entry") {
          datasetRows[dataset.name] = [];
          continue;
        }
        const rows = await sql`select * from ${sql(dataset.tableName)}`;
        datasetRows[dataset.name] = rows
          .map((row) =>
            dataset.encodeRow(row, { mode: "safe", purpose: "migration" }),
          )
          .filter((row): row is Record<string, unknown> => row !== null);
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
    datasetRows,
    blobContents: [bytes],
  });
  async function prepare() {
    const row = await record(fixture.manifest.packageId);
    await db
      .update(systemRestore)
      .set({
        status: "PREFLIGHT_PASSED",
        uploadPath: fixture.path,
        mode: "safe",
        manifestHash: manifestHash(fixture.manifest as SystemBackupManifest),
      })
      .where(eq(systemRestore.id, row.id));
    await confirmSystemRestore(row.id, fixturePassword);
    const [work] =
      await sql`select payload from job where payload->>'restoreId'=${row.id}`;
    return work!.payload as { restoreId: string; dataKeyHandle: string };
  }
  const failed = await prepare();
  // DEFERRABLE约束触发器确保故障发生在COMMIT，已完成目录提升及marker写入之后。
  await sql`create function fail_attachment_commit() returns trigger language plpgsql as $$ begin raise sqlstate '53100' using message='synthetic commit failure'; end $$`;
  await sql`create constraint trigger fail_attachment_commit after insert on setup_state deferrable initially deferred for each row execute function fail_attachment_commit()`;
  await expectedCommitDiagnostics(() =>
    assert.rejects(importSystemBackup(failed), {
      code: "INSUFFICIENT_STORAGE",
    }),
  );
  await sql`drop trigger fail_attachment_commit on setup_state`;
  await sql`drop function fail_attachment_commit()`;
  assert.equal((await db.select().from(attachment)).length, 0);
  assert.equal((await db.select().from(organization)).length, 0);
  assert.equal((await db.select().from(setupState)).length, 0);
  assert.equal((await state(failed.restoreId)).status, "FAILED");
  await absent(
    join(root, "attachments", "restored", fixture.manifest.packageId),
  );
  await absent(join(root, "system-restores", failed.restoreId));
  console.log("PASS COMMIT失败无孤立业务引用，已提升目录补偿");

  const uncertain = await prepare();
  await sql`create function fail_attachment_commit() returns trigger language plpgsql as $$ begin raise sqlstate '53100' using message='synthetic commit failure'; end $$`;
  await sql`create constraint trigger fail_attachment_commit after insert on setup_state deferrable initially deferred for each row execute function fail_attachment_commit()`;
  const reserveWithoutProof = sql.reserve;
  let commitAttempted = false;
  sql.reserve = (async (...args: Parameters<typeof reserveWithoutProof>) => {
    const connection = await reserveWithoutProof(...args);
    return new Proxy(connection, {
      get(target, property) {
        if (property === "unsafe")
          return (...query: Parameters<typeof connection.unsafe>) => {
            if (commitAttempted && query[0].includes('from "setup_state"'))
              throw new Error("synthetic unavailable commit proof");
            if (query[0] === "commit") commitAttempted = true;
            return connection.unsafe(...query);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof reserveWithoutProof;
  try {
    await expectedCommitDiagnostics(() =>
      assert.rejects(importSystemBackup(uncertain), {
        code: "RESTORE_FAILED",
      }),
    );
  } finally {
    sql.reserve = reserveWithoutProof;
  }
  await sql`drop trigger fail_attachment_commit on setup_state`;
  await sql`drop function fail_attachment_commit()`;
  assert.equal((await state(uncertain.restoreId)).status, "RESTORING");
  const uncertainTarget = join(
    root,
    "attachments",
    "restored",
    fixture.manifest.packageId,
  );
  assert.deepEqual(await fs.readFile(join(uncertainTarget, hash)), bytes);
  await fs.stat(
    join(root, "system-restores", uncertain.restoreId, ".restore-owner.json"),
  );
  assert.equal((await db.select().from(attachment)).length, 0);
  // 本段直接调用importer模拟失败worker；恢复协调前明确结束其队列任务。
  await sql`update job set status='DEAD' where payload->>'restoreId'=${uncertain.restoreId}`;
  await recoverInterruptedRestores(logs);
  assert.equal((await state(uncertain.restoreId)).status, "FAILED");
  await absent(uncertainTarget);
  console.log("PASS 提交证明不可读时保留RESTORING与owned目录，后续协调补偿");

  // TTL同时保护备份和恢复活跃句柄、活跃上传；明文stage只清24h旧残留。
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const uploads = join(root, "system-transfer", "uploads");
  await fs.mkdir(uploads, { recursive: true });
  const orphan = join(uploads, `preflight-${randomUUID()}`);
  await fs.mkdir(orphan);
  await fs.writeFile(join(orphan, "payload.zip"), "old plaintext");
  await fs.utimes(orphan, old, old);
  await pruneSystemTransferFiles();
  await absent(orphan);
  const inFlight = await createRestoreUploadFile(randomUUID());
  try {
    await new Promise<void>((resolve, reject) =>
      inFlight.stream.write("live", (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    await fs.utimes(inFlight.path, old, old);
    await pruneSystemTransferFiles();
    await fs.stat(inFlight.path);
  } finally {
    inFlight.stream.end();
    await new Promise<void>((resolve) => inFlight.stream.on("close", resolve));
  }
  await pruneSystemTransferFiles();
  await absent(inFlight.path);
  const live = await record();
  const upload = await createRestoreUploadFile(live.id);
  upload.stream.end("encrypted upload");
  await new Promise<void>((resolve, reject) => {
    upload.stream.on("close", resolve);
    upload.stream.on("error", reject);
  });
  await db
    .update(systemRestore)
    .set({ uploadPath: upload.path })
    .where(eq(systemRestore.id, live.id));
  await fs.utimes(upload.path, old, old);
  const key = Buffer.alloc(32, 3);
  const handle = await writeTemporaryKeyHandle(live.id, key);
  key.fill(0);
  await fs.utimes(handle.path, old, old);
  await db.insert(job).values({
    kind: "restore.system",
    payload: { restoreId: live.id, dataKeyHandle: handle.handle },
  });
  const protectedStage = join(uploads, `preflight-${randomUUID()}`);
  await fs.mkdir(protectedStage);
  await fs.utimes(protectedStage, old, old);
  await pruneSystemTransferFiles();
  await fs.stat(upload.path);
  await fs.stat(handle.path);
  await fs.stat(protectedStage);
  await sql`update job set status='DEAD' where payload->>'restoreId'=${live.id}`;
  await recoverInterruptedRestores(logs);
  await pruneSystemTransferFiles();
  await absent(protectedStage);
  const authenticated = await authenticateAndReadManifest(
    fixture.path,
    fixturePassword,
  );
  try {
    await withAuthenticatedRestoreArchive(
      fixture.path,
      authenticated.dataKey,
      async (path) => {
        const directory = join(path, "..");
        await fs.utimes(directory, old, old);
        await pruneSystemTransferFiles();
        await fs.stat(path);
      },
    );
  } finally {
    authenticated.dataKey.fill(0);
  }
  console.log("PASS 24h明文TTL与活跃恢复上传/句柄/回调保护");

  await sql`update job set status='DEAD' where kind='restore.system'`;
  const success = await prepare();
  const queuedHandle = join(
    root,
    "system-transfer",
    "keys",
    createHash("sha256").update(success.dataKeyHandle).digest("hex"),
  );
  const secondApp = await buildApp();
  try {
    assert.equal(
      (await state(success.restoreId)).status,
      "RESTORING",
      "另一实例启动不能终止尚待领取的正常恢复",
    );
    const [queued] =
      await sql`select status, attempts from job where payload->>'restoreId'=${success.restoreId}`;
    assert.equal(queued!.status, "PENDING");
    assert.equal(queued!.attempts, 0);
    await fs.stat(queuedHandle);
    await fs.stat((await state(success.restoreId)).uploadPath);
  } finally {
    await secondApp.close();
  }
  const reserve = sql.reserve;
  let loseCommitReceipt = true;
  sql.reserve = (async (...args: Parameters<typeof reserve>) => {
    const connection = await reserve(...args);
    let writesRestoreMarker = false;
    return new Proxy(connection, {
      get(target, property) {
        if (property === "unsafe")
          return (...query: Parameters<typeof connection.unsafe>) => {
            if (query[0].startsWith('insert into "setup_state"'))
              writesRestoreMarker = true;
            if (query[0] !== "commit" || !writesRestoreMarker)
              return connection.unsafe(...query);
            return (async () => {
              const result = await connection.unsafe(...query);
              if (loseCommitReceipt) {
                loseCommitReceipt = false;
                throw new Error("synthetic lost commit receipt");
              }
              return result;
            })();
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof reserve;
  const cleanupRoot = join(root, "system-restores", success.restoreId);
  fs.rm = async (path, options) => {
    if (String(path) === cleanupRoot)
      throw Object.assign(new Error("synthetic postcommit cleanup failure"), {
        code: "EACCES",
      });
    return remove(path, options);
  };
  try {
    registerBuiltinJobHandlers();
    assert.deepEqual(
      await expectedCommitDiagnostics(
        () => runJobWorkerOnce("attachment-queued-restore", 1),
        true,
      ),
      { claimed: 1, succeeded: 1, failed: 0, unknown: 0 },
    );
  } finally {
    fs.rm = remove;
    sql.reserve = reserve;
  }
  assert.equal(
    (await state(success.restoreId)).status,
    "SUCCEEDED",
    "提交后清理失败不能将恢复改报失败",
  );
  await fs.stat(cleanupRoot);
  await recoverInterruptedRestores(logs);
  await absent(cleanupRoot);
  console.log(
    "PASS 确认后另一实例启动保留队列、句柄、上传，真实worker最终成功",
  );
  const rows = await db.select().from(attachment);
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every(
      (row) =>
        row.storageBackend === "local" &&
        row.storagePath === `restored/${fixture.manifest.packageId}/${hash}`,
    ),
  );
  const files = await fs.readdir(
    join(root, "attachments", "restored", fixture.manifest.packageId),
  );
  assert.equal(files.filter((name) => /^[a-f0-9]{64}$/.test(name)).length, 1);
  const actor = await loadActor(adminId);
  const downloaded = await download(actor!, firstAttachment);
  assert.equal(
    createHash("sha256").update(downloaded.data).digest("hex"),
    hash,
  );
  assert.equal((await state(success.restoreId)).status, "SUCCEEDED");
  await removeAttachment(actor!, firstAttachment);
  await fs.stat(
    join(root, "attachments", "restored", fixture.manifest.packageId, hash),
  );
  await removeAttachment(
    actor!,
    rows.find((row) => row.id !== firstAttachment)!.id,
  );
  await absent(
    join(root, "attachments", "restored", fixture.manifest.packageId, hash),
  );
  console.log("PASS 两行共享一blob，改写local路径，真实下载SHA一致");
  console.log("附件恢复隔离E2E全部通过");
} finally {
  await sql.end();
}
