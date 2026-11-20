import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { currentAppVersion } from "../app-version.ts";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { PassThrough, Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { sql as drizzleSql } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { masterKey } from "../crypto.service.ts";
import { DomainError } from "../../../shared/errors.ts";
import {
  keyEnvelopeSchema,
  manifestSchema,
  systemBackupHeaderSchema,
  type BackupMode,
  type KeyEnvelope,
  type SystemBackupManifest,
} from "../../../shared/schemas/system-backup.ts";
import { encryptPayload } from "./crypto.ts";
import {
  validateArchiveEntries,
  writeInnerArchive,
  writeOuterArchive,
} from "./archive.ts";
import { assertRecoverableLocalAdmin, orderedDatasets } from "./registry.ts";
import {
  backupPath,
  createBackupStageDirectory,
  consumeTemporaryKeyHandle,
  createBackupFile,
} from "./storage.ts";
import { finalizeStagedPackage } from "./publisher.ts";
import {
  readAttachmentBlob,
  type AttachmentBlobRow,
} from "./attachment-blobs.ts";

const BATCH_SIZE = 500;
const invalidBackup = () =>
  new DomainError("INVALID_BACKUP", "迁移包密码错误或文件已损坏", null);

export interface ExportSystemBackupInput {
  backupId: string;
  mode: BackupMode;
  requestedBy: string;
  dataKeyHandle: string;
  keyEnvelope: KeyEnvelope;
}

export interface BackupManifestSummary {
  mode: BackupMode;
  datasetCount: number;
  totalRows: number;
  blobCount: number;
  blobBytes: number;
  excludedData: SystemBackupManifest["excludedData"];
}

export interface ExportSystemBackupResult {
  packagePath: string;
  bytes: number;
  header: ReturnType<typeof systemBackupHeaderSchema.parse>;
  manifestSummary: BackupManifestSummary;
}

export interface SystemBackupEstimate {
  mode: BackupMode;
  datasets: Array<{ name: string; rows: number }>;
  totalRows: number;
  attachmentCount: number;
  blobCount: number;
  blobBytes: number;
  excludedData: SystemBackupManifest["excludedData"];
}

const excludedData = (
  mode: BackupMode,
): SystemBackupManifest["excludedData"] =>
  mode === "safe"
    ? [
        {
          key: "api_tokens",
          reason: "安全模式不迁移可用于身份认证的 API Token",
        },
        {
          key: "two_factor_authentication",
          reason: "安全模式不迁移双因素认证密钥",
        },
        { key: "smtp_credentials", reason: "安全模式不迁移 SMTP 凭据" },
        {
          key: "third_party_credentials",
          reason: "安全模式不迁移第三方集成密钥",
        },
        {
          key: "sessions_and_ephemeral_tokens",
          reason: "会话及一次性认证令牌不属于可迁移数据",
        },
      ]
    : [
        {
          key: "sessions_and_ephemeral_tokens",
          reason: "会话及一次性认证令牌不属于可迁移数据",
        },
      ];

const queryRows = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  dataset: ReturnType<typeof orderedDatasets>[number],
  offset: number,
) => {
  const columns = drizzleSql.join(
    dataset.columns.map((column) => drizzleSql.identifier(column)),
    drizzleSql`, `,
  );
  const order = drizzleSql.join(
    dataset.orderBy.map((column) => drizzleSql.identifier(column)),
    drizzleSql`, `,
  );
  const result = (await tx.execute(
    drizzleSql`select ${columns} from ${drizzleSql.identifier(dataset.tableName)} order by ${order} limit ${BATCH_SIZE} offset ${offset}`,
  )) as unknown as
    { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
};

async function raceWithStream<T>(
  operation: Promise<T>,
  streamDone: Promise<void>,
): Promise<T> {
  return Promise.race([
    operation,
    streamDone.then(() => {
      throw new Error("JSONL 输出流在任务完成前关闭");
    }),
  ]);
}

async function writeChunk(
  stream: NodeJS.WritableStream,
  value: string,
  streamDone?: Promise<void>,
): Promise<void> {
  if (!stream.write(value)) {
    const drained = once(stream, "drain").then(() => undefined);
    if (streamDone) await raceWithStream(drained, streamDone);
    else await drained;
  }
}

async function scanDataset(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  dataset: ReturnType<typeof orderedDatasets>[number],
  mode: BackupMode,
  output?: string,
): Promise<{ rows: number; bytes: number; sha256: string }> {
  const digest = createHash("sha256");
  let rowsWritten = 0;
  let bytes = 0;
  const destination = output
    ? createWriteStream(output, { flags: "wx", mode: 0o600 })
    : undefined;
  const streamDone = destination ? finished(destination) : undefined;
  // Attach a rejection handler immediately; the same promise is awaited below to propagate failures.
  streamDone?.catch(() => undefined);
  try {
    for (let offset = 0; ; offset += BATCH_SIZE) {
      const query = queryRows(tx, dataset, offset);
      const batch = streamDone
        ? await raceWithStream(query, streamDone)
        : await query;
      for (const row of batch) {
        const encoded = dataset.encodeRow(row, { mode, purpose: "migration" });
        if (encoded === null) continue;
        const line = `${JSON.stringify(encoded)}\n`;
        const lineBytes = Buffer.byteLength(line);
        digest.update(line);
        bytes += lineBytes;
        rowsWritten++;
        if (destination) await writeChunk(destination, line, streamDone);
      }
      if (batch.length < BATCH_SIZE) break;
    }
  } catch (error) {
    destination?.destroy();
    await streamDone?.catch(() => undefined);
    if (output) await rm(output, { force: true }).catch(() => undefined);
    throw error;
  }
  if (destination) {
    destination.end();
    await streamDone;
  }
  return { rows: rowsWritten, bytes, sha256: digest.digest("hex") };
}

export function writeDatasetJsonl(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  dataset: ReturnType<typeof orderedDatasets>[number],
  input: { mode: BackupMode; output: string },
): Promise<{ rows: number; bytes: number; sha256: string }> {
  return scanDataset(tx, dataset, input.mode, input.output);
}

async function withReadonlySnapshot<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      drizzleSql`set transaction isolation level repeatable read read only`,
    );
    return fn(tx);
  });
}

