/**
 * 附件存储配置（本地 / S3 兼容）。
 *
 * 初始化向导可以选 S3，但旧实现只存了一个 kind，附件服务只读环境变量并直接抛
 * “S3 存储尚未接入”。这里把配置落到 setting：
 *   storage.kind
 *   storage.s3.endpoint / region / bucket / accessKey / secretKey / forcePathStyle / prefix
 * 附件服务每次按当前配置取客户端；管理端可在系统内切换并测试。
 */
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { getSettingRaw } from "./setting.service.ts";
import { DomainError } from "../../shared/errors.ts";

export interface StorageConfig {
  kind: "local" | "s3";
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  prefix: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true || v === "true";

export async function loadStorageConfig(): Promise<StorageConfig> {
  const kind = (await getSettingRaw("storage.kind")) === "s3" ? "s3" : "local";
  const endpoint = str(await getSettingRaw("storage.s3.endpoint")) || process.env.S3_ENDPOINT || "";
  const region = str(await getSettingRaw("storage.s3.region")) || process.env.S3_REGION || "us-east-1";
  const bucket = str(await getSettingRaw("storage.s3.bucket")) || process.env.S3_BUCKET || "";
  const accessKey = str(await getSettingRaw("storage.s3.accessKey")) || process.env.S3_ACCESS_KEY || "";
  const secretKey = str(await getSettingRaw("storage.s3.secretKey")) || process.env.S3_SECRET_KEY || "";
  const forcePathStyle = bool(await getSettingRaw("storage.s3.forcePathStyle")) || process.env.S3_FORCE_PATH_STYLE === "true";
  const prefix = str(await getSettingRaw("storage.s3.prefix")).replace(/^\/+|\/+$/g, "");
  return { kind, endpoint, region, bucket, accessKey, secretKey, forcePathStyle, prefix };
}

export function isS3Configured(cfg: StorageConfig): boolean {
  return cfg.kind === "s3" && Boolean(cfg.bucket && cfg.accessKey && cfg.secretKey && cfg.endpoint);
}

export function s3Client(cfg: StorageConfig): S3Client {
  if (!isS3Configured(cfg)) {
    throw new DomainError("VALIDATION", "S3 配置不完整：需要 endpoint、bucket、accessKey、secretKey", null);
  }
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

export function storageKey(cfg: StorageConfig, path: string): string {
  return cfg.prefix ? `${cfg.prefix}/${path}` : path;
}

/** 管理端“测试连接”：本地写一个临时文件；S3 做 HeadBucket。 */
export async function testStorage(): Promise<{ ok: boolean; reason: string | null }> {
  const cfg = await loadStorageConfig();
  if (cfg.kind === "local") return { ok: true, reason: null };
  try {
    const client = s3Client(cfg);
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "S3 连接失败" };
  }
}
