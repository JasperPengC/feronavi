// @vitest-environment node
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { finalizeStagedPackage } from "../src/server/services/system-backup/publisher.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "system-backup-publisher-"));
  roots.push(root);
  const work = join(root, "work");
  const staged = join(root, "staged.fnbak");
  const destination = join(root, "published.fnbak");
  await (await import("node:fs/promises")).mkdir(work);
  await writeFile(staged, "complete encrypted package");
  return { root, work, staged, destination };
}

it("staging 文件 stat 失败时不会发布包", async () => {
  const paths = await fixture();
  const rename = vi.fn(async () => {});
  const operations = {
    stat: async () => {
      throw new Error("fixture stat failure");
    },
    rm: async () => {},
    rename,
  };
  await expect(
    finalizeStagedPackage(
      paths.staged,
      paths.destination,
      paths.work,
      operations,
    ),
  ).rejects.toThrow("fixture stat failure");
  expect(rename).not.toHaveBeenCalled();
  await expect(access(paths.destination)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("工作目录清理失败时不会发布包", async () => {
  const paths = await fixture();
  const rename = vi.fn(async () => {});
  const operations = {
    stat: async () => ({ size: 28 }),
    rm: async () => {
      throw new Error("fixture cleanup failure");
    },
    rename,
  };
  await expect(
    finalizeStagedPackage(
      paths.staged,
      paths.destination,
      paths.work,
      operations,
    ),
  ).rejects.toThrow("fixture cleanup failure");
  expect(rename).not.toHaveBeenCalled();
  await expect(access(paths.destination)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