async function estimateInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  mode: BackupMode,
): Promise<SystemBackupEstimate> {
  const datasets: SystemBackupEstimate["datasets"] = [];
  for (const dataset of orderedDatasets(mode)) {
    const count = await scanDataset(tx, dataset, mode);
    datasets.push({ name: dataset.name, rows: count.rows });
  }
  const totals = (await tx.execute(
    drizzleSql`select count(*)::bigint as count, coalesce(sum(bytes), 0)::bigint as bytes from (select min(size_bytes) as bytes from attachment group by content_hash) blobs`,
  )) as unknown as { count: number | string; bytes: number | string }[];
  const [blobTotals] = totals;
  const attachmentCount =
    datasets.find((dataset) => dataset.name === "content.attachment")?.rows ??
    0;
  return {
    mode,
    datasets,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.rows, 0),
    attachmentCount,
    blobCount: Number(blobTotals?.count ?? 0),
    blobBytes: Number(blobTotals?.bytes ?? 0),
    excludedData: excludedData(mode),
  };
}

export function estimateSystemBackup(
  mode: BackupMode,
): Promise<SystemBackupEstimate> {
  return withReadonlySnapshot((tx) => estimateInTransaction(tx, mode));
}

async function readPackageMetadata(): Promise<{
  sourceAppVersion: string;
  sourceBuild: string;
  sourceDatabaseRevision: string;
}> {
  const sourceAppVersion = currentAppVersion;
  let sourceDatabaseRevision = "unknown";
  try {
    const revisions = (await db.execute(
      drizzleSql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    )) as unknown as { hash: string }[];
    sourceDatabaseRevision = revisions[0]?.hash ?? "unknown";
  } catch {
    /* migration table may be absent in a partially initialized instance */
  }
  return {
    sourceAppVersion,
    sourceBuild: process.env.BUILD_SHA ?? process.env.GIT_COMMIT ?? "unknown",
    sourceDatabaseRevision,
  };
}

