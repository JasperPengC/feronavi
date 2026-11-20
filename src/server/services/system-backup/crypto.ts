import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable, Writable } from "node:stream";
import { DomainError } from "../../../shared/errors.ts";
import {
  keyEnvelopeSchema,
  systemBackupHeaderSchema,
  type KeyEnvelope,
  type PayloadEncryption,
  type SystemBackupHeader,
} from "../../../shared/schemas/system-backup.ts";

export const KDF = {
  name: "scrypt",
  N: 65_536,
  r: 8,
  p: 1,
  keyBytes: 32,
  saltBytes: 16,
  maxmem: 134_217_728,
} as const;
export const GCM = {
  name: "aes-256-gcm",
  nonceBytes: 12,
  tagBytes: 16,
} as const;

const invalidBackup = () =>
  new DomainError("INVALID_BACKUP", "迁移包密码错误或文件已损坏", null);

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KDF.keyBytes,
      { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}

function decode(value: string, bytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidBackup();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value)
    throw invalidBackup();
  return decoded;
}

export async function createEncryptionEnvelope(
  password: string,
): Promise<{ dataKey: Buffer; keyEnvelope: KeyEnvelope }> {
  const dataKey = randomBytes(32);
  const salt = randomBytes(KDF.saltBytes);
  const wrapNonce = randomBytes(GCM.nonceBytes);
  let wrappingKey: Buffer | undefined;
  try {
    wrappingKey = await deriveKey(password, salt);
    const cipher = createCipheriv(GCM.name, wrappingKey, wrapNonce);
    const wrappedKey = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return {
      dataKey,
      keyEnvelope: {
        kdf: KDF,
        salt: salt.toString("base64url"),
        wrapNonce: wrapNonce.toString("base64url"),
        wrappedKey: wrappedKey.toString("base64url"),
        wrapTag: cipher.getAuthTag().toString("base64url"),
      },
    };
  } catch (error) {
    dataKey.fill(0);
    throw error;
  } finally {
    wrappingKey?.fill(0);
  }
}

export async function unwrapDataKey(
  password: string,
  source: KeyEnvelope | SystemBackupHeader,
): Promise<Buffer> {
  let wrappingKey: Buffer | undefined;
  try {
    let envelope: unknown = source;
    if (source && typeof source === "object" && "encryption" in source) {
      envelope = systemBackupHeaderSchema.parse(source).encryption;
    }
    const parsed = keyEnvelopeSchema.parse(envelope);
    const salt = decode(parsed.salt, KDF.saltBytes);
    const nonce = decode(parsed.wrapNonce, GCM.nonceBytes);
    const wrappedKey = decode(parsed.wrappedKey, 32);
    const tag = decode(parsed.wrapTag, GCM.tagBytes);
    wrappingKey = await deriveKey(password, salt);
    const decipher = createDecipheriv(GCM.name, wrappingKey, nonce);
    decipher.setAuthTag(tag);
    const dataKey = Buffer.concat([
      decipher.update(wrappedKey),
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
    wrappingKey?.fill(0);
  }
}

export async function encryptPayload(
  input: Readable,
  output: Writable,
  dataKey: Buffer,
): Promise<PayloadEncryption> {
  if (dataKey.length !== 32) throw invalidBackup();
  const nonce = randomBytes(GCM.nonceBytes);
  const cipher = createCipheriv(GCM.name, dataKey, nonce);
  // pipeline 默认负责结束目标流并等待 finish/error；调用方拿到 tag 时文件已完整落盘。
  await pipeline(input, cipher, output);
  return {
    payloadNonce: nonce.toString("base64url"),
    payloadTag: cipher.getAuthTag().toString("base64url"),
  };
}

export async function decryptPayload(
  input: Readable,
  output: Writable,
  dataKey: Buffer,
  encryption: Pick<PayloadEncryption, "payloadNonce" | "payloadTag">,
): Promise<void> {
  try {
    if (dataKey.length !== 32) throw invalidBackup();
    const nonce = decode(encryption.payloadNonce, GCM.nonceBytes);
    const tag = decode(encryption.payloadTag, GCM.tagBytes);
    const decipher = createDecipheriv(GCM.name, dataKey, nonce);
    decipher.setAuthTag(tag);
    await pipeline(input, decipher, output);
  } catch {
    output.destroy();
    throw invalidBackup();
  }
}
