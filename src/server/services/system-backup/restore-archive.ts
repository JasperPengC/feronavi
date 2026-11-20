import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import type { Entry, ZipFile } from "yauzl";
import { DomainError } from "../../../shared/errors.ts";
import {
  manifestSchema,
  systemBackupHeaderSchema,
  type SystemBackupHeader,
  type SystemBackupManifest,
} from "../../../shared/schemas/system-backup.ts";
import {
  ARCHIVE_LIMITS,
  entryStream,
  nextEntry,
  openZip,
  validateArchiveEntries,
} from "./archive.ts";
import { decryptPayload, unwrapDataKey } from "./crypto.ts";
import {
  assertCompatibleManifest,
  assertRestoreCapacity,
  incompatibleBackup,
} from "./compatibility.ts";

const invalidBackup = () =>
  new DomainError("INVALID_BACKUP", "迁移包密码错误或文件已损坏", null);
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const activeArchiveDirectories = new Set<string>();
export function isActiveRestoreArchiveDirectory(path: string): boolean {
  return activeArchiveDirectories.has(path);
}

function limit(name: string, maximum: number): number {
  const value = process.env[name];
  if (value === undefined) return maximum;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum)
    throw new DomainError("VALIDATION", "迁移限制配置不合法", null);
  return number;
}

export function restoreLimits() {
  return {
    maxUploadBytes: limit(
      "SYSTEM_BACKUP_MAX_BYTES",
      ARCHIVE_LIMITS.uploadBytes,
    ),
    maxExpandedBytes: limit(
      "SYSTEM_BACKUP_MAX_EXPANDED_BYTES",
      ARCHIVE_LIMITS.expandedBytes,
    ),
    maxFiles: limit("SYSTEM_BACKUP_MAX_FILES", ARCHIVE_LIMITS.files),
    maxPathChars: limit(
      "SYSTEM_BACKUP_MAX_PATH_CHARS",
      ARCHIVE_LIMITS.pathChars,
    ),
    maxCompressionRatio: limit(
      "SYSTEM_BACKUP_MAX_COMPRESSION_RATIO",
      ARCHIVE_LIMITS.compressionRatio,
    ),
  };
}

async function jsonEntry(
  zip: ZipFile,
  entry: Entry,
): Promise<Record<string, unknown>> {
  if (entry.uncompressedSize > MAX_METADATA_BYTES) throw invalidBackup();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of await entryStream(zip, entry)) {
    bytes += chunk.length;
    if (bytes > MAX_METADATA_BYTES) throw invalidBackup();
    chunks.push(Buffer.from(chunk));
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalidBackup();
  return value as Record<string, unknown>;
}

async function outerEntries(
  path: string,
): Promise<{ zip: ZipFile; header: SystemBackupHeader; payload: Entry }> {
  const limits = restoreLimits();
  if ((await stat(path)).size > limits.maxUploadBytes) throw invalidBackup();
  const zip = await openZip(path);
  try {
    const entries = new Map<string, Entry>();
    for (
      let entry = await nextEntry(zip);
      entry;
      entry = await nextEntry(zip)
    ) {
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        !["header.json", "payload.enc"].includes(entry.fileName) ||
        entries.has(entry.fileName) ||
        (fileType !== 0 && fileType !== 0o100000) ||
        entry.fileName.length > limits.maxPathChars ||
        entry.uncompressedSize > limits.maxUploadBytes ||
        (entry.uncompressedSize > 0 &&
          entry.uncompressedSize / Math.max(1, entry.compressedSize) >
            limits.maxCompressionRatio)
      )
        throw invalidBackup();
      entries.set(entry.fileName, entry);
    }
    if (entries.size !== 2 || entries.size > limits.maxFiles)
      throw invalidBackup();
    const raw = await jsonEntry(zip, entries.get("header.json")!);
    if (typeof raw.formatVersion === "number" && raw.formatVersion > 1)
      throw incompatibleBackup();
    const header = systemBackupHeaderSchema.parse(raw);
    const payload = entries.get("payload.enc")!;
    if (payload.uncompressedSize !== header.payloadBytes) throw invalidBackup();
    return { zip, header, payload };
  } catch (error) {
    zip.close();
    if (error instanceof DomainError) throw error;
    throw invalidBackup();
  }
}

/** 上传阶段仅读header和ZIP目录，不解密或读取payload内容。 */
export async function readOuterHeader(
  path: string,
): Promise<SystemBackupHeader> {
  const outer = await outerEntries(path);
  outer.zip.close();
  return outer.header;
}