async function* readAttachmentRows(
  jsonlPath: string,
): AsyncGenerator<AttachmentBlobRow> {
  const hashes = new Map<string, number>();
  const lines = createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    const contentHash = row.content_hash;
    if (typeof contentHash !== "string") continue;
    const sizeBytes = Number(row.size_bytes);
    const existingSize = hashes.get(contentHash);
    if (existingSize !== undefined) {
      if (existingSize !== sizeBytes) throw invalidBackup();
      continue;
    }
    hashes.set(contentHash, sizeBytes);
    yield {
      storagePath: String(row.storage_path),
      storageBackend: row.storage_backend as "local" | "s3",
      sizeBytes,
      contentHash,
    };
  }
}

async function writeAtomicJson(path: string, data: unknown): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(data)}\n`, "utf8");
  } finally {
    await file.close();
  }
}

export async function exportSystemBackup(
  input: ExportSystemBackupInput,
): Promise<ExportSystemBackupResult> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.backupId,
    ) ||
    !input.requestedBy
  )
    throw invalidBackup();
  const envelope = keyEnvelopeSchema.parse(input.keyEnvelope);
  let stageDirectory: string | undefined;
  let stagedPackage: string | undefined;
  let dataKey: Buffer | undefined;
  let sourceMasterKey: Buffer | undefined;
  let stageCleaned = false;
  try {
    dataKey = await consumeTemporaryKeyHandle(input.dataKeyHandle);
    const stageDir = await createBackupStageDirectory(input.backupId);
    stageDirectory = stageDir;
    const dataDir = join(stageDir, "data");
    const blobDir = join(stageDir, "blobs");
    await chmod(stageDir, 0o700);
    await Promise.all([
      mkdir(dataDir, { mode: 0o700 }),
      mkdir(blobDir, { mode: 0o700 }),
    ]);
    const datasets = await withReadonlySnapshot(async (tx) => {
      // 快照真正开始时再次检查，覆盖排队期间管理员被禁用/移除的窗口。
      await assertRecoverableLocalAdmin(input.mode);
      const details: SystemBackupManifest["datasets"] = [];
      for (const dataset of orderedDatasets(input.mode)) {
        const path = join(dataDir, `${dataset.name}.jsonl`);
        const result = await scanDataset(tx, dataset, input.mode, path);
        details.push({
          name: dataset.name,
          schemaVersion: dataset.schemaVersion,
          path: `data/${dataset.name}.jsonl`,
          ...result,
          dependsOn: [...dataset.dependsOn],
        });
      }
      return details;
    });

    if (input.mode === "full") {
      sourceMasterKey = Buffer.from(masterKey());
      const secretsDir = join(stageDir, "secrets");
      await mkdir(secretsDir, { mode: 0o700 });
      await writeFile(
        join(secretsDir, "source-master-key.bin"),
        sourceMasterKey,
        { flag: "wx", mode: 0o600 },
      );
    }

    const attachmentDataset = datasets.find(
      (dataset) => dataset.name === "content.attachment",
    );
    const blobEntries: SystemBackupManifest["blobs"]["entries"] = [];
    let blobBytes = 0;
    const attachmentRowsPath = join(dataDir, "content.attachment.jsonl");
    if (attachmentDataset)
      for await (const blob of readAttachmentRows(attachmentRowsPath)) {
        if (!/^[a-f0-9]{64}$/u.test(blob.contentHash)) throw invalidBackup();
        const bytes = await readAttachmentBlob(blob);
        const blobPath = join(blobDir, blob.contentHash);
        await writeFile(blobPath, bytes, { flag: "wx", mode: 0o600 });
        blobEntries.push({
          sha256: blob.contentHash,
          bytes: bytes.byteLength,
          path: `blobs/${blob.contentHash}`,
        });
        blobBytes += bytes.byteLength;
      }

    const createdAt = new Date().toISOString();
    const metadata = await readPackageMetadata();
    const manifest = manifestSchema.parse({
      format: "feronavi-system-backup",
      formatVersion: 1,
      dataSchemaVersion: 1,
      packageId: input.backupId,
      mode: input.mode,
      createdAt,
      ...metadata,
      requiredFeatures: ["persistent-collaboration-and-conversations"],
      capabilities: [
        "database-snapshot",
        "attachment-blobs",
        "password-encrypted",
      ],
      datasets,
      blobs: {
        count: blobEntries.length,
        bytes: blobBytes,
        entries: blobEntries,
      },
      excludedData: excludedData(input.mode),
      encryptionRewrapVersion: 1,
    });
    const manifestPath = join(stageDir, "manifest.json");
    await writeAtomicJson(manifestPath, manifest);
    const innerPath = join(stageDir, "payload.zip");
    const innerEntries = [
      { path: "manifest.json", source: manifestPath },
      ...datasets.map((dataset) => ({
        path: dataset.path,
        source: join(stageDir, dataset.path),
      })),
      ...blobEntries.map((blob) => ({
        path: blob.path,
        source: join(stageDir, blob.path),
      })),
      ...(sourceMasterKey
        ? [
            {
              path: "secrets/source-master-key.bin",
              source: join(stageDir, "secrets/source-master-key.bin"),
            },
          ]
        : []),
    ];
    await writeInnerArchive(innerPath, innerEntries, input.mode);
    await validateArchiveEntries(innerPath, "inner", {}, input.mode);

    const encryptedPath = join(stageDir, "payload.enc");
    const output = new PassThrough();
    const payloadHash = createHash("sha256");
    const hashTap = new Transform({
      transform(chunk, _encoding, callback) {
        payloadHash.update(chunk);
        callback(null, chunk);
      },
    });
    const writeEncrypted = pipeline(
      output,
      hashTap,
      createWriteStream(encryptedPath, { flags: "wx", mode: 0o600 }),
    );
    const payloadEncryption = await encryptPayload(
      createReadStream(innerPath),
      output,
      dataKey,
    );
    await writeEncrypted;
    const payloadInfo = await stat(encryptedPath);
    const header = systemBackupHeaderSchema.parse({
      format: "feronavi-system-backup",
      formatVersion: 1,
      createdAt,
      payloadBytes: payloadInfo.size,
      payloadSha256: payloadHash.digest("hex"),
      encryption: { ...envelope, ...payloadEncryption },
    });
    const headerPath = join(stageDir, "header.json");
    await writeAtomicJson(headerPath, header);
    const outerPath = join(stageDir, "package.fnbak");
    await writeOuterArchive(outerPath, headerPath, encryptedPath);
    await validateArchiveEntries(outerPath, "outer", {}, input.mode);
    const destination = backupPath(input.backupId);
    await access(destination).then(
      () => {
        throw invalidBackup();
      },
      () => undefined,
    );
    const temporary = await createBackupFile(`stage-${randomUUID()}`);
    stagedPackage = temporary.path;
    await pipeline(createReadStream(outerPath), temporary.stream);
    const packageBytes = await finalizeStagedPackage(
      stagedPackage,
      destination,
      stageDir,
    );
    stagedPackage = undefined;
    stageCleaned = true;
    return {
      packagePath: destination,
      bytes: packageBytes,
      header,
      manifestSummary: {
        mode: input.mode,
        datasetCount: manifest.datasets.length,
        totalRows: manifest.datasets.reduce(
          (sum, dataset) => sum + dataset.rows,
          0,
        ),
        blobCount: manifest.blobs.count,
        blobBytes: manifest.blobs.bytes,
        excludedData: manifest.excludedData,
      },
    };
  } catch (error) {
    if (error instanceof DomainError && error.code === "INVALID_BACKUP")
      throw error;
    throw error;
  } finally {
    dataKey?.fill(0);
    sourceMasterKey?.fill(0);
    if (stagedPackage) await rm(stagedPackage, { force: true });
    if (stageDirectory && !stageCleaned)
      await rm(stageDirectory, { recursive: true, force: true });
  }
}
