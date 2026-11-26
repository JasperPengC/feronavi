// @vitest-environment node
import { expect, it } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { assertCompatibleManifest } from "../src/server/services/system-backup/compatibility.ts";
import { currentAppVersion } from "../src/server/services/app-version.ts";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";

it("正文历史随备份迁移，仅缺少新特性标记的旧包可缺整个历史数据集", () => {
  const datasets = orderedDatasets("safe").map(d => ({ name: d.name, schemaVersion: d.schemaVersion, path: `data/${d.name}.jsonl`, dependsOn: [...d.dependsOn], rows: 0 }));
  expect(datasets.find(d => d.name === "projects.requirement_revision")).toBeDefined();
  const current = { sourceAppVersion: currentAppVersion, mode: "safe", requiredFeatures: ["persistent-collaboration-and-conversations", "requirement-history"], datasets } as SystemBackupManifest;
  expect(() => assertCompatibleManifest(current)).not.toThrow();
  const missing = { ...current, datasets: datasets.filter(d => d.name !== "projects.requirement_revision") };
  expect(() => assertCompatibleManifest(missing)).toThrow(expect.objectContaining({ code: "INCOMPATIBLE_BACKUP" }));
  const later = ['requirement_change','requirement_change_impact','test_suite','test_case','test_case_revision','test_case_requirement','test_plan','test_plan_case','test_run','test_run_defect','release_candidate','release_verification','release_feedback'].map(name=>'projects.'+name);
  const old = { ...missing, datasets: missing.datasets.filter(d=>!later.includes(d.name)), requiredFeatures: ["persistent-collaboration-and-conversations"] };
  expect(() => assertCompatibleManifest(old)).not.toThrow();
  expect(() => assertCompatibleManifest({ ...old, datasets: old.datasets.filter(d => d.name !== "identity.team") })).toThrow();
  const oldest = { ...old, requiredFeatures: [], datasets: old.datasets.filter(d => !["content.collab_room", "content.collab_update", "content.collab_snapshot", "operations.rag_conversation", "operations.rag_message"].includes(d.name)) };
  expect(() => assertCompatibleManifest(oldest)).not.toThrow();
});
