// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as nativeFs from "node:fs";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import {
  backupFixture,
  fixturePassword,
} from "./support/system-backup-fixture.ts";

const roots: string[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, statfs: vi.fn(real.statfs) };
});
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, createWriteStream: vi.fn(real.createWriteStream) };
});
async function root() {
  const dir = await mkdtemp(join(tmpdir(), "restore-validator-test-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(fs.statfs).mockClear();
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it("正确包逐条验证后返回manifest且不留下明文临时目录", async () => {
  const { authenticateAndReadManifest } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const dir = await root();
  const fixture = await backupFixture(dir);
  const result = await authenticateAndReadManifest(
    fixture.path,
    fixturePassword,
  );
  try {
    expect(result.manifest.packageId).toBe(fixture.manifest.packageId);
  } finally {
    result.dataKey.fill(0);
  }
  expect(
    (await readdir(dir)).filter((name) => name.startsWith("preflight-")),
  ).toEqual([]);
});

it("完整包验证full数据集和加密载荷中的32字节源主密钥", async () => {
  const { authenticateAndReadManifest } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const fixture = await backupFixture(await root(), { mode: "full" });
  const result = await authenticateAndReadManifest(
    fixture.path,
    fixturePassword,
  );
  try {
    expect(result.manifest.mode).toBe("full");
  } finally {
    result.dataKey.fill(0);
  }
});

it.each([
  ["错误密码", {}, "wrong-password-123", "INVALID_BACKUP"],
  ["密文篡改", { tamper: true }, fixturePassword, "INVALID_BACKUP"],
  [
    "未来外层版本",
    { header: { formatVersion: 2 } },
    fixturePassword,
    "INCOMPATIBLE_BACKUP",
  ],
  [
    "未来数据版本",
    { manifest: { dataSchemaVersion: 2 } },
    fixturePassword,
    "INCOMPATIBLE_BACKUP",
  ],
  ["缺manifest", { missingManifest: true }, fixturePassword, "INVALID_BACKUP"],
  ["重复条目", { duplicate: true }, fixturePassword, "INVALID_BACKUP"],
  ["dataset摘要不符", { badDataset: true }, fixturePassword, "INVALID_BACKUP"],
  [
    "缺数据集",
    { manifest: { datasets: [] } },
    fixturePassword,
    "INCOMPATIBLE_BACKUP",
  ],
  [
    "未知功能",
    { manifest: { requiredFeatures: ["future-secret-feature"] } },
    fixturePassword,
    "INCOMPATIBLE_BACKUP",
  ],
  [
    "来源应用更新",
    { manifest: { sourceAppVersion: "999.0.0" } },
    fixturePassword,
    "INCOMPATIBLE_BACKUP",
  ],
] as const)("%s在写业务前失败", async (_name, options, password, code) => {
  const { authenticateAndReadManifest } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const fixture = await backupFixture(await root(), options);
  await expect(
    authenticateAndReadManifest(fixture.path, password),
  ).rejects.toMatchObject({ code });
});

it("连续升级器允许内存v0到v1，缺环节与未来版本拒绝", async () => {
  const { upgradeDatasetRow } =
    await import("../src/server/services/system-backup/compatibility.ts");
  const upgrades = new Map([
    [
      "identity.organization",
      new Map([
        [0, (row: Record<string, unknown>) => ({ ...row, name: row.title })],
      ]),
    ],
  ]);
  expect(
    upgradeDatasetRow("identity.organization", 0, { title: "old" }, upgrades),
  ).toEqual({ title: "old", name: "old" });
  expect(() => upgradeDatasetRow("identity.organization", 0, {})).toThrow(
    expect.objectContaining({ code: "INCOMPATIBLE_BACKUP" }),
  );
  expect(() => upgradeDatasetRow("identity.organization", 2, {})).toThrow(
    expect.objectContaining({ code: "INCOMPATIBLE_BACKUP" }),
  );
});

it("磁盘容量必须同时覆盖明文归档与恢复展开空间", async () => {
  const { assertRestoreCapacity } =
    await import("../src/server/services/system-backup/compatibility.ts");
  expect(() => assertRestoreCapacity(100, 100, 199)).toThrow(
    expect.objectContaining({ code: "INSUFFICIENT_STORAGE" }),
  );
  expect(() => assertRestoreCapacity(100, 100, 200)).not.toThrow();
});

it("OS报告磁盘不足时不创建明文临时归档", async () => {
  const { authenticateAndReadManifest } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const dir = await root();
  const fixture = await backupFixture(dir);
  const space = await fs.statfs(dir);
  vi.mocked(fs.statfs).mockResolvedValueOnce({ ...space, bavail: 0 });
  await expect(
    authenticateAndReadManifest(fixture.path, fixturePassword),
  ).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE" });
  expect(
    (await readdir(dir)).filter((name) => name.startsWith("preflight-")),
  ).toEqual([]);
});

it("配置可向下收紧限制，禁止放宽默认安全上限", async () => {
  const { restoreLimits } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  vi.stubEnv("SYSTEM_BACKUP_MAX_BYTES", "100");
  expect(restoreLimits().maxUploadBytes).toBe(100);
  vi.stubEnv("SYSTEM_BACKUP_MAX_BYTES", String(20 * 1024 ** 3));
  expect(() => restoreLimits()).toThrow(
    expect.objectContaining({ code: "VALIDATION" }),
  );
});

it("单行dataset超过上限时流式拒绝，避免readline累积整条巨型记录", async () => {
  const { authenticateAndReadManifest } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const content = Buffer.from(
    JSON.stringify({ text: randomBytes(13 * 1024 * 1024).toString("base64") }) +
      "\n",
  );
  const fixture = await backupFixture(await root(), {
    datasetContent: content,
  });
  await expect(
    authenticateAndReadManifest(fixture.path, fixturePassword),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});

it("解密写入遇到ENOSPC时返回容量错误并清理临时目录", async () => {
  const { authenticateAndReadManifest } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const dir = await root();
  const fixture = await backupFixture(dir);
  const sink = new Writable({
    write(_chunk, _encoding, done) {
      done(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    },
  });
  vi.mocked(nativeFs.createWriteStream).mockReturnValueOnce(
    sink as import("node:fs").WriteStream,
  );
  await expect(
    authenticateAndReadManifest(fixture.path, fixturePassword),
  ).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE" });
  expect(
    (await readdir(dir)).filter((name) => name.startsWith("preflight-")),
  ).toEqual([]);
});

it("旧v1仅接受完整的历史布局，当前包及部分缺失数据集必须拒绝", async () => {
  const { assertCompatibleManifest, upgradeLegacyDatasetRow } = await import("../src/server/services/system-backup/compatibility.ts");
  const fixture = await backupFixture(await root());
  const { manifestSchema } = await import("../src/shared/schemas/system-backup.ts");
  const current = manifestSchema.parse(fixture.manifest);
  const collab = ["content.collab_room", "content.collab_update", "content.collab_snapshot"];
  const rag = ["operations.rag_conversation", "operations.rag_message"];
  const without = (names: string[]) => ({ ...current, datasets: current.datasets.filter(entry => !names.includes(entry.name)) });
  for (const layout of [collab, [...collab, ...rag]]) {
    const legacy = without(layout);
    expect(() => assertCompatibleManifest(legacy)).not.toThrow();
    expect(() => assertCompatibleManifest({ ...legacy, requiredFeatures: ["persistent-collaboration-and-conversations"] })).toThrow(expect.objectContaining({ code: "INCOMPATIBLE_BACKUP" }));
    expect(upgradeLegacyDatasetRow(legacy, "projects.approval_request", { id: "legacy" })).toEqual({ id: "legacy", transition_fields: {} });
  }
  for (const missing of [[collab[0]!], collab.slice(0, 2), rag, [...collab, "identity.team"], [...collab, rag[0]!]]) {
    expect(() => assertCompatibleManifest(without(missing))).toThrow(expect.objectContaining({ code: "INCOMPATIBLE_BACKUP" }));
  }
  expect(upgradeLegacyDatasetRow(current, "projects.approval_request", { id: "current" })).toEqual({ id: "current" });
});
