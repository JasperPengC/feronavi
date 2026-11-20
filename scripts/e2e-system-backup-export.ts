import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { eq } from "drizzle-orm";
import yauzl from "yauzl";
import { db, sql } from "../src/db/index.ts";
import {
  apiToken,
  attachment,
  member,
  page,
  project,
  role,
  roleAssignment,
  setting,
  twoFactorSecret,
  workItem,
} from "../src/db/schema.ts";
import {
  decryptPayload,
  createEncryptionEnvelope,
} from "../src/server/services/system-backup/crypto.ts";
import {
  estimateSystemBackup,
  exportSystemBackup,
} from "../src/server/services/system-backup/exporter.ts";
import {
  backupPath,
  writeTemporaryKeyHandle,
} from "../src/server/services/system-backup/storage.ts";

const databaseUrl = process.env.DATABASE_URL;
const testDirectory = process.env.FERONAVI_TEST_DIRECTORY;
const attachmentDir = process.env.ATTACHMENT_DIR;
if (!databaseUrl || !testDirectory || !attachmentDir)
  throw new Error("必须通过 scripts/run-isolated-test.ts 执行此测试");

function zipEntries(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法打开 ZIP"));
      const entries = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolve(entries));
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream)
            return reject(streamError ?? new Error("无法读取 ZIP 条目"));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

const runId = randomUUID();
const sourceBytes = Buffer.from("private attachment bytes for migration");
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const storagePath = `task4/${runId}.bin`;
const memberId = randomUUID();
const projectId = randomUUID();
const workItemId = randomUUID();
const pageId = randomUUID();
const tokenHash = `TOKEN_HASH_SENTINEL_${runId}`;
const twoFactorCiphertext = `TWO_FACTOR_SENTINEL_${runId}`;
const smtpCiphertext = `SMTP_SECRET_SENTINEL_${runId}`;
const packageId = randomUUID();
let dataKey: Buffer | undefined;

