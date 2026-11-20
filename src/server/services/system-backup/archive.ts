import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable, Writable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";
import { DomainError } from "../../../shared/errors.ts";
import type { BackupMode } from "../../../shared/schemas/system-backup.ts";

export const ARCHIVE_LIMITS = {
  uploadBytes: 10 * 1024 ** 3,
  expandedBytes: 50 * 1024 ** 3,
  files: 200_000,
  pathChars: 240,
  compressionRatio: 100,
} as const;

export type ArchiveKind = "outer" | "inner";
export interface ArchiveTotals {
  files: number;
  compressedBytes: number;
  expandedBytes: number;
}
export interface ArchiveValidationOptions {
  maxFiles?: number;
  maxUploadBytes?: number;
  maxExpandedBytes?: number;
  maxPathChars?: number;
  maxCompressionRatio?: number;
  expectedBytes?: number;
}
export interface OuterArchiveFiles {
  directory: string;
  headerPath: string;
  payloadPath: string;
  cleanup: () => Promise<void>;
}

const invalidBackup = () =>
  new DomainError("INVALID_BACKUP", "迁移包密码错误或文件已损坏", null);

export function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(
      path,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
      },
      (error, zip) => {
        if (error || !zip) reject(invalidBackup());
        else resolveZip(zip);
      },
    );
  });
}

export function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolveEntry, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolveEntry(entry);
    };
    const onEnd = () => {
      cleanup();
      resolveEntry(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      zip.off("entry", onEntry);
      zip.off("end", onEnd);
      zip.off("error", onError);
    };
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

export function entryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolveStream, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? invalidBackup());
      else resolveStream(stream);
    }),
  );
}

function safePath(name: string, maxPathChars: number): void {
  if (
    !name ||
    name.length > maxPathChars ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  )
    throw invalidBackup();
  const normalized = posix.normalize(name);
  if (
    normalized !== name ||
    normalized === "." ||
    normalized.split("/").some((part) => part === ".." || part === "")
  )
    throw invalidBackup();
}

function allowedEntry(
  name: string,
  kind: ArchiveKind,
  mode: BackupMode,
): boolean {
  if (kind === "outer") return name === "header.json" || name === "payload.enc";
  return (
    name === "manifest.json" ||
    /^data\/[A-Za-z0-9_.-]+\.jsonl$/.test(name) ||
    /^blobs\/[a-f0-9]{64}$/.test(name) ||
    (mode === "full" && name === "secrets/source-master-key.bin")
  );
}

function isSymlink(entry: Entry): boolean {
  const unixMode = entry.externalFileAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  return fileType !== 0 && fileType !== 0o100000;
}

async function consumeAndCount(stream: Readable): Promise<number> {
  let bytes = 0;
  for await (const chunk of stream)
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
  return bytes;
}

export async function validateArchiveEntries(
  path: string,
  kind: ArchiveKind,
  options: ArchiveValidationOptions = {},
  mode: BackupMode = "safe",
): Promise<ArchiveTotals> {
  const limits = {
    maxFiles: options.maxFiles ?? ARCHIVE_LIMITS.files,
    maxUploadBytes: options.maxUploadBytes ?? ARCHIVE_LIMITS.uploadBytes,
    maxExpandedBytes: options.maxExpandedBytes ?? ARCHIVE_LIMITS.expandedBytes,
    maxPathChars: options.maxPathChars ?? ARCHIVE_LIMITS.pathChars,
    maxCompressionRatio:
      options.maxCompressionRatio ?? ARCHIVE_LIMITS.compressionRatio,
  };
  const totals: ArchiveTotals = {
    files: 0,
    compressedBytes: 0,
    expandedBytes: 0,
  };
  const seen = new Set<string>();
  try {
    if ((await stat(path)).size > limits.maxUploadBytes) throw invalidBackup();
  } catch {
    throw invalidBackup();
  }
  const zip = await openZip(path);
  try {
    for (
      let entry = await nextEntry(zip);
      entry;
      entry = await nextEntry(zip)
    ) {
      safePath(entry.fileName, limits.maxPathChars);
      if (
        !allowedEntry(entry.fileName, kind, mode) ||
        seen.has(entry.fileName) ||
        isSymlink(entry)
      )
        throw invalidBackup();
      seen.add(entry.fileName);
      totals.files++;
      totals.compressedBytes += entry.compressedSize;
      totals.expandedBytes += entry.uncompressedSize;
      if (
        totals.files > limits.maxFiles ||
        totals.compressedBytes > limits.maxUploadBytes ||
        totals.expandedBytes > limits.maxExpandedBytes
      )
        throw invalidBackup();
      if (
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize >
            limits.maxCompressionRatio)
      )
        throw invalidBackup();
      const actualBytes = await consumeAndCount(await entryStream(zip, entry));
      if (actualBytes !== entry.uncompressedSize) throw invalidBackup();
    }
    if (
      options.expectedBytes !== undefined &&
      totals.expandedBytes !== options.expectedBytes
    )
      throw invalidBackup();
    if (
      kind === "outer" &&
      (!seen.has("header.json") || !seen.has("payload.enc"))
    )
      throw invalidBackup();
    return totals;
  } catch {
    throw invalidBackup();
  } finally {
    zip.close();
  }
}

