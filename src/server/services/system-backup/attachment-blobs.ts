import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SystemBackupManifest } from "../../../shared/schemas/system-backup.ts";
import { DomainError } from "../../../shared/errors.ts";
import { entryStream, nextEntry, openZip } from "./archive.ts";

const invalidBackup = () =>
  new DomainError("INVALID_BACKUP", "迁移包密码错误或文件已损坏", null);

export interface AttachmentBlobRow {
  storagePath: string;
  storageBackend: "local" | "s3";
  sizeBytes: number;
  contentHash: string;
}

export async function readAttachmentBlob(
  row: AttachmentBlobRow,
): Promise<Buffer> {
  try {
    if (
      !row ||
      typeof row.storagePath !== "string" ||
      !["local", "s3"].includes(row.storageBackend) ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes < 0 ||
      !/^[a-f0-9]{64}$/u.test(row.contentHash)
    )
      throw invalidBackup();
    const { readStoredAttachment } = await import("../attachment.service.ts");
    const data = await readStoredAttachment(
      row.storagePath,
      row.storageBackend,
    );
    const hash = createHash("sha256").update(data).digest("hex");
    if (data.byteLength !== row.sizeBytes || hash !== row.contentHash)
      throw invalidBackup();
    return data;
  } catch {
    throw invalidBackup();
  }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const dataRoot = () => resolve(process.env.DATA_DIR ?? "/tmp/feronavi-data");
const restoreRoot = (id: string) =>
  join(dataRoot(), "system-restores", checkedId(id));
const destination = (id: string) =>
  join(dataRoot(), "attachments", "restored", checkedId(id));
function checkedId(id: string): string {
  if (!UUID.test(id)) throw invalidBackup();
  return id;
}
export function restoredBlobPath(packageId: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw invalidBackup();
  return `restored/${checkedId(packageId)}/${sha256}`;
}

interface Identity {
  dev: number;
  ino: number;
}
interface Ownership {
  restoreId: string;
  token: string;
  root: Identity;
  blobs: Identity;
  packageId?: string;
  reservation?: Identity;
  targetWasPresent?: boolean;
}
export interface StagedRestoreBlobs {
  restoreId: string;
  blobsPath: string;
  token: string;
}
const ownerName = ".restore-owner.json";
const identity = (info: Identity): Identity => ({
  dev: info.dev,
  ino: info.ino,
});
async function info(path: string) {
  return fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
function matches(
  actual: Awaited<ReturnType<typeof info>>,
  expected?: Identity,
): boolean {
  return (
    !!actual?.isDirectory() &&
    !actual.isSymbolicLink() &&
    !!expected &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino
  );
}
async function syncDirectory(path: string) {
  const file = await fs.open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function privateDirectory(path: string) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const actual = await fs.lstat(path);
  if (!actual.isDirectory() || actual.isSymbolicLink()) throw invalidBackup();
  await fs.chmod(path, 0o700);
}
async function writePrivate(path: string, value: unknown, flag = "wx") {
  const file = await fs.open(path, flag, 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function saveOwner(root: string, owner: Ownership) {
  const temporary = join(root, `.owner-${randomUUID()}`);
  await writePrivate(temporary, owner);
  await fs.rename(temporary, join(root, ownerName));
  await syncDirectory(root);
}
async function readOwner(restoreId: string): Promise<Ownership | null> {
  const root = restoreRoot(restoreId);
  const actual = await info(root);
  if (!actual) return null;
  const owner = JSON.parse(
    await fs.readFile(join(root, ownerName), "utf8"),
  ) as Ownership;
  if (
    owner.restoreId !== restoreId ||
    !UUID.test(owner.token) ||
    !matches(actual, owner.root)
  )
    throw invalidBackup();
  if (owner.packageId) checkedId(owner.packageId);
  return owner;
}

/** 独占restoreId目录；只流式写manifest中的唯一blob，不接管任何既存目录。 */
export async function stageRestoreBlobs(
  restoreId: string,
  archive: string,
  blobs: SystemBackupManifest["blobs"],
): Promise<StagedRestoreBlobs> {
  const root = restoreRoot(restoreId);
  await privateDirectory(join(dataRoot(), "system-restores"));
  await fs.mkdir(root, { mode: 0o700 });
  const staged = {
    restoreId,
    token: randomUUID(),
    blobsPath: join(root, "stage", "blobs"),
  };
  try {
    await fs.mkdir(join(root, "stage"), { mode: 0o700 });
    await fs.mkdir(staged.blobsPath, { mode: 0o700 });
    await saveOwner(root, {
      restoreId,
      token: staged.token,
      root: identity(await fs.lstat(root)),
      blobs: identity(await fs.lstat(staged.blobsPath)),
    });
    await syncDirectory(join(dataRoot(), "system-restores"));
    const expected = new Map(blobs.entries.map((entry) => [entry.path, entry]));
    if (
      expected.size !== blobs.count ||
      blobs.entries.length !== blobs.count ||
      blobs.entries.reduce((sum, entry) => sum + entry.bytes, 0) !== blobs.bytes
    )
      throw invalidBackup();
    for (const entry of expected.values()) {
      restoredBlobPath(restoreId, entry.sha256);
      if (
        entry.path !== `blobs/${entry.sha256}` ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0
      )
        throw invalidBackup();
    }
    const zip = await openZip(archive);
    const seen = new Set<string>();
    try {
      for (
        let entry = await nextEntry(zip);
        entry;
        entry = await nextEntry(zip)
      ) {
        if (!entry.fileName.startsWith("blobs/")) continue;
        const metadata = expected.get(entry.fileName);
        if (!metadata || seen.has(entry.fileName)) throw invalidBackup();
        seen.add(entry.fileName);
        const file = await fs.open(
          join(staged.blobsPath, metadata.sha256),
          "wx",
          0o600,
        );
        let stream: Awaited<ReturnType<typeof entryStream>> | undefined;
        let size = 0;
        const hash = createHash("sha256");
        try {
          stream = await entryStream(zip, entry);
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > metadata.bytes) throw invalidBackup();
            hash.update(chunk);
            await file.writeFile(chunk);
          }
          if (size !== metadata.bytes || hash.digest("hex") !== metadata.sha256)
            throw invalidBackup();
          await file.sync();
        } finally {
          stream?.destroy();
          await file.close();
        }
      }
      if (seen.size !== expected.size) throw invalidBackup();
    } finally {
      zip.close();
    }
    await syncDirectory(staged.blobsPath);
    await syncDirectory(join(root, "stage"));
    return staged;
  } catch (error) {
    // root由本次独占mkdir创建，尚未交出所有权。
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** mkdir独占预留防止rename覆盖空目标；journal与inode给崩溃补偿提供归属证明。 */
export async function promoteRestoreBlobs(
  staged: StagedRestoreBlobs,
  packageId: string,
): Promise<StagedRestoreBlobs> {
  const root = restoreRoot(staged.restoreId);
  const owner = await readOwner(staged.restoreId);
  if (
    !owner ||
    owner.token !== staged.token ||
    !matches(await info(staged.blobsPath), owner.blobs)
  )
    throw invalidBackup();
  owner.packageId = checkedId(packageId);
  await writePrivate(join(staged.blobsPath, ownerName), {
    restoreId: owner.restoreId,
    packageId,
    token: owner.token,
  });
  await syncDirectory(staged.blobsPath);
  await saveOwner(root, owner);
  await privateDirectory(join(dataRoot(), "attachments"));
  await privateDirectory(join(dataRoot(), "attachments", "restored"));
  const target = destination(packageId);
  // 已存在目标（含空目录）一律失败；仅替换本次mkdir成功取得的空目录。
  try {
    await fs.mkdir(target, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      owner.targetWasPresent = true;
      await saveOwner(root, owner);
    }
    throw error;
  }
  owner.reservation = identity(await fs.lstat(target));
  try {
    await saveOwner(root, owner);
    if (!matches(await info(target), owner.reservation)) throw invalidBackup();
    await fs.rename(staged.blobsPath, target);
    await syncDirectory(join(dataRoot(), "attachments", "restored"));
    await syncDirectory(join(root, "stage"));
    return staged;
  } catch (error) {
    // 非空或被替换的预留保留；下一次启动会按journal再次尝试。
    if (matches(await info(target), owner.reservation)) await fs.rmdir(target);
    throw error;
  }
}

/** 只依据本次journal + 目录inode + 私有owner三项一致的证据删除提升目录。 */
export async function cleanupRestoreBlobs(
  restoreId: string,
  packageId: string | null,
  keepPromoted = false,
  token?: string,
): Promise<void> {
  const owner = await readOwner(restoreId);
  if (!owner) return;
  if (
    (token && owner.token !== token) ||
    (owner.packageId && owner.packageId !== packageId)
  )
    throw invalidBackup();
  if (owner.packageId && !keepPromoted) {
    const target = destination(owner.packageId);
    const actual = await info(target);
    if (actual && !owner.targetWasPresent) {
      if (matches(actual, owner.blobs)) {
        const marker = JSON.parse(
          await fs.readFile(join(target, ownerName), "utf8"),
        ) as Partial<Ownership>;
        if (
          marker.restoreId !== restoreId ||
          marker.packageId !== packageId ||
          marker.token !== owner.token
        )
          throw invalidBackup();
        await fs.rm(target, { recursive: true, force: true });
      } else if (matches(actual, owner.reservation)) await fs.rmdir(target);
      else throw invalidBackup();
      // reservation尚未落盘的崩溃窗口不猜测归属，保留journal与目标供核对。
    }
    await syncDirectory(join(dataRoot(), "attachments", "restored"));
  }
  await fs.rm(restoreRoot(restoreId), { recursive: true, force: true });
  await syncDirectory(join(dataRoot(), "system-restores"));
}

export async function rollbackPromotedBlobs(
  staged: StagedRestoreBlobs,
): Promise<void> {
  const owner = await readOwner(staged.restoreId);
  await cleanupRestoreBlobs(
    staged.restoreId,
    owner?.packageId ?? null,
    false,
    staged.token,
  );
}
