// @vitest-environment node
import { expect, it } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { assertCompatibleManifest } from "../src/server/services/system-backup/compatibility.ts";
import { currentAppVersion } from "../src/server/services/app-version.ts";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";

it("用例库成套迁移；仅旧包允许全缺，新包缺失或残缺拒绝", () => {
  const names = [
    "projects.test_suite",
    "projects.test_case",
    "projects.test_case_revision",
    "projects.test_case_requirement",
  ];
  const datasets = orderedDatasets("safe").map((d) => ({
    name: d.name,
    schemaVersion: d.schemaVersion,
    path: `data/${d.name}.jsonl`,
    dependsOn: [...d.dependsOn],
    rows: 0,
  }));
  expect(names.every((name) => datasets.some((d) => d.name === name))).toBe(
    true,
  );
  const current = {
    sourceAppVersion: currentAppVersion,
    mode: "safe",
    requiredFeatures: ["test-case-library"],
    datasets,
  } as SystemBackupManifest;
  expect(() => assertCompatibleManifest(current)).not.toThrow();
  const missing = {
    ...current,
    datasets: datasets.filter((d) => !names.includes(d.name)),
  };
  expect(() => assertCompatibleManifest(missing)).toThrow();
  expect(() =>
    assertCompatibleManifest({ ...missing, datasets: missing.datasets.filter(d=>!["projects.test_plan","projects.test_plan_case","projects.test_run","projects.test_run_defect","projects.release_candidate","projects.release_verification","projects.release_feedback"].includes(d.name)), requiredFeatures: [] }),
  ).not.toThrow();
  expect(() =>
    assertCompatibleManifest({
      ...current,
      requiredFeatures: [],
      datasets: datasets.filter((d) => d.name !== names[1]),
    }),
  ).toThrow();
});
