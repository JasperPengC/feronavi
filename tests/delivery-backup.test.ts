// @vitest-environment node
import { expect, it } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";
import { assertCompatibleManifest } from "../src/server/services/system-backup/compatibility.ts";
import { currentAppVersion } from "../src/server/services/app-version.ts";
import type { SystemBackupManifest } from "../src/shared/schemas/system-backup.ts";
it("交付旧包全缺兼容，新包残缺拒绝；安全包保留历史而停用来源与移除密钥", () => {
  const names = [
    "projects.delivery_source",
    "projects.delivery_evidence",
    "projects.delivery_evidence_link",
    "projects.delivery_receipt",
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
    requiredFeatures: ["delivery-evidence"],
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
      datasets: datasets.filter((d) => d.name !== names[2]),
    }),
  ).toThrow();
  const source = orderedDatasets("safe").find(
    (d) => d.tableName === "delivery_source",
  )!;
  const row = source.encodeRow(
    {
      id: "x",
      integration_id: "integration",
      webhook_secret_encrypted: "enc:v1:secret",
      enabled: true,
    },
    { mode: "safe", purpose: "migration" },
  );
  expect(row).toEqual({
    id: "x",
    integration_id: null,
    webhook_secret_encrypted: null,
    enabled: false,
  });
  expect(
    source.encodeRow(
      { webhook_secret_encrypted: "secret" },
      { mode: "full", purpose: "compliance" },
    ),
  ).not.toHaveProperty("webhook_secret_encrypted");
});
