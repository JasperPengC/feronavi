import { DomainError } from "../../../shared/errors.ts";
import {
  decryptSecretWithKey,
  encryptSecretWithKey,
  isEncrypted,
} from "../crypto.service.ts";
import type { DatasetDefinition } from "./types.ts";
import { entryStream, nextEntry, openZip } from "./archive.ts";

const invalid = () =>
  new DomainError("INVALID_BACKUP", "迁移包数据不合法", null);

/** 只在已通过GCM认证和归档校验的私有ZIP内读取，绝不写目标master.key。 */
export async function readSourceMasterKey(path: string): Promise<Buffer> {
  const key = Buffer.alloc(32);
  const zip = await openZip(path);
  try {
    for (
      let entry = await nextEntry(zip);
      entry;
      entry = await nextEntry(zip)
    ) {
      if (entry.fileName !== "secrets/source-master-key.bin") continue;
      let offset = 0;
      for await (const chunk of await entryStream(zip, entry)) {
        try {
          if (offset + chunk.length > key.length) throw invalid();
          chunk.copy(key, offset);
          offset += chunk.length;
        } finally {
          chunk.fill(0);
        }
      }
      if (offset !== key.length) throw invalid();
      return key;
    }
    throw invalid();
  } catch (error) {
    key.fill(0);
    throw error;
  } finally {
    zip.close();
  }
}

function containsEncrypted(value: unknown): boolean {
  if (isEncrypted(value)) return true;
  if (Array.isArray(value)) return value.some(containsEncrypted);
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).some(containsEncrypted)
  );
}

function requiresEncryptedInspection(
  dataset: DatasetDefinition,
  column: string,
): boolean {
  return (
    !dataset.columns.includes(column) ||
    dataset.secretColumns.includes(column) ||
    dataset.rewrapColumns.includes(column) ||
    (dataset.tableName === "idp_config" && column === "config")
  );
}

/** 包含JSON内部的密文也必须有明确重封装策略；hash绝不能被当作可逆秘密。 */
export function assertNoUndeclaredEncryptedColumns(
  row: Record<string, unknown>,
  dataset: DatasetDefinition,
): void {
  for (const [column, value] of Object.entries(row)) {
    // 业务正文/标题等自由文本可以提及 enc:v1；只在登记为秘密的字段
    // 或明确承载配置/载荷的字段内执行“未知密文”拒绝。
    if (!requiresEncryptedInspection(dataset, column)) continue;
    const declared =
      dataset.rewrapColumns.includes(column) &&
      (dataset.tableName !== "setting" || row.is_secret === true);
    if (
      containsEncrypted(value) &&
      !(declared && typeof value === "string" && isEncrypted(value))
    )
      throw invalid();
  }
}

export async function rewrapMigratedSecrets(
  row: Record<string, unknown>,
  dataset: DatasetDefinition,
  sourceKey: Buffer,
  targetKey: Buffer,
): Promise<Record<string, unknown>> {
  assertNoUndeclaredEncryptedColumns(row, dataset);
  const result = { ...row };
  try {
    for (const column of dataset.rewrapColumns) {
      if (dataset.tableName === "setting" && row.is_secret !== true) continue;
      const stored = row[column];
      if (stored === null || stored === undefined) continue;
      if (typeof stored !== "string") throw invalid();
      const plain = decryptSecretWithKey(stored, sourceKey);
      // 保持原API的幂等语义，但不允许明文是另一层源密文而绕过换钥。
      if (isEncrypted(plain)) throw invalid();
      result[column] = encryptSecretWithKey(plain, targetKey);
    }
    return result;
  } catch {
    throw invalid();
  }
}

export const secretSettingKeys = new Set([
  "smtp.password",
  "ai.apiKey",
  "ai.chatApiKey",
  "storage.s3.accessKey",
  "storage.s3.secretKey",
]);

export function assertSafeMigratedSecrets(
  row: Record<string, unknown>,
  dataset: DatasetDefinition,
): void {
  if (dataset.minimumMode === "full") throw invalid();
  for (const [column, value] of Object.entries(row)) {
    if (requiresEncryptedInspection(dataset, column) && containsEncrypted(value))
      throw invalid();
  }
  if (
    dataset.tableName === "setting" &&
    (row.is_secret !== false || secretSettingKeys.has(String(row.key)))
  )
    throw invalid();
}
