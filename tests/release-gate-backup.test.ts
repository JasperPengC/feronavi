// @vitest-environment node
import { expect, it } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { assertCompatibleManifest } from "../src/server/services/system-backup/compatibility.ts";
import { currentAppVersion } from "../src/server/services/app-version.ts";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";
it("发布门禁旧包全缺兼容，声明新功能或残缺数据集拒绝", () => {
  const names = [
    "projects.release_candidate",
    "projects.release_verification",
    "projects.release_feedback",
  ];
  const datasets = orderedDatasets("safe").map((d) => ({
    name: d.name,
    schemaVersion: 1,
    path: `data/${d.name}.jsonl`,
    dependsOn: [...d.dependsOn],
    rows: 0,
  }));
  const current = {
    sourceAppVersion: currentAppVersion,
    mode: "safe",
    requiredFeatures: ["release-gate"],
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
