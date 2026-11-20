// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";

it("严格拒绝未知字段、缺失字段和错误类型，不允许数据库默认值掩盖损坏", async () => {
  const { validateImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  const team = orderedDatasets("safe").find((d) => d.name === "identity.team")!;
  const row = {
    id: randomUUID(),
    name: "团队",
    parent_id: null,
    sort_order: 0,
    archived_at: null,
  };
  expect(validateImportRow(team, row)).toEqual(row);
  expect(() => validateImportRow(team, { ...row, injected: true })).toThrow();
  const { name: _name, ...missing } = row;
  expect(() => validateImportRow(team, missing)).toThrow();
  expect(() => validateImportRow(team, { ...row, sort_order: "0" })).toThrow();
  expect(() => validateImportRow(team, { ...row, sort_order: 0.1 })).toThrow();
  expect(() => validateImportRow(team, { ...row, id: "not-uuid" })).toThrow();
});

it("registry中每个自引用及延迟引用都先置空再保留原值回填", async () => {
  const { decodeImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  for (const dataset of orderedDatasets("full")) {
    const references = [
      ...dataset.selfReferenceColumns,
      ...dataset.deferredReferenceColumns.map((r) => r.column),
    ];
    if (!references.length) continue;
    const row = Object.fromEntries(dataset.columns.map((c) => [c, null]));
    row.id = randomUUID();
    for (const ref of references) row[ref] = randomUUID();
    const result = await decodeImportRow(dataset, row, "full");
    expect(Object.keys(result.backfill).sort()).toEqual(
      ["id", ...references].sort(),
    );
    for (const ref of references) {
      expect(result.insert[ref]).toBeNull();
      expect(result.backfill[ref]).toBe(row[ref]);
    }
  }
});

it("原生PG游标导出的bigint规范字符串可还原，拒绝超safe范围和非规范数值", async () => {
  const { validateImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  const dataset = orderedDatasets("safe").find(
    (d) => d.tableName === "attachment",
  )!;
  const row = {
    id: randomUUID(),
    target_type: "PAGE",
    target_id: randomUUID(),
    uploader_id: randomUUID(),
    original_name: "a.txt",
    storage_path: "source/a",
    mime_type: "text/plain",
    size_bytes: "42",
    content_hash: "a".repeat(64),
    storage_backend: "s3",
    created_at: "2026-11-14T00:00:00.000Z",
  };
  expect(validateImportRow(dataset, row).size_bytes).toBe(42);
  for (const size of ["9007199254740992", "4.2", "01", "1e2", "-0"])
    expect(() =>
      validateImportRow(dataset, { ...row, size_bytes: size }),
    ).toThrow();
});

it("批次最多500且流式保留末批，坏JSON立即中止", async () => {
  const { readJsonlBatches } =
    await import("../src/server/services/system-backup/import-data.ts");
  const { Readable } = await import("node:stream");
  const sizes: number[] = [];
  for await (const batch of readJsonlBatches(
    Readable.from(
      Array.from({ length: 1001 }, (_, id) => JSON.stringify({ id }) + "\n"),
    ),
  ))
    sizes.push(batch.length);
  expect(sizes).toEqual([500, 500, 1]);
  await expect(async () => {
    for await (const _batch of readJsonlBatches(Readable.from(["{bad}\n"]))) {
      // 消费迭代器以验证解析错误。
    }
  }).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});

it("大记录在8MiB批次边界切分，单条合法16MiB以下行独立处理", async () => {
  const { readJsonlBatches } =
    await import("../src/server/services/system-backup/import-data.ts");
  const { Readable } = await import("node:stream");
  const sizedLine = (bytes: number) =>
    JSON.stringify({ body: "x".repeat(bytes - 12) }) + "\n";
  const sizes: number[] = [];
  const bytes: number[] = [];
  for await (const batch of readJsonlBatches(
    Readable.from([
      sizedLine(4 * 1024 * 1024),
      sizedLine(4 * 1024 * 1024),
      sizedLine(4 * 1024 * 1024),
      sizedLine(12 * 1024 * 1024),
      sizedLine(4 * 1024 * 1024),
    ]),
  )) {
    sizes.push(batch.length);
    bytes.push(
      batch.reduce(
        (sum, row) => sum + Buffer.byteLength(JSON.stringify(row)) + 1,
        0,
      ),
    );
  }
  expect(sizes).toEqual([2, 1, 1, 1]);
  expect(bytes).toEqual([
    8 * 1024 * 1024,
    4 * 1024 * 1024,
    12 * 1024 * 1024,
    4 * 1024 * 1024,
  ]);
});

it("失败分类不暴露SQL、数据或任意异常文本", async () => {
  const { classifyRestoreError } =
    await import("../src/server/services/system-backup/import-data.ts");
  expect(
    classifyRestoreError(new Error("secret@example.com SQL password")),
  ).toMatchObject({ code: "RESTORE_FAILED", message: "系统数据恢复失败" });
  expect(classifyRestoreError({ code: "ENOSPC" })).toMatchObject({
    code: "INSUFFICIENT_STORAGE",
  });
  expect(classifyRestoreError({ code: "53100" })).toMatchObject({
    code: "INSUFFICIENT_STORAGE",
  });
  expect(
    classifyRestoreError({ code: "23505", detail: "secret" }),
  ).toMatchObject({ code: "INVALID_BACKUP" });
  expect(
    classifyRestoreError({ code: "22P02", detail: "secret" }),
  ).toMatchObject({ code: "INVALID_BACKUP" });
});

it("safe导入重新停用外部配置与表单，不沿用源S3默认后端", async () => {
  const { prepareImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  const datasets = orderedDatasets("safe");
  const form = datasets.find((d) => d.tableName === "intake_form")!;
  const row = {
    id: randomUUID(),
    is_active: true,
    submit_token_hash: "source-active-token",
  };
  const normalized = prepareImportRow(form, row, "safe");
  expect(normalized.is_active).toBe(false);
  expect(normalized.submit_token_hash).toMatch(/^disabled-migration:/);
  expect(
    prepareImportRow(
      datasets.find((d) => d.tableName === "idp_config")!,
      { enabled: true, client_secret_encrypted: null },
      "safe",
    ).enabled,
  ).toBe(false);
  expect(
    prepareImportRow(
      datasets.find((d) => d.tableName === "setting")!,
      { key: "storage.kind", value: "s3", is_secret: false },
      "safe",
    ).value,
  ).toBe("local");
});

it("附件与完整模式均已接通，safe源秘密仍不能被直接写入", async () => {
  const { assertImportCapability, prepareImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  const minimal = {
    mode: "safe",
    blobs: { count: 0 },
    datasets: [],
  } as unknown as import("../src/shared/schemas/system-backup.ts").SystemBackupManifest;
  expect(() => assertImportCapability(minimal)).not.toThrow();
  expect(() => assertImportCapability({ ...minimal, mode: "full" })).not.toThrow();
  expect(() =>
    assertImportCapability({
      ...minimal,
      blobs: { ...minimal.blobs, count: 1 },
    }),
  ).not.toThrow();
  const llm = orderedDatasets("safe").find((d) =>
    d.secretColumns.includes("api_key_encrypted"),
  )!;
  expect(() =>
    prepareImportRow(llm, { api_key_encrypted: "source-ciphertext" }, "safe"),
  ).toThrowError(expect.objectContaining({ code: "INCOMPATIBLE_BACKUP" }));
});

it("失败审计仅保留五类稳定分类，不将任意错误文本转成审计字段", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://unused@127.0.0.1:1/unused");
  const { sanitizeChanges } =
    await import("../src/server/services/audit.service.ts");
  expect(
    sanitizeChanges({
      errorCode: "RESTORE_FAILED",
      extra: "secret",
      error: "SQL password",
    }),
  ).toEqual({ errorCode: "RESTORE_FAILED" });
  expect(sanitizeChanges({ errorCode: "secret@example.test" })).toBeNull();
  vi.unstubAllEnvs();
});

it("导入可在事务提交前释放明文stage，避免提交后清理失败改变成功语义", async () => {
  const { mkdtemp, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { backupFixture, fixturePassword } =
    await import("./support/system-backup-fixture.ts");
  const { authenticateAndReadManifest, withAuthenticatedRestoreArchive } =
    await import("../src/server/services/system-backup/restore-archive.ts");
  const dir = await mkdtemp(join(tmpdir(), "restore-import-stage-"));
  let key: Buffer | undefined;
  try {
    const fixture = await backupFixture(dir);
    key = (await authenticateAndReadManifest(fixture.path, fixturePassword))
      .dataKey;
    await withAuthenticatedRestoreArchive(
      fixture.path,
      key,
      async (path, _manifest, release) => {
        await access(path);
        await release();
        await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
    expect(key.some((byte) => byte !== 0)).toBe(true);
  } finally {
    key?.fill(0);
    await rm(dir, { recursive: true, force: true });
  }
});
