// @vitest-environment node
import { expect, it } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { assertCompatibleManifest } from "../src/server/services/system-backup/compatibility.ts";
import { currentAppVersion } from "../src/server/services/app-version.ts";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";

it("变更与影响成套迁移；仅旧包允许全缺，新包缺失或残缺拒绝", () => {
  const names = [
    "projects.requirement_change",
    "projects.requirement_change_impact",
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
    requiredFeatures: ["requirement-changes"],
    datasets,
  } as SystemBackupManifest;
  expect(() => assertCompatibleManifest(current)).not.toThrow();
  const missing = {
    ...current,
    datasets: datasets.filter((d) => !names.includes(d.name)),
  };
  expect(() => assertCompatibleManifest(missing)).toThrow();
  expect(() =>
    assertCompatibleManifest({ ...missing, requiredFeatures: [] }),
  ).not.toThrow();
  expect(() =>
    assertCompatibleManifest({
      ...current,
      requiredFeatures: [],
      datasets: datasets.filter((d) => d.name !== names[1]),
    }),
  ).toThrow();
});