async function verifyInner(path: string): Promise<SystemBackupManifest> {
  const limits = restoreLimits();
  // 先按full的路径并集验证；知道manifest.mode后再严格核对其精确entry集合。
  const totals = await validateArchiveEntries(
    path,
    "inner",
    { ...limits, maxUploadBytes: limits.maxExpandedBytes },
    "full",
  );
  const zip = await openZip(path);
  try {
    const entries = new Map<string, Entry>();
    for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip))
      entries.set(entry.fileName, entry);
    const manifestEntry = entries.get("manifest.json");
    if (!manifestEntry) throw invalidBackup();
    const raw = await jsonEntry(zip, manifestEntry);
    if (
      (typeof raw.formatVersion === "number" && raw.formatVersion > 1) ||
      (typeof raw.dataSchemaVersion === "number" &&
        raw.dataSchemaVersion > 1) ||
      (typeof raw.encryptionRewrapVersion === "number" &&
        raw.encryptionRewrapVersion > 1)
    )
      throw incompatibleBackup();
    const manifest = manifestSchema.parse(raw);
    assertCompatibleManifest(manifest);
    const space = await statfs(dirname(path));
    assertRestoreCapacity(0, totals.expandedBytes, space.bavail * space.bsize);
    const expected = new Map<
      string,
      { bytes: number; sha256?: string; rows?: number }
    >();
    for (const dataset of manifest.datasets) {
      if (expected.has(dataset.path)) throw invalidBackup();
      expected.set(dataset.path, dataset);
    }
    let blobBytes = 0;
    for (const blob of manifest.blobs.entries) {
      if (blob.path !== `blobs/${blob.sha256}` || expected.has(blob.path))
        throw invalidBackup();
      expected.set(blob.path, blob);
      blobBytes += blob.bytes;
    }
    if (
      manifest.blobs.count !== manifest.blobs.entries.length ||
      manifest.blobs.bytes !== blobBytes
    )
      throw invalidBackup();
    if (manifest.mode === "full")
      expected.set("secrets/source-master-key.bin", { bytes: 32 });
    if (entries.size !== expected.size + 1) throw invalidBackup();
    for (const [name, metadata] of expected) {
      const entry = entries.get(name);
      if (!entry || entry.uncompressedSize !== metadata.bytes)
        throw invalidBackup();
      const stream = await entryStream(zip, entry);
      const hash = createHash("sha256");
      let bytes = 0;
      let rows = 0;
      if (metadata.rows !== undefined) {
        let lineBytes = 0;
        const tap = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            hash.update(chunk);
            for (let start = 0; start < chunk.length;) {
              const newline = chunk.indexOf(10, start);
              const end = newline === -1 ? chunk.length : newline;
              lineBytes += end - start;
              if (lineBytes > MAX_METADATA_BYTES) return done(invalidBackup());
              if (newline === -1) break;
              lineBytes = 0;
              start = newline + 1;
            }
            done(null, chunk);
          },
        });
        const pumping = pipeline(stream, tap);
        const lines = createInterface({ input: tap, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            if (!line || Buffer.byteLength(line) > MAX_METADATA_BYTES)
              throw invalidBackup();
            const row: unknown = JSON.parse(line);
            if (!row || typeof row !== "object" || Array.isArray(row))
              throw invalidBackup();
            rows++;
          }
          await pumping;
        } catch (error) {
          stream.destroy();
          tap.destroy();
          await pumping.catch(() => {});
          throw error;
        }
      } else {
        for await (const chunk of stream) {
          bytes += chunk.length;
          hash.update(chunk);
        }
      }
      if (
        bytes !== metadata.bytes ||
        (metadata.sha256 && hash.digest("hex") !== metadata.sha256) ||
        (metadata.rows !== undefined && rows !== metadata.rows)
      )
        throw invalidBackup();
    }
    return manifest;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidBackup();
  } finally {
    zip.close();
  }
}

/** Task7须再次调用，重新认证并完整复验；返回密钥的所有权交调用者，必须finally清零。 */
export async function authenticateAndReadManifest(
  path: string,
  password: string,
): Promise<{ dataKey: Buffer; manifest: SystemBackupManifest }> {
  const header = await readOuterHeader(path);
  const dataKey = await unwrapDataKey(password, header);
  try {
    const manifest = await withAuthenticatedRestoreArchive(
      path,
      dataKey,
      async (_path, manifest) => manifest,
    );
    return { dataKey, manifest };
  } catch (error) {
    dataKey.fill(0);
    throw error;
  }
}

/** 回调只在GCM/摘要/manifest完整认证后运行；临时ZIP只在回调内有效。密钥仍由调用者清零。 */
export async function withAuthenticatedRestoreArchive<T>(
  path: string,
  dataKey: Buffer,
  consume: (
    innerPath: string,
    manifest: SystemBackupManifest,
    releaseArchive: () => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const outer = await outerEntries(path);
  let directory: string | undefined;
  const releaseArchive = async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      activeArchiveDirectories.delete(directory);
    }
    directory = undefined;
  };
  try {
    if (outer.header.payloadBytes > restoreLimits().maxExpandedBytes)
      throw invalidBackup();
    const space = await statfs(dirname(path));
    assertRestoreCapacity(
      outer.header.payloadBytes,
      0,
      space.bavail * space.bsize,
    );
    // 位于现有uploads目录，崩溃遗留可由其24h TTL清理。
    directory = await mkdtemp(join(dirname(path), "preflight-"));
    activeArchiveDirectories.add(directory);
    const inner = join(directory, "payload.zip");
    const hash = createHash("sha256");
    const stream = await entryStream(outer.zip, outer.payload);
    const tapped = stream.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
    );
    stream.on("error", (error) => tapped.destroy(error));
    const destination = createWriteStream(inner, { flags: "wx", mode: 0o600 });
    let diskError: NodeJS.ErrnoException | undefined;
    destination.on("error", (error: NodeJS.ErrnoException) => {
      diskError = error;
    });
    try {
      await decryptPayload(
        tapped,
        destination,
        dataKey,
        outer.header.encryption,
      );
    } catch (error) {
      if (diskError?.code === "ENOSPC") throw diskError;
      throw error;
    } finally {
      stream.destroy();
      tapped.destroy();
    }
    if (hash.digest("hex") !== outer.header.payloadSha256)
      throw invalidBackup();
    const manifest = await verifyInner(inner);
    const result = await consume(inner, manifest, releaseArchive);
    // 导入方可在提交事务前显式释放；预检则在交出密钥前自动清理。
    await releaseArchive();
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      throw new DomainError(
        "INSUFFICIENT_STORAGE",
        "目标实例磁盘空间不足",
        null,
      );
    if (error instanceof DomainError) throw error;
    throw invalidBackup();
  } finally {
    outer.zip.close();
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } finally {
        activeArchiveDirectories.delete(directory);
      }
    }
  }
}
