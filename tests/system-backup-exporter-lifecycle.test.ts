// @vitest-environment node
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function getWriteDatasetJsonl() {
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://feronavi_test:unused@127.0.0.1:5432/unused",
  );
  return (await import("../src/server/services/system-backup/exporter.ts"))
    .writeDatasetJsonl;
}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "system-backup-lifecycle-"));
  roots.push(root);
  return root;
}

const dataset = orderedDatasets("safe")[0]!;

it("JSONL 输出打开失败会拒绝未完成查询并返回可捕获错误", async () => {
  const root = await tempRoot();
  const output = join(root, "missing-parent", "data.jsonl");
  const tx = { execute: () => new Promise<never>(() => {}) };
  const writeDatasetJsonl = await getWriteDatasetJsonl();
  await expect(
    writeDatasetJsonl(tx as never, dataset, { mode: "safe", output }),
  ).rejects.toBeDefined();
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it("JSONL 批间查询失败会关闭流并删除半成品", async () => {
  const root = await tempRoot();
  const output = join(root, "data.jsonl");
  let queries = 0;
  const tx = {
    execute: async () => {
      queries++;
      if (queries === 1)
        return { rows: Array.from({ length: 500 }, () => ({})) };
      throw new Error("fixture query failure");
    },
  };
  const writeDatasetJsonl = await getWriteDatasetJsonl();
  await expect(
    writeDatasetJsonl(tx as never, dataset, { mode: "safe", output }),
  ).rejects.toThrow("fixture query failure");
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  expect(queries).toBe(2);
});
