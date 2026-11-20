/**
 * 信封加密（第七期 B，规范 1031 / 1608）
 *
 * 规范原文：敏感键（数据库密码、SMTP 密码、AI key、S3 密钥）**必须以应用级加密后的密文存储**，
 * 采用信封加密（数据卷内的主密钥 + 每键独立）。
 *
 * 实测背景：`setting.is_secret` 列早已存在且已被 smtp.password 置 true，
 * 但**值是明文**（全仓无任何加密实现）—— 本期补上。
 *
 * 形态：AES-256-GCM，主密钥 32 字节随机存 `DATA_DIR/master.key`（0600）。
 * 密文格式 `enc:v1:<iv>:<tag>:<ciphertext>`（base64url），便于识别与未来轮换。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

function dataDir(): string {
  return process.env.DATA_DIR ?? "/tmp/feronavi-data";
}

function keyPath(): string {
  return join(dataDir(), "master.key");
}

let cachedKey: Buffer | null = null;

/**
 * 读取主密钥；不存在则生成（首次使用）。
 * ⚠️ 密钥在**数据卷内** —— 备份必须同时包含它，否则密文不可解（备份规范已要求"数据库 + 附件 + 密钥"三者齐全）。
 */
export function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const p = keyPath();
  if (existsSync(p)) {
    const raw = readFileSync(p);
    if (raw.length !== KEY_BYTES) {
      throw new Error(`master.key 长度异常（${raw.length} 字节，应为 ${KEY_BYTES}）—— 拒绝以损坏的密钥继续`);
    }
    cachedKey = raw;
    return raw;
  }
  mkdirSync(dataDir(), { recursive: true });
  const k = randomBytes(KEY_BYTES);
  writeFileSync(p, k, { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* 某些文件系统不支持，忽略 */ }
  cachedKey = k;
  return k;
}

/** 测试用：清掉进程内缓存（换了 DATA_DIR 时必须调） */
export function resetKeyCache(): void {
  cachedKey = null;
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** 加密（幂等：已加密的返回原值，避免二次加密） */
export function encryptSecret(plain: string): string {
  if (isEncrypted(plain)) return plain;
  return encryptSecretWithKey(plain, masterKey());
}

export function encryptSecretWithKey(plain: string, key: Buffer): string {
  if (isEncrypted(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/**
 * 解密。非密文原样返回（兼容迁移期已存在的明文值），但**调用方可据 isEncrypted 判断**，
 * 便于在日志/自检里提示"该敏感键尚未加密"。
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  return decryptSecretWithKey(stored, masterKey());
}

export function decryptSecretWithKey(stored: string, key: Buffer): string {
  if (!isEncrypted(stored)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("密文格式非法（应为 enc:v1:iv:tag:ct）");
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

/** 对外序列化：敏感值一律掩码（规范：界面不可回显） */
export function maskSecret(): string {
  return "********";
}

export { PREFIX as ENC_PREFIX };
