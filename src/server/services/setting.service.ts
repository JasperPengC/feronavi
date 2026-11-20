/**
 * 设置读写（第七期 C，REST 10 节 `GET/PUT /api/v1/settings`）
 *
 * 纪律：
 *   1 敏感键写入走**信封加密**（crypto.service），读取解密供内部使用
 *   2 对外序列化**一律不回显**敏感值 —— 只给 `isSecret: true` 与掩码
 *   3 键名白名单：不允许任意键写入（防把设置表当 KV 垃圾桶用）
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db, inTransaction } from "../../db/index.ts";
import { setting } from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from "./crypto.service.ts";

/** 允许通过端点读写的键（其余键属安装向导/内部，不对外开放） */
export const WRITABLE_KEYS = new Set([
  "org.defaultLocale", "org.defaultTimezone",
  "smtp.host", "smtp.port", "smtp.user", "smtp.from", "smtp.password", "mail.transport", "mail.httpProvider", "mail.httpEndpoint", "mail.httpDomain",
  "storage.kind",
  "mcp.publicUrl",
  "storage.s3.endpoint", "storage.s3.region", "storage.s3.bucket", "storage.s3.accessKey",
  "storage.s3.secretKey", "storage.s3.forcePathStyle", "storage.s3.prefix",
  // BYOK：AI 供应商配置（第十三期）。ai.apiKey 属敏感键，写入即加密、读取不回显。
  "ai.enabled", "ai.baseUrl", "ai.model", "ai.apiKey", "ai.dimensions",
  "ai.chatBaseUrl", "ai.chatModel", "ai.chatApiKey",
  // 用量上限与告警（规范：上限载体在 setting，计数载体在 ai_usage_counter）
  "ai.limitTokensPerMonth", "ai.alertThresholdPercent", "ai.chatModel",
  // 日志留存期（规范 8.4：可配置；0 = 关闭清理，最大 3650 天）
  "audit.retentionDays", "activity.retentionDays",
  // 导出包保留期（Round 47）：0–8760 小时；0 = 关闭清理
  "export.retentionHours",
  // ⚠️ smtp.password 是敏感键：写入自动加密、读取永不回显
]);
const SECRET_KEYS = new Set(["smtp.password", "ai.apiKey", "ai.chatApiKey", "storage.s3.accessKey", "storage.s3.secretKey"]);

export interface SettingView {
  key: string;
  value: unknown;
  isSecret: boolean;
}

/** 对外视图：敏感键值替换为掩码（**绝不出明文**） */
export async function listSettings(): Promise<SettingView[]> {
  const rows = await db.select().from(setting).orderBy(asc(setting.key));
  return rows
    .filter((r) => WRITABLE_KEYS.has(r.key))
    .map((r) => ({
      key: r.key,
      // 就算 is_secret 标记丢了，只要是密码类键名也一律掩码（双保险）
      value: r.isSecret || SECRET_KEYS.has(r.key) ? maskSecret() : r.value,
      isSecret: r.isSecret || SECRET_KEYS.has(r.key),
    }));
}

/** 内部读取（解密后）——邮件服务用 */
export async function getSettingRaw(key: string): Promise<unknown | null> {
  const rows = await db.select().from(setting).where(eq(setting.key, key)).limit(1);
  const r = rows[0];
  if (!r) return null;
  if (typeof r.value === "string" && (r.isSecret || SECRET_KEYS.has(r.key))) {
    return decryptSecret(r.value);
  }
  return r.value;
}

export async function putSettings(patch: Record<string, unknown>): Promise<SettingView[]> {
  const bad = Object.keys(patch).filter((k) => !WRITABLE_KEYS.has(k));
  if (bad.length) {
    throw new DomainError("VALIDATION", `不允许写这些设置键：${bad.join(", ")}`, { keys: bad });
  }
  // 留存期是"会触发数据删除"的配置：只接受 0–3650 的整数（0 = 关闭清理）
  for (const k of ["audit.retentionDays", "activity.retentionDays"]) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 3650) {
      throw new DomainError("VALIDATION", `${k} 必须是 0–3650 的整数（0 = 关闭清理）`, { key: k });
    }
  }
  if ("export.retentionHours" in patch) {
    const v = patch["export.retentionHours"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 8760) {
      throw new DomainError("VALIDATION", "export.retentionHours 必须是 0–8760 的整数（0 = 关闭清理）", { key: "export.retentionHours" });
    }
  }
  return inTransaction(async () => {
    for (const [k, v] of Object.entries(patch)) {
      const secret = SECRET_KEYS.has(k);
      // 掩码值与 null 视为"不改动"：界面回显掩码后原样提交不应把密码清空
      if (secret && (v === null || v === maskSecret() || v === "")) continue;
      // 可选非敏感字段null表示清除；setting.value为NOT NULL，不能把SQL NULL写入。
      if (!secret && v === null) {
        await db.delete(setting).where(eq(setting.key, k));
        continue;
      }
      const value = secret && typeof v === "string" ? encryptSecret(v) : v;
      await db.insert(setting)
        .values({ key: k, value: value as object, isSecret: secret, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: setting.key,
          set: { value: value as object, isSecret: secret, updatedAt: new Date() },
        });
    }
    return listSettings();
  });
}

/** 删除指定设置（用于清除供应商切换后的旧配置；null 不能写入 setting.value） */
export async function deleteSettings(keys: string[]): Promise<void> {
  const bad = keys.filter((key) => !WRITABLE_KEYS.has(key));
  if (bad.length) throw new DomainError("VALIDATION", `不允许删除这些设置键：${bad.join(", ")}`, { keys: bad });
  if (keys.length) await db.delete(setting).where(inArray(setting.key, keys));
}

/** 自检用：报告敏感键是否**真的**是密文（供 e2e/运维核查） */
export async function secretKeysEncrypted(): Promise<{ key: string; encrypted: boolean }[]> {
  const keys = [...SECRET_KEYS];
  const rows = await db.select().from(setting).where(inArray(setting.key, keys));
  return rows.map((r) => ({
    key: r.key,
    encrypted: typeof r.value === "string" && isEncrypted(r.value),
  }));
}
