// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, expect, it, vi } from "vitest";
import { resetKeyCache } from "../src/server/services/crypto.service.ts";
import {
  backupPath,
  createBackupFile,
  createRestoreUploadFile,
} from "../src/server/services/system-backup/storage.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  resetKeyCache();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function useTempDataDir() {
  const root = await mkdtemp(join(tmpdir(), "system-backup-storage-"));
  roots.push(root);
  vi.stubEnv("DATA_DIR", root);
  resetKeyCache();
  return root;
}

it("backupPath 使用 .fnbak 扩展名", () => {
  expect(basename(backupPath("job-1"))).toBe("job-1.fnbak");
});

it("备份文件入口确保父目录 0700、文件 0600", async () => {
  const root = await useTempDataDir();
  const path = backupPath("job-1");
  await mkdir(dirname(path), { recursive: true, mode: 0o777 });
  await chmod(dirname(path), 0o777);
  const file = await createBackupFile("job-1");
  await pipeline(Readable.from([Buffer.from("archive")]), file.stream);
  const directory = await stat(join(root, "system-transfer", "backups"));
  const stored = await stat(file.path);
  expect(directory.mode & 0o777).toBe(0o700);
  expect(stored.mode & 0o777).toBe(0o600);
  expect(await readFile(file.path, "utf8")).toBe("archive");
});

it("上传文件入口确保父目录 0700、文件 0600", async () => {
  const root = await useTempDataDir();
  const uploadPath = join(root, "system-transfer", "uploads");
  await mkdir(uploadPath, { recursive: true, mode: 0o777 });
  await chmod(uploadPath, 0o777);
  const file = await createRestoreUploadFile("restore-1");
  await pipeline(Readable.from([Buffer.from("upload")]), file.stream);
  const directory = await stat(join(root, "system-transfer", "uploads"));
  const stored = await stat(file.path);
  expect(directory.mode & 0o777).toBe(0o700);
  expect(stored.mode & 0o777).toBe(0o600);
  expect(await readFile(file.path, "utf8")).toBe("upload");
});
