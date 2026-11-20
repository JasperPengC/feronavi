import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { type WriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DomainError } from "../../../shared/errors.ts";
import { masterKey } from "../crypto.service.ts";
import { job, systemBackup, systemRestore } from "../../../db/schema.ts";
import { and, inArray } from "drizzle-orm";
import { isActiveRestoreArchiveDirectory } from "./restore-archive.ts";

const HANDLE_TTL_MS = 10 * 60 * 1000;
const DATA_DIR = () => resolve(process.env.DATA_DIR ?? "/tmp/feronavi-data");
const transferRoot = () => join(DATA_DIR(), "system-transfer");
const handleDir = () => join(transferRoot(), "keys");
const backupDir = () => join(transferRoot(), "backups");
const uploadDir = () => join(transferRoot(), "uploads");
const activeTransferFiles = new Set<string>();
const invalidBackup = () =>
  new DomainError("INVALID_BACKUP", "迁移包密码错误或文件已损坏", null);

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new DomainError("VALIDATION", "迁移任务标识不合法", null);
  return id;
}

async function secureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/** 仅解析备份路径；创建文件请使用 createBackupFile。 */
export function backupPath(id: string): string {
  return join(backupDir(), safeId(id) + ".fnbak");
}

/** 仅解析上传路径；创建文件请使用 createRestoreUploadFile。 */
export function restoreUploadPath(id: string): string {
  return join(uploadDir(), safeId(id) + ".upload");
}

export interface PrivateTransferFile {
  path: string;
  stream: WriteStream;
}

async function createPrivateTransferFile(
  path: string,
  directory: string,
): Promise<PrivateTransferFile> {
  await secureDir(directory);
  const file = await open(path, "wx", 0o600);
  try {
    await file.chmod(0o600);
    const stream = file.createWriteStream({ autoClose: true });
    activeTransferFiles.add(path);
    stream.once("close", () => activeTransferFiles.delete(path));
    return { path, stream };
  } catch (error) {
    await file.close();
    await rm(path, { force: true });
    throw error;
  }
}

/** 创建私有备份文件；将返回的 stream 交给 writeOuterArchive 写入。 */
export function createBackupFile(id: string): Promise<PrivateTransferFile> {
  return createPrivateTransferFile(backupPath(id), backupDir());
}