try {
  await mkdir(join(attachmentDir, "task4"), { recursive: true });
  await writeFile(join(attachmentDir, storagePath), sourceBytes);
  const [adminRole] = await db
    .select({ id: role.id })
    .from(role)
    .where(eq(role.key, "ADMIN"))
    .limit(1);
  assert.ok(adminRole, "isolated database must be seeded with ADMIN role");
  await db.insert(member).values({
    id: memberId,
    username: `task4-${runId.slice(0, 8)}`,
    email: `${runId}@test.invalid`,
    name: "Task 4 Export Admin",
    status: "ACTIVE",
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$fixture-password-hash",
  });
  await db.insert(roleAssignment).values({
    memberId,
    roleId: adminRole.id,
    scopeType: "ORG",
    scopeId: null,
  });
  await db.insert(project).values({
    id: projectId,
    key: `T${runId.slice(0, 7).toUpperCase()}`,
    name: "Task 4 export fixture",
    createdBy: memberId,
  });
  const workflow = (
    await sql<
      { id: string }[]
    >`select id from workflow where project_id is null and applies_to_type = 'TASK' limit 1`
  )[0];
  assert.ok(workflow, "isolated database must contain a TASK workflow");
  const state = (
    await sql<
      { id: string }[]
    >`select id from workflow_state where workflow_id = ${workflow.id} order by sort_order limit 1`
  )[0];
  assert.ok(state, "isolated database must contain a workflow state");
  await db.insert(workItem).values({
    id: workItemId,
    projectId,
    number: 1,
    key: `T${runId.slice(0, 7).toUpperCase()}-1`,
    type: "TASK",
    title: "Task 4 export fixture",
    workflowId: workflow.id,
    statusId: state.id,
    reporterId: memberId,
  });
  await db.insert(page).values({
    id: pageId,
    projectId,
    title: "Task 4 page fixture",
    slug: `task4-${runId}`,
  });
  await db.insert(attachment).values({
    targetType: "PAGE",
    targetId: pageId,
    uploaderId: memberId,
    originalName: "fixture.bin",
    storagePath,
    mimeType: "application/octet-stream",
    sizeBytes: sourceBytes.byteLength,
    contentHash: sourceHash,
    storageBackend: "local",
  });
  await db.insert(apiToken).values({
    memberId,
    name: "migration exclusion fixture",
    tokenHash,
    tokenPrefix: "fixture",
    tier: "READ_ONLY",
  });
  await db
    .insert(twoFactorSecret)
    .values({ memberId, secretEncrypted: twoFactorCiphertext });
  await db.insert(setting).values({
    key: `smtp.password.${runId}`,
    value: smtpCiphertext,
    isSecret: true,
  });

  const created = await createEncryptionEnvelope("task4-migration-password");
  dataKey = created.dataKey;
  const key = await writeTemporaryKeyHandle(packageId, dataKey);
  const result = await exportSystemBackup({
    backupId: packageId,
    mode: "safe",
    requestedBy: memberId,
    dataKeyHandle: key.handle,
    keyEnvelope: created.keyEnvelope,
  });
  assert.equal(result.packagePath, backupPath(packageId));
  assert.ok(result.bytes > 0);
  const outer = await zipEntries(result.packagePath);
  const header = JSON.parse(outer.get("header.json")!.toString("utf8")) as {
    payloadBytes: number;
    payloadSha256: string;
    encryption: { payloadNonce: string; payloadTag: string };
  };
  const encryptedPayload = outer.get("payload.enc")!;
  assert.equal(header.payloadBytes, encryptedPayload.byteLength);
  assert.equal(
    header.payloadSha256,
    createHash("sha256").update(encryptedPayload).digest("hex"),
  );
  const plainPath = join(testDirectory, "task4-payload.zip");
  const plaintextOutput = createWriteStream(plainPath);
  const plaintextFinished = finished(plaintextOutput);
  await decryptPayload(
    (await import("node:stream")).Readable.from([encryptedPayload]),
    plaintextOutput,
    dataKey,
    header.encryption,
  );
  await plaintextFinished;
  const entries = await zipEntries(plainPath);
  const content = [...entries.values()]
    .map((entry) => entry.toString("utf8"))
    .join("\n");
  assert.match(
    content,
    /\$argon2id\$v=19\$m=65536,t=3,p=4\$fixture-password-hash/u,
  );
  assert.ok(
    entries.has(`blobs/${sourceHash}`),
    "safe package includes content-addressed attachment blob",
  );
  assert.deepEqual(entries.get(`blobs/${sourceHash}`), sourceBytes);
  assert.ok(entries.has(`data/content.attachment.jsonl`));
  assert.ok(entries.has(`data/projects.work_item.jsonl`));
  assert.ok(entries.has(`data/content.page.jsonl`));
  assert.ok(!content.includes(tokenHash), "API token hash is excluded");
  assert.ok(
    !content.includes(twoFactorCiphertext),
    "2FA ciphertext is excluded",
  );
  assert.ok(!content.includes("two_factor_secret"), "2FA data is excluded");
  assert.ok(
    !content.includes("enc:v1:"),
    "encrypted SMTP/third-party secrets are excluded",
  );
  assert.ok(!content.includes(smtpCiphertext), "SMTP secret is excluded");

  const slowId = randomUUID();
  const slowEnvelope = await createEncryptionEnvelope(
    "task4-migration-password",
  );
  const slowHandle = await writeTemporaryKeyHandle(
    slowId,
    slowEnvelope.dataKey,
  );
  slowEnvelope.dataKey.fill(0);
  const handleRecord = JSON.parse(await readFile(slowHandle.path, "utf8")) as {
    expiresAt: string;
  };
  handleRecord.expiresAt = new Date(Date.now() + 500).toISOString();
  await writeFile(slowHandle.path, JSON.stringify(handleRecord));
  let releaseLock!: () => void;
  let signalLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const lockTask = sql.begin(async (connection) => {
    await connection`lock table organization in access exclusive mode`;
    signalLocked();
    await release;
  });
  await locked;
  const slowExport = exportSystemBackup({
    backupId: slowId,
    mode: "safe",
    requestedBy: memberId,
    dataKeyHandle: slowHandle.handle,
    keyEnvelope: slowEnvelope.keyEnvelope,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  releaseLock();
  await lockTask;
  const slowResult = await slowExport;
  assert.ok(
    slowResult.bytes > 0,
    "key handle is consumed before the locked snapshot work",
  );

  const corruptId = randomUUID();
  const corrupt = await createEncryptionEnvelope("task4-migration-password");
  const corruptHandle = await writeTemporaryKeyHandle(
    corruptId,
    corrupt.dataKey,
  );
  corrupt.dataKey.fill(0);
  await writeFile(
    join(attachmentDir, storagePath),
    Buffer.from("tampered attachment"),
  );
  const estimate = await estimateSystemBackup("safe");
  assert.equal(estimate.attachmentCount, 1);
  assert.equal(estimate.blobCount, 1);
  assert.equal(estimate.blobBytes, sourceBytes.byteLength);
  assert.ok(estimate.excludedData.some((item) => item.key === "api_tokens"));
  assert.ok(
    estimate.excludedData.some(
      (item) => item.key === "two_factor_authentication",
    ),
  );
  await assert.rejects(
    exportSystemBackup({
      backupId: corruptId,
      mode: "safe",
      requestedBy: memberId,
      dataKeyHandle: corruptHandle.handle,
      keyEnvelope: corrupt.keyEnvelope,
    }),
    { code: "INVALID_BACKUP" },
  );
  await assert.rejects(readFile(backupPath(corruptId)));
  console.log(
    "Safe system backup export passed: secrets excluded, attachment verified, tampering publishes no package.",
  );
} finally {
  dataKey?.fill(0);
  await rm(join(testDirectory, "task4-payload.zip"), { force: true });
  await sql.end();
}
