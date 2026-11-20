import type { BackupMode } from "../../../shared/schemas/system-backup.ts";

export type BackupPurpose = "migration" | "compliance";
export type TableDisposition = "migrate" | "rebuild" | "exclude" | "control";

export interface ImportContext {
  mode: BackupMode;
  phase: "insert" | "backfill";
}

export interface DeferredReferenceColumn {
  column: string;
  targetDataset: string;
  targetColumn: string;
}

export interface DatasetDefinition {
  name: string;
  tableName: string;
  schemaVersion: 1;
  minimumMode: BackupMode;
  disposition: "migrate";
  dependsOn: readonly string[];
  columns: readonly string[];
  dateColumns: readonly string[];
  selfReferenceColumns: readonly string[];
  deferredReferenceColumns: readonly DeferredReferenceColumn[];
  secretColumns: readonly string[];
  /** 仅包含可逆enc:v1列；secretColumns同时包含不可逆hash和敏感JSON，不能用于解密。 */
  rewrapColumns: readonly string[];
  orderBy: readonly string[];
  encodeRow(
    row: Record<string, unknown>,
    context: { mode: BackupMode; purpose: BackupPurpose },
  ): Record<string, unknown> | null;
  decodeRow(
    row: Record<string, unknown>,
    ctx: ImportContext,
  ): Promise<Record<string, unknown>>;
}

export interface DatasetOptions {
  name: string;
  tableName: string;
  schemaVersion?: 1;
  disposition?: "migrate";
  minimumMode: BackupMode;
  dependsOn: readonly string[];
  columns: readonly string[];
  dateColumns: readonly string[];
  orderBy: readonly string[];
  selfReferenceColumns?: readonly string[];
  deferredReferenceColumns?: readonly DeferredReferenceColumn[];
  secretColumns?: readonly string[];
  rewrapColumns?: readonly string[];
  safeFilter?: (row: Record<string, unknown>) => boolean;
  safeTransform?: (row: Record<string, unknown>) => Record<string, unknown>;
}

export function defineDataset(options: DatasetOptions): DatasetDefinition {
  const dates = new Set(options.dateColumns);
  const selfReferences = options.selfReferenceColumns ?? [];
  const deferredReferences = options.deferredReferenceColumns ?? [];
  const secrets = new Set(options.secretColumns ?? []);
  return {
    name: options.name,
    tableName: options.tableName,
    schemaVersion: 1,
    disposition: "migrate",
    minimumMode: options.minimumMode,
    dependsOn: options.dependsOn,
    columns: options.columns,
    dateColumns: options.dateColumns,
    orderBy: options.orderBy,
    selfReferenceColumns: selfReferences,
    deferredReferenceColumns: deferredReferences,
    secretColumns: [...secrets],
    rewrapColumns: options.rewrapColumns ?? [],
    encodeRow(row, context) {
      if (context.mode === "safe" && options.minimumMode === "full")
        return null;
      if (
        context.mode === "safe" &&
        options.safeFilter &&
        !options.safeFilter(row)
      )
        return null;
      const result: Record<string, unknown> = {};
      for (const column of options.columns) {
        if (
          context.purpose === "compliance" &&
          (column === "password_hash" || secrets.has(column))
        )
          continue;
        const value = row[column];
        if (value === undefined) continue;
        if (dates.has(column) && value !== null) {
          const date = value instanceof Date ? value : new Date(String(value));
          if (!Number.isFinite(date.getTime()))
            throw new Error(`Invalid date in ${options.name}.${column}`);
          result[column] = date.toISOString();
        } else {
          result[column] = value;
        }
      }
      const transformed =
        context.mode === "safe" && options.safeTransform
          ? options.safeTransform(result)
          : result;
      const projected: Record<string, unknown> = {};
      for (const column of options.columns) {
        if (
          context.purpose === "compliance" &&
          (column === "password_hash" || secrets.has(column))
        )
          continue;
        const value = transformed[column];
        if (value !== undefined) projected[column] = value;
      }
      return projected;
    },
    async decodeRow(row, ctx) {
      const result: Record<string, unknown> = {};
      for (const column of options.columns) {
        if (!Object.hasOwn(row, column)) continue;
        const value = row[column];
        if (
          ctx.phase === "insert" &&
          (selfReferences.includes(column) ||
            deferredReferences.some((reference) => reference.column === column))
        ) {
          result[column] = null;
        } else if (dates.has(column) && typeof value === "string") {
          const date = new Date(value);
          if (!Number.isFinite(date.getTime()))
            throw new Error(`Invalid date in ${options.name}.${column}`);
          result[column] = date;
        } else {
          result[column] = value;
        }
      }
      return result;
    },
  };
}
