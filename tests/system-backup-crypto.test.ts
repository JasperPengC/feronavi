// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough, Writable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { resetKeyCache } from "../src/server/services/crypto.service.ts";
import {
  createEncryptionEnvelope,
  decryptPayload,
  encryptPayload,
  unwrapDataKey,
} from "../src/server/services/system-backup/crypto.ts";
import {
  consumeTemporaryKeyHandle,
  writeTemporaryKeyHandle,
} from "../src/server/services/system-backup/storage.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  resetKeyCache();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "system-backup-crypto-"));
  roots.push(root);
  vi.stubEnv("DATA_DIR", root);
  resetKeyCache();
  return root;
}

it("正确密码可解封，错误密码与篡改统一失败", async () => {
  const { dataKey, keyEnvelope } = await createEncryptionEnvelope(
    "migration-password-123",
  );
  const restored = await unwrapDataKey("migration-password-123", keyEnvelope);
  expect(restored.equals(dataKey)).toBe(true);
  await expect(
    unwrapDataKey("wrong-password-123", keyEnvelope),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
  const changed = {
    ...keyEnvelope,
    wrappedKey: keyEnvelope.wrappedKey.slice(0, -2) + "aa",
  };
  await expect(
    unwrapDataKey("migration-password-123", changed),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
  dataKey.fill(0);
  restored.fill(0);
});

it("payload 以流方式加密并可解密回原文", async () => {
  const plain = Buffer.from("migration payload\\n".repeat(2048));
  const key = Buffer.alloc(32, 7);
  const encrypted = new PassThrough();
  const chunks: Buffer[] = [];
  encrypted.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const metadata = await encryptPayload(
    Readable.from([plain.subarray(0, 117), plain.subarray(117)]),
    encrypted,
    key,
  );
  const decrypted = new PassThrough();
  const out: Buffer[] = [];
  decrypted.on("data", (chunk) => out.push(Buffer.from(chunk)));
  await decryptPayload(Readable.from(chunks), decrypted, key, metadata);
  expect(Buffer.concat(out).equals(plain)).toBe(true);
  const corrupted = Buffer.concat(chunks);
  corrupted[0] ^= 1;
  await expect(
    decryptPayload(
      Readable.from([corrupted]),
      new PassThrough(),
      key,
      metadata,
    ),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
  key.fill(0);
});

it("等待慢速目标流finish后才返回加解密结果，并传播末尾写入错误", async () => {
  class SlowWritable extends Writable {
    chunks: Buffer[] = [];
    failWrite = false;
    failFinal = false;
    _write(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: (error?: Error) => void,
    ) {
      setTimeout(() => {
        if (this.failWrite) callback(new Error("EIO"));
        else {
          this.chunks.push(Buffer.from(chunk));
          callback();
        }
      }, 15);
    }
    _final(callback: (error?: Error) => void) {
      setTimeout(
        () => callback(this.failFinal ? new Error("ENOSPC") : undefined),
        15,
      );
    }
  }
  const plain = Buffer.from("slow payload");
  const key = Buffer.alloc(32, 11);
  const encrypted = new SlowWritable();
  const metadata = await encryptPayload(Readable.from([plain]), encrypted, key);
  expect(encrypted.writableFinished).toBe(true);
  const decrypted = new SlowWritable();
  await decryptPayload(
    Readable.from(encrypted.chunks),
    decrypted,
    key,
    metadata,
  );
  expect(decrypted.writableFinished).toBe(true);
  const broken = new SlowWritable();
  broken.failFinal = true;
  await expect(
    encryptPayload(Readable.from([plain]), broken, key),
  ).rejects.toThrow("ENOSPC");
  key.fill(0);
});

it("临时密钥句柄仅可消费一次，句柄不暴露路径", async () => {
  const root = await tempRoot();
  const key = Buffer.alloc(32, 9);
  const temp = await writeTemporaryKeyHandle("job-1", key);
  expect(temp.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(temp.handle).not.toContain(temp.path);
  expect(temp.path.startsWith(root)).toBe(true);
  expect((await stat(temp.path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(root, "system-transfer", "keys"))).mode & 0o777).toBe(
    0o700,
  );
  const recovered = await consumeTemporaryKeyHandle(temp.handle);
  expect(recovered.equals(key)).toBe(true);
  await expect(consumeTemporaryKeyHandle(temp.handle)).rejects.toBeDefined();
  await expect(readFile(temp.path)).rejects.toBeDefined();
  key.fill(0);
  recovered.fill(0);
});
