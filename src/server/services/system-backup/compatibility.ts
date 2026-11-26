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
  "requirement-history",
  "document-folders",
  "product-attribution",
  "requirement-changes",
  "test-case-library",
  "test-execution", "test-execution-builds", "delivery-evidence", "release-gate",
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
const productDatasets = ["projects.product", "projects.product_project"];
const changeDatasets = ["projects.requirement_change", "projects.requirement_change_impact"];
const testDatasets = ["projects.test_suite", "projects.test_case", "projects.test_case_revision", "projects.test_case_requirement"];
const executionDatasets=["projects.test_plan","projects.test_plan_case","projects.test_run","projects.test_run_defect"];
const gateDatasets=['projects.release_candidate','projects.release_verification','projects.release_feedback'];
function withoutGate(manifest:SystemBackupManifest){return !manifest.requiredFeatures.includes('release-gate')&&!manifest.datasets.some(d=>gateDatasets.includes(d.name));}
const deliveryDatasets=['projects.delivery_source','projects.delivery_evidence','projects.delivery_evidence_link','projects.delivery_receipt'];
function withoutDelivery(manifest:SystemBackupManifest){return !manifest.requiredFeatures.includes('delivery-evidence')&&!manifest.datasets.some(d=>deliveryDatasets.includes(d.name));}
function withoutExecution(manifest:SystemBackupManifest):boolean{return !manifest.requiredFeatures.some(f=>f==="test-execution"||f==="test-execution-builds")&&!manifest.datasets.some(entry=>executionDatasets.includes(entry.name));}
function withoutTests(manifest: SystemBackupManifest): boolean {
  return !manifest.requiredFeatures.includes("test-case-library") && !manifest.datasets.some(entry => testDatasets.includes(entry.name));
}
function withoutChanges(manifest: SystemBackupManifest): boolean {
  return !manifest.requiredFeatures.includes("requirement-changes") && !manifest.datasets.some(entry => changeDatasets.includes(entry.name));
}
function withoutProducts(manifest: SystemBackupManifest): boolean {
  return !manifest.requiredFeatures.includes("product-attribution") && !manifest.datasets.some(entry => productDatasets.includes(entry.name));
}

export function needsRequirementBaselines(manifest: SystemBackupManifest): boolean {
  return !manifest.requiredFeatures.includes("requirement-history")
    && !manifest.datasets.some(entry => entry.name === "projects.requirement_revision");
}

/** 仅识别已交付的两种完整v1布局；当前包的功能标记禁止把损坏包误认成旧包。 */
export function legacyDatasetLayout(manifest: SystemBackupManifest): boolean {
  if (manifest.requiredFeatures.some(feature => ["persistent-collaboration-and-conversations", "requirement-history", "document-folders", "product-attribution", "requirement-changes", "test-case-library", "test-execution", "test-execution-builds", "delivery-evidence", "release-gate"].includes(feature))) return false;
  const present = new Set(manifest.datasets.map(entry => entry.name));
  const missing = orderedDatasets(manifest.mode).filter(entry => !present.has(entry.name)
    && !(entry.name === "projects.requirement_revision" && needsRequirementBaselines(manifest))
    && !(withoutChanges(manifest) && changeDatasets.includes(entry.name))
    && !(withoutTests(manifest) && testDatasets.includes(entry.name))
    && !(withoutExecution(manifest) && executionDatasets.includes(entry.name))
    && !(withoutDelivery(manifest) && deliveryDatasets.includes(entry.name))
    && !(withoutGate(manifest) && gateDatasets.includes(entry.name))
    && !(withoutProducts(manifest) && productDatasets.includes(entry.name))).map(entry => entry.name);
  return [collaborationNames, originalV1Additions].some(layout => missing.length === layout.length && layout.every(name => missing.includes(name)));
}

export function upgradeLegacyDatasetRow(manifest: SystemBackupManifest, name: string, row: Record<string, unknown>): Record<string, unknown> {
  if (name === "projects.work_item" && withoutProducts(manifest)) row = { product_id: null, ...row };
  if (name === "content.page" && !manifest.requiredFeatures.includes("document-folders")) {
    row = { kind: "DOCUMENT", structure_version: 1, created_by: null, archived_at: null, ...row };
  }
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
  const expected = orderedDatasets(manifest.mode).filter(definition =>
    !(definition.name === "projects.requirement_revision" && needsRequirementBaselines(manifest))
    && !(withoutChanges(manifest) && changeDatasets.includes(definition.name))
    && !(withoutTests(manifest) && testDatasets.includes(definition.name))
    && !(withoutExecution(manifest) && executionDatasets.includes(definition.name))
    && !(withoutDelivery(manifest) && deliveryDatasets.includes(definition.name))
    && !(withoutGate(manifest) && gateDatasets.includes(definition.name))
    && !(withoutProducts(manifest) && productDatasets.includes(definition.name))
    && (!legacy || manifest.datasets.some(entry => entry.name === definition.name)));
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
    const dependencies = definition.dependsOn.filter(name => !(withoutProducts(manifest) && productDatasets.includes(name)));
    if (
      !entry ||
      entry.schemaVersion !== definition.schemaVersion ||
      entry.path !== `data/${definition.name}.jsonl` ||
      entry.dependsOn.length !== dependencies.length ||
      new Set(entry.dependsOn).size !== entry.dependsOn.length ||
      dependencies.some(
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
