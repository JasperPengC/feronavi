import { currentAppVersion } from "../app-version.ts";
import { DomainError } from "../../../shared/errors.ts";
import type { SystemBackupManifest } from "../../../shared/schemas/system-backup.ts";
import { datasetRegistry, orderedDatasets } from "./registry.ts";

export type DatasetUpgrader = (
  row: Record<string, unknown>,
) => Record<string, unknown>;
export type DatasetUpgraders = ReadonlyMap<
  string,
  ReadonlyMap<number, DatasetUpgrader>
>;
const upgraders: DatasetUpgraders = new Map();
const supportedFeatures = new Set([
  "database-snapshot",
  "attachment-blobs",
  "password-encrypted",
  "persistent-collaboration-and-conversations",
]);
const targetVersion = currentAppVersion;

export const incompatibleBackup = () =>
  new DomainError(
    "INCOMPATIBLE_BACKUP",
    "迁移包版本或功能与目标实例不兼容",
    null,
  );

export function upgradeDatasetRow(
  name: string,
  fromVersion: number,
  row: Record<string, unknown>,
  converters: DatasetUpgraders = upgraders,
): Record<string, unknown> {
  const dataset = datasetRegistry.find((entry) => entry.name === name);
  if (
    !dataset ||
    !Number.isInteger(fromVersion) ||
    fromVersion < 0 ||
    fromVersion > dataset.schemaVersion
  )
    throw incompatibleBackup();
  let result = row;
  for (let version = fromVersion; version < dataset.schemaVersion; version++) {
    const convert = converters.get(name)?.get(version);
    if (!convert) throw incompatibleBackup();
    result = convert(result);
  }
  return result;
}

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

const collaborationNames = ["content.collab_room", "content.collab_update", "content.collab_snapshot"];
const originalV1Additions = [...collaborationNames, "operations.rag_conversation", "operations.rag_message"];

/** 仅识别已交付的两种完整v1布局；当前包的功能标记禁止把损坏包误认成旧包。 */
export function legacyDatasetLayout(manifest: SystemBackupManifest): boolean {
  if (manifest.requiredFeatures.includes("persistent-collaboration-and-conversations")) return false;
  const present = new Set(manifest.datasets.map(entry => entry.name));
  const missing = orderedDatasets(manifest.mode).filter(entry => !present.has(entry.name)).map(entry => entry.name);
  return [collaborationNames, originalV1Additions].some(layout => missing.length === layout.length && layout.every(name => missing.includes(name)));
}

export function upgradeLegacyDatasetRow(manifest: SystemBackupManifest, name: string, row: Record<string, unknown>): Record<string, unknown> {
  if (!legacyDatasetLayout(manifest)) return row;
  if (name === "projects.approval_request" && !Object.hasOwn(row, "transition_fields")) return { ...row, transition_fields: {} };
  if (name === "operations.rag_message" && !Object.hasOwn(row, "request_metadata")) return { ...row, request_metadata: null };
  return row;
}

export function assertCompatibleManifest(manifest: SystemBackupManifest): void {
  if (
    manifest.requiredFeatures.some((feature) => !supportedFeatures.has(feature))
  )
    throw incompatibleBackup();
  const source = versionParts(manifest.sourceAppVersion);
  const target = versionParts(targetVersion)!;
  if (!source) throw incompatibleBackup();
  for (let i = 0; i < 3; i++) {
    if (source[i]! > target[i]!) throw incompatibleBackup();
    if (source[i]! < target[i]!) break;
  }
  const legacy = legacyDatasetLayout(manifest);
  const expected = orderedDatasets(manifest.mode).filter(definition => !legacy || manifest.datasets.some(entry => entry.name === definition.name));
  const entries = new Map(
    manifest.datasets.map((entry) => [entry.name, entry]),
  );
  if (
    entries.size !== manifest.datasets.length ||
    entries.size !== expected.length
  )
    throw incompatibleBackup();
  for (const definition of expected) {
    const entry = entries.get(definition.name);
    if (
      !entry ||
      entry.schemaVersion !== definition.schemaVersion ||
      entry.path !== `data/${definition.name}.jsonl` ||
      entry.dependsOn.length !== definition.dependsOn.length ||
      new Set(entry.dependsOn).size !== entry.dependsOn.length ||
      definition.dependsOn.some(
        (name) => !entry.dependsOn.includes(name) || !entries.has(name),
      )
    )
      throw incompatibleBackup();
  }
}

export function assertRestoreCapacity(
  archiveBytes: number,
  expandedBytes: number,
  availableBytes: number,
): void {
  if (
    ![archiveBytes, expandedBytes, availableBytes].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    archiveBytes + expandedBytes > availableBytes
  )
    throw new DomainError("INSUFFICIENT_STORAGE", "目标实例磁盘空间不足", null);
}