type ArchiveSource = Buffer | Readable | string;

function addSource(zip: yazl.ZipFile, source: ArchiveSource, name: string) {
  if (Buffer.isBuffer(source)) zip.addBuffer(source, name);
  else
    zip.addReadStream(
      typeof source === "string" ? createReadStream(source) : source,
      name,
    );
}

export async function writeOuterArchive(
  output: string | Writable,
  header: ArchiveSource,
  payload: ArchiveSource,
): Promise<void> {
  const zip = new yazl.ZipFile();
  addSource(zip, header, "header.json");
  addSource(zip, payload, "payload.enc");
  zip.end();
  const destination =
    typeof output === "string"
      ? createWriteStream(output, { flags: "wx", mode: 0o600 })
      : output;
  await pipeline(zip.outputStream, destination);
}

export async function openOuterArchive(
  path: string,
): Promise<OuterArchiveFiles> {
  await validateArchiveEntries(path, "outer");
  const directory = await mkdtemp(join(tmpdir(), "feronavi-backup-"));
  const files: OuterArchiveFiles = {
    directory,
    headerPath: join(directory, "header.json"),
    payloadPath: join(directory, "payload.enc"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
  const zip = await openZip(path);
  try {
    for (
      let entry = await nextEntry(zip);
      entry;
      entry = await nextEntry(zip)
    ) {
      const target =
        entry.fileName === "header.json" ? files.headerPath : files.payloadPath;
      await pipeline(
        await entryStream(zip, entry),
        createWriteStream(target, { flags: "wx", mode: 0o600 }),
      );
    }
    return files;
  } catch {
    await files.cleanup();
    throw invalidBackup();
  } finally {
    zip.close();
  }
}

export async function writeInnerArchive(
  path: string,
  entries: Iterable<{ path: string; source: ArchiveSource }>,
  mode: BackupMode = "safe",
): Promise<void> {
  const zip = new yazl.ZipFile();
  const seen = new Set<string>();
  for (const entry of entries) {
    safePath(entry.path, ARCHIVE_LIMITS.pathChars);
    if (!allowedEntry(entry.path, "inner", mode) || seen.has(entry.path))
      throw invalidBackup();
    seen.add(entry.path);
    addSource(zip, entry.source, entry.path);
  }
  zip.end();
  await pipeline(
    zip.outputStream,
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
}

export function resolveExtractPath(root: string, entryName: string): string {
  safePath(entryName, ARCHIVE_LIMITS.pathChars);
  const rootPath = resolve(root);
  const target = resolve(rootPath, ...entryName.split("/"));
  if (target !== rootPath && !target.startsWith(rootPath + sep))
    throw invalidBackup();
  return target;
}

export function createArchiveTempPath(prefix = "feronavi-archive-"): string {
  return join(tmpdir(), basename(prefix) + randomUUID());
}
