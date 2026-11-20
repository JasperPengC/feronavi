// @vitest-environment node
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("../src/server/services/system-backup/storage.ts");
  vi.resetModules();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("创建备份 staging 目录失败时已消费并清零密钥句柄，且不留下备份文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "system-backup-startup-"));
  roots.push(root);
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://feronavi_test:unused@127.0.0.1:5432/unused",
  );

  const stagingFailure = Object.assign(new Error("fixture disk full"), {
    code: "ENOSPC",
  });

  let consumedKey: Buffer | undefined;
  vi.doMock("../src/server/services/system-backup/storage.ts", async () => {
    const actual = await vi.importActual<
      typeof import("../src/server/services/system-backup/storage.ts")
    >("../src/server/services/system-backup/storage.ts");
    return {
      ...actual,
      createBackupStageDirectory: async () => {
        throw stagingFailure;
      },
      consumeTemporaryKeyHandle: async (handle: string) => {
        consumedKey = await actual.consumeTemporaryKeyHandle(handle);
        return consumedKey;
      },
    };
  });

  const storage =
    await import("../src/server/services/system-backup/storage.ts");
  const { createEncryptionEnvelope } =
    await import("../src/server/services/system-backup/crypto.ts");
  const { dataKey, keyEnvelope } = await createEncryptionEnvelope(
    "startup-failure-password",
  );
  const handle = await storage.writeTemporaryKeyHandle(
    "startup-failure",
    dataKey,
  );
  dataKey.fill(0);

  const { exportSystemBackup } =
    await import("../src/server/services/system-backup/exporter.ts");
  await expect(
    exportSystemBackup({
      backupId: "f6c1c63a-09d7-4f8a-b488-c450c4c7688e",
      mode: "safe",
      requestedBy: "startup-failure-member",
      dataKeyHandle: handle.handle,
      keyEnvelope,
    }),
  ).rejects.toMatchObject({ code: "ENOSPC" });

  await expect(access(handle.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(consumedKey).toBeDefined();
  expect(consumedKey?.every((byte) => byte === 0)).toBe(true);
  await expect(
    access(storage.backupPath("f6c1c63a-09d7-4f8a-b488-c450c4c7688e")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
