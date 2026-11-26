import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "../../../db/schema.ts";
import {
  DomainError,
  SYSTEM_RESTORE_ERROR_CODES,
} from "../../../shared/errors.ts";
import type {
  BackupMode,
  SystemBackupManifest,
} from "../../../shared/schemas/system-backup.ts";
import type { DatasetDefinition } from "./registry.ts";
import { orderedDatasets } from "./registry.ts";
import { assertCompatibleManifest, upgradeLegacyDatasetRow } from "./compatibility.ts";
import { entryStream, nextEntry, openZip } from "./archive.ts";
import { restoredBlobPath } from "./attachment-blobs.ts";
import {
  assertSafeMigratedSecrets,
  rewrapMigratedSecrets,
} from "./secret-rewrap.ts";

const tables = new Map<string, PgTable>(
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, Table))
    .map((table) => [getTableName(table), table]),
);
const RESTORE_ERROR_CODES = SYSTEM_RESTORE_ERROR_CODES;
type RestoreErrorCode = (typeof RESTORE_ERROR_CODES)[number];
const messages: Record<RestoreErrorCode, string> = {
  INVALID_BACKUP: "迁移包数据不合法",
  INCOMPATIBLE_BACKUP: "迁移包与当前恢复能力不兼容",
  TARGET_NOT_EMPTY: "目标实例包含业务数据或已初始化",
  INSUFFICIENT_STORAGE: "目标实例磁盘空间不足",
  RESTORE_FAILED: "系统数据恢复失败",
};

export function classifyRestoreError(error: unknown): DomainError {
  const candidate = error as { code?: string; cause?: unknown };
  let code: RestoreErrorCode = "RESTORE_FAILED";
  if (
    error instanceof DomainError &&
    RESTORE_ERROR_CODES.includes(error.code as RestoreErrorCode)
  )
    code = error.code as RestoreErrorCode;
  else if (candidate?.code === "ENOSPC" || candidate?.code === "53100")
    code = "INSUFFICIENT_STORAGE";
  else if (/^(22|23)/.test(candidate?.code ?? "")) code = "INVALID_BACKUP";
  else if (candidate?.cause) return classifyRestoreError(candidate.cause);
  return new DomainError(code, messages[code], null);
}

const validators = new Map<string, z.ZodType>();
export function validateImportRow(
  dataset: DatasetDefinition,
  row: unknown,
): Record<string, unknown> {
  let validator = validators.get(dataset.name);
  if (!validator) {
    const table = tables.get(dataset.tableName);
    if (!table) throw new Error("缺少导入表定义");
    const columns = new Map(
      Object.values(getTableColumns(table)).map((column) => [
        column.name,
        column,
      ]),
    );
    const shape: Record<string, z.ZodType> = {};
    for (const name of dataset.columns) {
      const column = columns.get(name);
      if (!column) throw new Error("缺少导入列定义");
      let value: z.ZodType;
      if (column.getSQLType() === "uuid") value = z.string().uuid();
      else if (dataset.dateColumns.includes(name))
        value = z.iso.datetime({ offset: true });
      else if (
        column.getSQLType() === "bigint" &&
        column.dataType === "number"
      ) {
        const number = z.number().int().safe();
        // postgres.js原生cursor把int8写成规范十进制字符串，不能泛化放宽integer列。
        value = z.union([
          number,
          z
            .string()
            .regex(/^(?:0|-?[1-9][0-9]*)$/u)
            .transform(Number)
            .pipe(number),
        ]);
        if (name === "size_bytes")
          value = value.refine((size) => Number(size) >= 0);
      } else if (column.dataType === "number")
        value = /^(smallint|integer|bigint)$/.test(column.getSQLType())
          ? z.number().int().safe()
          : z.number().finite();
      else if (column.dataType === "boolean") value = z.boolean();
      else if (column.dataType === "json") value = z.json();
      else value = z.string();
      shape[name] = column.notNull ? value : value.nullable();
    }
    validator = z.strictObject(shape);
    validators.set(dataset.name, validator);
  }
  const parsed = validator.safeParse(row);
  if (!parsed.success)
    throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
  return parsed.data as Record<string, unknown>;
}

export async function decodeImportRow(
  dataset: DatasetDefinition,
  row: Record<string, unknown>,
  mode: BackupMode,
) {
  return {
    insert: await dataset.decodeRow(row, { mode, phase: "insert" }),
    backfill: Object.fromEntries(
      [
        "id",
        ...dataset.selfReferenceColumns,
        ...dataset.deferredReferenceColumns.map((ref) => ref.column),
      ].map((column) => [column, row[column]]),
    ),
  };
}