export async function createBackupStageDirectory(
  backupId: string,
): Promise<string> {
  safeId(backupId);
  await secureDir(backupDir());
  const path = join(backupDir(), `stage-${backupId}-${randomUUID()}`);
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

/** 创建私有上传文件；通过返回的 stream 写入上传内容。 */
export function createRestoreUploadFile(
  id: string,
): Promise<PrivateTransferFile> {
  return createPrivateTransferFile(restoreUploadPath(id), uploadDir());
}

export interface TemporaryKeyHandle {
  handle: string;
  path: string;
  expiresAt: Date;
}

export async function writeTemporaryKeyHandle(
  jobId: string,
  dataKey: Buffer,
): Promise<TemporaryKeyHandle> {
  safeId(jobId);
  if (dataKey.length !== 32) throw invalidBackup();
  await secureDir(handleDir());
  const handle = randomBytes(32).toString("base64url");
  const path = join(
    handleDir(),
    createHash("sha256").update(handle).digest("hex"),
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), nonce);
  cipher.setAAD(Buffer.from(handle, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const expiresAt = new Date(Date.now() + HANDLE_TTL_MS);
  const record = JSON.stringify({
    ownerId: jobId,
    expiresAt: expiresAt.toISOString(),
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
  await writeFile(path, record, { mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
  return { handle, path, expiresAt };
}

export async function consumeTemporaryKeyHandle(
  handle: string,
): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) throw invalidBackup();
  const path = join(
    handleDir(),
    createHash("sha256").update(handle).digest("hex"),
  );
  const claimPath = path + ".consume-" + randomBytes(8).toString("hex");
  try {
    await rename(path, claimPath);
    const record = JSON.parse(await readFile(claimPath, "utf8")) as {
      expiresAt: string;
      nonce: string;
      tag: string;
      ciphertext: string;
    };
    if (Date.parse(record.expiresAt) <= Date.now()) throw invalidBackup();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      masterKey(),
      Buffer.from(record.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(handle, "utf8"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    const dataKey = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64url")),
      decipher.final(),
    ]);
    if (dataKey.length !== 32) {
      dataKey.fill(0);
      throw invalidBackup();
    }
    return dataKey;
  } catch {
    throw invalidBackup();
  } finally {
    await rm(claimPath, { force: true });
  }
}

export async function discardTemporaryKeyHandle(handle: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) return;
  const prefix = createHash("sha256").update(handle).digest("hex");
  const directory = handleDir();
  const names = await readDirectoryIfExists(directory);
  await Promise.all(
    names
      .filter(
        (name) => name === prefix || name.startsWith(prefix + ".consume-"),
      )
      .map((name) => rm(join(directory, name), { force: true })),
  );
}

async function readDirectoryIfExists(directory: string): Promise<string[]> {
  return readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

export async function discardTemporaryKeyHandlesForOwner(
  ownerId: string,
): Promise<void> {
  const directory = handleDir();
  const names = await readDirectoryIfExists(directory);
  for (const name of names) {
    const path = join(directory, name);
    const record = await readFile(path, "utf8")
      .then((value) => JSON.parse(value) as { ownerId?: unknown })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error instanceof SyntaxError)
          return null;
        throw error;
      });
    if (record?.ownerId === ownerId) await rm(path, { force: true });
  }
}

export async function cleanupInterruptedBackupArtifacts(
  backupId: string,
  handles: string[] = [],
): Promise<void> {
  safeId(backupId);
  await rm(backupPath(backupId), { force: true });
  const directory = backupDir();
  const names = await readDirectoryIfExists(directory);
  await Promise.all(
    names
      .filter((name) => name.startsWith(`stage-${backupId}-`))
      .map((name) =>
        rm(join(directory, name), { recursive: true, force: true }),
      ),
  );
  await Promise.all(handles.map((handle) => discardTemporaryKeyHandle(handle)));
  await discardTemporaryKeyHandlesForOwner(backupId);
}

export async function pruneSystemTransferFiles(
  now = Date.now(),
): Promise<number> {
  const { tryWithSystemRestoreLock } = await import("./restore-lock.ts");
  const result = await tryWithSystemRestoreLock(() =>
    pruneUnlockedSystemTransferFiles(now),
  );
  return result.acquired ? result.value : 0;
}

async function pruneUnlockedSystemTransferFiles(now: number): Promise<number> {
  let removed = 0;
  await Promise.all(
    [handleDir(), backupDir(), uploadDir()].map((path) => secureDir(path)),
  );
  const { db } = await import("../../../db/index.ts");
  const restores = await db
    .select()
    .from(systemRestore)
    .where(inArray(systemRestore.status, ["PREFLIGHTING", "RESTORING"]));
  const activeRestores = new Set(restores.map((record) => record.id));
  const activeUploads = new Set(
    restores.map((record) => resolve(record.uploadPath)),
  );
  const activeJobs = await db
    .select({ payload: job.payload, kind: job.kind })
    .from(job)
    .where(
      and(
        inArray(job.kind, ["backup.system", "restore.system"]),
        inArray(job.status, ["PENDING", "RUNNING"]),
      ),
    );
  const activeHandles = new Set(
    activeJobs
      .filter(
        (row) =>
          row.kind === "backup.system" ||
          activeRestores.has(
            String((row.payload as { restoreId?: unknown }).restoreId),
          ),
      )
      .map((row) => (row.payload as { dataKeyHandle?: unknown }).dataKeyHandle)
      .filter((handle): handle is string => typeof handle === "string"),
  );
  const activeHandleFiles = new Set(
    [...activeHandles].map((handle) =>
      createHash("sha256").update(handle).digest("hex"),
    ),
  );
  const backups = await db.select().from(systemBackup);
  const backupsById = new Map(backups.map((backup) => [backup.id, backup]));
  for (const directory of [handleDir(), backupDir(), uploadDir()]) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      if (activeTransferFiles.has(path)) continue;
      if (
        directory === uploadDir() &&
        (activeUploads.has(resolve(path)) ||
          isActiveRestoreArchiveDirectory(path) ||
          (name.startsWith("preflight-") && restores.length > 0))
      )
        continue;
      if (
        directory === handleDir() &&
        activeHandleFiles.has(name.split(".consume-")[0]!)
      )
        continue;
      if (directory === backupDir() && name.endsWith(".fnbak")) {
        const backupId = name.slice(0, -".fnbak".length);
        const record = backupsById.get(backupId);
        if (record?.status === "PENDING" || record?.status === "RUNNING")
          continue;
        if (record?.status === "SUCCEEDED" && record.expiresAt.getTime() > now)
          continue;
      }
      if (directory === backupDir() && name.startsWith("stage-")) {
        const backupId = name.slice("stage-".length, "stage-".length + 36);
        const record = backupsById.get(backupId);
        if (record?.status === "PENDING" || record?.status === "RUNNING")
          continue;
        if (record?.status === "FAILED") {
          const info = await stat(path).catch(() => null);
          if (info?.isDirectory()) {
            await rm(path, { recursive: true, force: true });
            removed++;
          }
          continue;
        }
      }
      const ageLimit =
        directory === handleDir()
          ? HANDLE_TTL_MS
          : directory === backupDir()
            ? 7 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
      const info = await stat(path).catch(() => null);
      const expiresAt = backupsById.get(name.slice(0, -".fnbak".length))?.expiresAt.getTime();
      const expiredBackup =
        directory === backupDir() &&
        name.endsWith(".fnbak") &&
        expiresAt !== undefined && expiresAt <= now;
      if (info && (expiredBackup || now - info.mtimeMs > ageLimit)) {
        await rm(path, { recursive: info.isDirectory(), force: true });
        removed++;
      }
    }
  }
  return removed;
}
