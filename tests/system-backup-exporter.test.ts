// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const s3Fixture = vi.hoisted(() => ({ data: [] as number[] }));
vi.mock("../src/server/services/storage.service.ts", () => ({
  loadStorageConfig: async () => ({
    kind: "s3",
    endpoint: "http://s3.test",
    region: "us-east-1",
    bucket: "fixture",
    accessKey: "access",
    secretKey: "secret",
    forcePathStyle: true,
    prefix: "attachments",
  }),
  isS3Configured: () => true,
  storageKey: (_config: unknown, path: string) => `attachments/${path}`,
  s3Client: () => ({
    send: async () => ({
      Body: {
        transformToByteArray: async () => Uint8Array.from(s3Fixture.data),
      },
    }),
  }),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function attachmentFixture(data: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "system-backup-exporter-"));
  roots.push(root);
  vi.stubEnv("ATTACHMENT_DIR", root);
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://feronavi_test:unused@127.0.0.1:5432/unused",
  );
  const storagePath = "2026-11-14/fixture.bin";
  await mkdir(join(root, "2026-11-14"));
  await writeFile(join(root, storagePath), data);
  return {
    storagePath,
    storageBackend: "local" as const,
    sizeBytes: data.byteLength,
    contentHash: createHash("sha256").update(data).digest("hex"),
  };
}

it("读取附件快照时校验内容大小和 SHA-256", async () => {
  const data = Buffer.from("attachment snapshot");
  const row = await attachmentFixture(data);
  const { readAttachmentBlob } =
    await import("../src/server/services/system-backup/attachment-blobs.ts");
  await expect(readAttachmentBlob(row)).resolves.toEqual(data);
  await expect(
    readAttachmentBlob({ ...row, sizeBytes: 1 }),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
  await expect(
    readAttachmentBlob({ ...row, contentHash: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
  await expect(
    readAttachmentBlob({ ...row, storagePath: "../outside" }),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});

it("从 S3 读取附件快照并核验 SHA-256", async () => {
  const data = Buffer.from("s3 attachment snapshot");
  s3Fixture.data = [...data];
  const row = {
    storagePath: "2026-11-14/object-key",
    storageBackend: "s3" as const,
    sizeBytes: data.byteLength,
    contentHash: createHash("sha256").update(data).digest("hex"),
  };
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://feronavi_test:unused@127.0.0.1:5432/unused",
  );
  const { readAttachmentBlob } =
    await import("../src/server/services/system-backup/attachment-blobs.ts");
  await expect(readAttachmentBlob(row)).resolves.toEqual(data);
  s3Fixture.data = [...Buffer.from("altered")];
  await expect(readAttachmentBlob(row)).rejects.toMatchObject({
    code: "INVALID_BACKUP",
  });
});