/** 上游已验证总大小和摘要；这里仍限制单行，避免流式导入中的大行分配。 */
export async function* readJsonlBatches(
  stream: Readable,
): AsyncGenerator<Record<string, unknown>[]> {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let batch: Record<string, unknown>[] = [];
  let batchBytes = 0;
  try {
    for await (const line of lines) {
      const lineBytes = Buffer.byteLength(line);
      if (!line || lineBytes > 16 * 1024 * 1024) throw new Error("invalid row");
      if (batch.length && batchBytes + lineBytes + 1 > 8 * 1024 * 1024) {
        yield batch;
        batch = [];
        batchBytes = 0;
      }
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("invalid row");
      batch.push(row as Record<string, unknown>);
      batchBytes += lineBytes + 1;
      if (batch.length === 500 || batchBytes >= 8 * 1024 * 1024) {
        yield batch;
        batch = [];
        batchBytes = 0;
      }
    }
    if (batch.length) yield batch;
  } catch {
    throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** 格式和密钥条目已由认证归档验证；两种模式均可导入。 */
export function assertImportCapability(manifest: SystemBackupManifest): void {
  void manifest;
}

export function prepareImportRow(
  dataset: DatasetDefinition,
  input: Record<string, unknown>,
  mode: BackupMode,
  packageId?: string,
): Record<string, unknown> {
  const row = { ...input };
  if (dataset.tableName === "setting" && row.key === "storage.kind")
    row.value = "local";
  if (
    dataset.tableName === "setting" &&
    row.key === "knowledge.active_generation"
  )
    row.value = 1;
  if (
    dataset.tableName === "setting" &&
    String(row.key).startsWith("storage.s3.")
  ) {
    row.key = `migration.disabled.${String(row.key)}`;
    if (row.is_secret === false)
      row.value = { enabled: false, sourceValue: row.value };
  }
  if (dataset.tableName === "attachment") {
    row.storage_backend = "local";
    row.storage_path = restoredBlobPath(
      packageId ?? "",
      String(row.content_hash),
    );
  }
  if (mode !== "safe") return row;
  assertSafeMigratedSecrets(input, dataset);
  if (
    dataset.tableName === "setting" &&
    ["ai.baseUrl", "ai.chatBaseUrl"].includes(String(row.key))
  ) {
    row.key = `migration.disabled.${String(row.key)}`;
    row.value = { enabled: false, sourceValue: row.value };
  }
  if (dataset.tableName === "setting" && row.is_secret !== false)
    throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
  for (const column of dataset.secretColumns) {
    if (
      column === "password_hash" ||
      dataset.tableName === "setting" ||
      column === "submit_token_hash"
    )
      continue;
    if (row[column] !== null && row[column] !== "")
      throw new DomainError(
        "INCOMPATIBLE_BACKUP",
        messages.INCOMPATIBLE_BACKUP,
        null,
      );
  }
  if (dataset.tableName === "intake_form") {
    row.is_active = false;
    row.submit_token_hash = `disabled-migration:${String(row.id)}`;
  }
  if (dataset.tableName === "setting" && row.key === "storage.kind")
    row.value = "local";
  if (dataset.tableName === "setting" && row.key === "ai.enabled")
    row.value = false;
  // safe的registry变换也用于导入，避免手工构造的safe包重新激活外部集成。
  return (
    dataset.encodeRow(row, { mode, purpose: "migration" }) ??
    (() => {
      throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
    })()
  );
}

/** 所有数据库操作由调用者的事务上下文提供；种子和业务数据整体提交或回滚。 */
export async function importDatasets(
  path: string,
  manifest: SystemBackupManifest,
  keys?: { sourceKey: Buffer; targetKey: Buffer },
): Promise<void> {
  assertCompatibleManifest(manifest);
  const { db, sql } = await import("../../../db/index.ts");
  const baseline = await sql<{ id: string }[]>`select id from audit_entry`;
  for (const table of [
    "role_permission",
    "workflow_transition",
    "workflow_state",
    "workflow",
    "role",
    "permission",
    "project_status_def",
  ])
    await sql`delete from ${sql(table)}`;
  // 无历史setup行的全新实例与曾记录步骤的实例都生成恰好一个最终控制标记。
  const zip = await openZip(path);
  try {
    const entries = new Map();
    for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip))
      entries.set(entry.fileName, entry);
    for (const dataset of orderedDatasets(manifest.mode)) {
      const metadata = manifest.datasets.find(
        (item) => item.name === dataset.name,
      );
      if (!metadata) continue; // 已由兼容检查确认属于完整的历史布局。
      const table = tables.get(dataset.tableName)!;
      const propertyByColumn = new Map(
        Object.entries(getTableColumns(table)).map(([key, column]) => [
          column.name,
          key,
        ]),
      );
      const entry = entries.get(metadata.path);
      if (!entry)
        throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
      let imported = 0;
      for await (const batch of readJsonlBatches(
        await entryStream(zip, entry),
      )) {
        const rows = [];
        for (const raw of batch) {
          if(dataset.tableName==="test_run"&&!manifest.requiredFeatures.includes("test-execution-builds")&&!Object.hasOwn(raw,"build")&&!Object.hasOwn(raw,"environment")){
            const [plan]=await sql`select p.build,p.environment from test_plan p join test_plan_case c on c.plan_id=p.id where c.id=${String(raw.plan_case_id)}`;
            if(!plan)throw new DomainError("INVALID_BACKUP",messages.INVALID_BACKUP,null);
            raw.build=plan.build;raw.environment=plan.environment;
          }
          const validated = validateImportRow(dataset, upgradeLegacyDatasetRow(manifest, dataset.name, raw));
          if (manifest.mode === "full" && !keys)
            throw new DomainError(
              "INVALID_BACKUP",
              messages.INVALID_BACKUP,
              null,
            );
          const row = prepareImportRow(
            dataset,
            manifest.mode === "full"
              ? await rewrapMigratedSecrets(
                  validated,
                  dataset,
                  keys!.sourceKey,
                  keys!.targetKey,
                )
              : validated,
            manifest.mode,
            manifest.packageId,
          );
          const decoded = await decodeImportRow(dataset, row, manifest.mode);
          // 先以草稿插入计划，恢复固定范围后再回填终态，保留正常业务的不可变约束。
          if (dataset.tableName === "test_plan") decoded.insert.status = "DRAFT";
          rows.push(
            Object.fromEntries(
              Object.entries(decoded.insert).map(([column, value]) => [
                propertyByColumn.get(column)!,
                value,
              ]),
            ),
          );
        }
        await db.insert(table).values(rows);
        imported += rows.length;
      }
      if (imported !== metadata.rows)
        throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
    }
    // 第二遍只读取有延迟引用的数据集；不跨批次保留正文或引用补丁。
    for (const dataset of orderedDatasets(manifest.mode)) {
      const columns = [
        ...dataset.selfReferenceColumns,
        ...dataset.deferredReferenceColumns.map((r) => r.column),
      ];
      if (!columns.length) continue;
      const metadata = manifest.datasets.find(
        (item) => item.name === dataset.name,
      );
      if (!metadata) continue;
      for await (const batch of readJsonlBatches(
        await entryStream(zip, entries.get(metadata.path)!),
      )) {
        for (const raw of batch) {
          const upgraded = validateImportRow(dataset, upgradeLegacyDatasetRow(manifest, dataset.name, raw));
          const row = Object.fromEntries(
            ["id", ...columns].map((column) => [column, upgraded[column]]),
          );
          if (columns.every((column) => row[column] === null)) continue;
          const patch = Object.fromEntries(
            columns.map((column) => [column, row[column]]),
          );
          const updated =
            await sql`update ${sql(dataset.tableName)} set ${sql(patch, ...columns)} where id=${String(row.id)} returning id`;
          if (updated.length !== 1)
            throw new DomainError(
              "INVALID_BACKUP",
              messages.INVALID_BACKUP,
              null,
            );
          for (const column of dataset.selfReferenceColumns) {
            if (row[column] === null) continue;
            if (
              !(
                await sql`select 1 from ${sql(dataset.tableName)} where id=${String(row[column])}`
              ).length
            )
              throw new DomainError(
                "INVALID_BACKUP",
                messages.INVALID_BACKUP,
                null,
              );
          }
          for (const ref of dataset.deferredReferenceColumns) {
            if (row[ref.column] === null) continue;
            const target = orderedDatasets(manifest.mode).find(
              (d) => d.name === ref.targetDataset,
            )!;
            if (
              !(
                await sql`select 1 from ${sql(target.tableName)} where ${sql(ref.targetColumn)}=${String(row[ref.column])}`
              ).length
            )
              throw new DomainError(
                "INVALID_BACKUP",
                messages.INVALID_BACKUP,
                null,
              );
          }
        }
      }
    }
    const planDataset = manifest.datasets.find(d => d.name === "projects.test_plan");
    if (planDataset) {
      for await (const batch of readJsonlBatches(await entryStream(zip,entries.get(planDataset.path)!))) {
        for (const row of batch) await sql`update test_plan set status=${String(row.status)} where id=${String(row.id)}`;
      }
    }
    if (!manifest.requiredFeatures.includes("document-folders")) {
      await sql`update page p set created_by = r.author_id from page_revision r where r.page_id = p.id and r.revision_no = 1 and p.created_by is null`;
    }
    await assertImportedInvariants(
      manifest,
      baseline.map((row) => row.id),
    );
    const { needsRequirementBaselines } = await import("./compatibility.ts");
    const { captureRestoredBaselines, restoredHistoryIsConsistent } = await import("../../repos/requirement-revision.repo.ts");
    if (needsRequirementBaselines(manifest)) await captureRestoredBaselines();
    if (!(await restoredHistoryIsConsistent())) throw new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
  } finally {
    zip.close();
  }
}

