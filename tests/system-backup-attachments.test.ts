// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeInnerArchive } from "../src/server/services/system-backup/archive.ts";
import * as archiveTools from "../src/server/services/system-backup/archive.ts";
import * as blobs from "../src/server/services/system-backup/attachment-blobs.ts";

let root: string;
const bytes = Buffer.from("附件流式恢复内容");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = {
  count: 1,
  bytes: bytes.length,
  entries: [{ sha256, bytes: bytes.length, path: `blobs/${sha256}` }],
};
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "restore-blobs-test-"));
  vi.stubEnv("DATA_DIR", root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function stage(data = bytes, entries = metadata) {
  const path = join(root, `${randomUUID()}.zip`);
  await writeInnerArchive(path, [{ path: `blobs/${sha256}`, source: data }]);
  return blobs.stageRestoreBlobs(randomUUID(), path, entries);
}

it("同一blob只落盘一次，私有权限和固定路径保留原始内容", async () => {
  const staged = await stage();
  expect((await fs.stat(staged.blobsPath)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(join(staged.blobsPath, sha256))).mode & 0o777).toBe(
    0o600,
  );
  const packageId = randomUUID();
  const promoted = await blobs.promoteRestoreBlobs(staged, packageId);
  expect(
    await fs.readFile(join(root, "attachments", "restored", packageId, sha256)),
  ).toEqual(bytes);
  expect(blobs.restoredBlobPath(packageId, sha256)).toBe(
    `restored/${packageId}/${sha256}`,
  );
  await blobs.rollbackPromotedBlobs(promoted);
  await expect(
    fs.stat(join(root, "attachments", "restored", packageId)),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["missing", "hash", "size"])(
  "%s blob失败不留下可提升附件",
  async (failure) => {
    const path = join(root, "invalid.zip");
    await writeInnerArchive(
      path,
      failure === "missing"
        ? []
        : [
            {
              path: `blobs/${sha256}`,
              source: failure === "hash" ? Buffer.from("bad") : bytes,
            },
          ],
    );
    const restoreId = randomUUID();
    const expected =
      failure === "size"
        ? { ...metadata, entries: [{ ...metadata.entries[0]!, bytes: 999 }] }
        : metadata;
    await expect(
      blobs.stageRestoreBlobs(restoreId, path, expected),
    ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
    await expect(
      fs.stat(join(root, "system-restores", restoreId)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([false, true])(
  "目标目录已经存在时保持原内容，含空目录（有文件=%s）",
  async (withFile) => {
    const staged = await stage();
    const packageId = randomUUID();
    const target = join(root, "attachments", "restored", packageId);
    await fs.mkdir(target, { recursive: true });
    if (withFile) await fs.writeFile(join(target, "other"), "别人的目录");
    await expect(
      blobs.promoteRestoreBlobs(staged, packageId),
    ).rejects.toThrow();
    await blobs.rollbackPromotedBlobs(staged);
    expect(await fs.readdir(target)).toEqual(withFile ? ["other"] : []);
  },
);

it("rename失败只补偿本次预留，不删除其他目录", async () => {
  const staged = await stage();
  const packageId = randomUUID();
  const rename = fs.rename;
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (from === staged.blobsPath)
      throw Object.assign(new Error("disk"), { code: "EIO" });
    return rename(from, to);
  });
  await expect(blobs.promoteRestoreBlobs(staged, packageId)).rejects.toThrow();
  await blobs.rollbackPromotedBlobs(staged);
  await expect(
    fs.stat(join(root, "attachments", "restored", packageId)),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("替换目录或伪造owner不能获得清理权", async () => {
  const staged = await stage();
  const packageId = randomUUID();
  await blobs.promoteRestoreBlobs(staged, packageId);
  const target = join(root, "attachments", "restored", packageId);
  await fs.rename(target, target + "-saved");
  await fs.mkdir(target);
  await fs.copyFile(
    join(target + "-saved", ".restore-owner.json"),
    join(target, ".restore-owner.json"),
  );
  await expect(blobs.rollbackPromotedBlobs(staged)).rejects.toThrow();
  expect(await fs.readdir(target)).toEqual([".restore-owner.json"]);
  await fs.rm(target, { recursive: true });
  await fs.rename(target + "-saved", target);
  await fs.writeFile(
    join(target, ".restore-owner.json"),
    JSON.stringify({ restoreId: staged.restoreId, packageId, token: "forged" }),
  );
  await expect(blobs.rollbackPromotedBlobs(staged)).rejects.toThrow();
  expect(await fs.readFile(join(target, sha256))).toEqual(bytes);
});

it("暂存目录已存在时不会接管或清理", async () => {
  const restoreId = randomUUID();
  const existing = join(root, "system-restores", restoreId);
  await fs.mkdir(existing, { recursive: true });
  await fs.writeFile(join(existing, "other"), "keep");
  await expect(
    blobs.stageRestoreBlobs(restoreId, "unused", metadata),
  ).rejects.toThrow();
  expect(await fs.readFile(join(existing, "other"), "utf8")).toBe("keep");
});

it("输入流创建失败仍关闭已打开的blob输出文件", async () => {
  const open = fs.open;
  const closed = vi.fn();
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const file = await open(...args);
    if (String(args[0]).endsWith(`/${sha256}`)) {
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => {
        closed();
        await close();
      });
    }
    return file;
  });
  vi.spyOn(archiveTools, "entryStream").mockRejectedValue(
    new Error("stream open failed"),
  );
  await expect(stage()).rejects.toThrow("stream open failed");
  expect(closed).toHaveBeenCalledOnce();
});

it("崩溃未落盘reservation归属时保留未知空目录和journal供人工核对", async () => {
  const staged = await stage();
  const packageId = randomUUID();
  const journal = join(
    root,
    "system-restores",
    staged.restoreId,
    ".restore-owner.json",
  );
  const owner = JSON.parse(await fs.readFile(journal, "utf8"));
  await fs.writeFile(journal, JSON.stringify({ ...owner, packageId }));
  const target = join(root, "attachments", "restored", packageId);
  await fs.mkdir(target, { recursive: true });
  await expect(blobs.rollbackPromotedBlobs(staged)).rejects.toThrow();
  expect(await fs.readdir(target)).toEqual([]);
  await fs.stat(journal);
});