async function assertImportedInvariants(
  manifest: SystemBackupManifest,
  baseline: string[],
) {
  const { sql } = await import("../../../db/index.ts");
  const invalid = () =>
    new DomainError("INVALID_BACKUP", messages.INVALID_BACKUP, null);
  if ((await sql`select count(*)::int as n from organization`)[0]!.n !== 1)
    throw invalid();
  const admins =
    await sql`select m.password_hash from member m join role_assignment a on a.member_id=m.id join role r on r.id=a.role_id where m.status='ACTIVE' and r.key='ADMIN' and a.scope_type='ORG' and a.scope_id is null`;
  if (
    !admins.length ||
    !admins.some(
      (row) =>
        typeof row.password_hash === "string" &&
        /^\$argon2(?:id|i|d)\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(
          row.password_hash,
        ),
    )
  )
    throw invalid();
  const badWorkItems =
    await sql`select 1 from work_item i join workflow w on w.id=i.workflow_id join workflow_state s on s.id=i.status_id where s.workflow_id<>i.workflow_id or (w.project_id is not null and w.project_id<>i.project_id) or (w.project_id is null and w.is_builtin is not true) limit 1`;
  if (badWorkItems.length) throw invalid();
  const badProducts = await sql`select 1 from product p where not exists(select 1 from product_project pp where pp.product_id=p.id) limit 1`;
  const badProductRefs = await sql`select 1 from work_item w where w.product_id is not null and (w.type <> 'REQUIREMENT'
    or not exists(select 1 from product_project pp where pp.product_id=w.product_id and pp.project_id=w.project_id)) limit 1`;
  if (badProducts.length || badProductRefs.length) throw invalid();
  const { restoredChangesAreConsistent } = await import("./requirement-changes.ts");
  if (!await restoredChangesAreConsistent()) throw invalid();
  const { restoredTestCasesAreConsistent } = await import("./test-cases.ts");
  if (!await restoredTestCasesAreConsistent()) throw invalid();
  const { restoredTestExecutionIsConsistent } = await import("./test-execution.ts");
  if (!await restoredTestExecutionIsConsistent()) throw invalid();
  const {restoredDeliveryIsConsistent}=await import('./delivery.ts');
  if(!await restoredDeliveryIsConsistent())throw invalid();
  const {restoredReleaseGateIsConsistent}=await import('./release-gate.ts');
  if(!await restoredReleaseGateIsConsistent())throw invalid();
  const badFolders = await sql`select 1 from page p where p.kind = 'FOLDER' and (
    exists(select 1 from page_revision r where r.page_id = p.id)
    or exists(select 1 from collab_room c where c.resource_type = 'PAGE' and c.resource_id = p.id)
  ) limit 1`;
  if (badFolders.length) throw invalid();
  for (const dataset of orderedDatasets(manifest.mode)) {
    const metadata = manifest.datasets.find(
      (item) => item.name === dataset.name,
    );
    const result =
      await sql`select count(*)::int as n from ${sql(dataset.tableName)}`;
    const n = result[0]!.n;
    if (
      n !==
      (metadata?.rows ?? 0) +
        (dataset.tableName === "audit_entry" ? baseline.length : 0)
    )
      throw invalid();
  }
  if (
    baseline.length &&
    (await sql`select id from audit_entry where id in ${sql(baseline)}`)
      .length !== baseline.length
  )
    throw invalid();
  const blobs = new Map(
    manifest.blobs.entries.map((blob) => [blob.sha256, blob.bytes]),
  );
  for (const row of await sql`select content_hash, size_bytes, storage_backend, storage_path from attachment`)
    if (
      blobs.get(row.content_hash) !== Number(row.size_bytes) ||
      row.storage_backend !== "local" ||
      row.storage_path !==
        restoredBlobPath(manifest.packageId, row.content_hash)
    )
      throw invalid();
}
