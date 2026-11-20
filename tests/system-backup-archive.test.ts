// @vitest-environment node
import { createWriteStream } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it } from "vitest";
import {
  openOuterArchive,
  validateArchiveEntries,
  writeOuterArchive,
} from "../src/server/services/system-backup/archive.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "system-backup-archive-"));
  roots.push(root);
  return root;
}

async function makeZip(
  entries: Array<{
    name: string;
    data?: string;
    mode?: number;
    declaredSize?: number;
  }>,
) {
  const root = await tempRoot();
  const path = join(root, "fixture.zip");
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.data ?? "x");
    const compressed = deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(path);
    stream.on("error", reject);
    stream.on("close", resolve);
    stream.end(Buffer.concat([...localParts, centralDirectory, end]));
  });
  return path;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

it("外层 ZIP 只允许 header.json 和 payload.enc", async () => {
  const root = await tempRoot();
  const path = join(root, "outer.zip");
  await writeOuterArchive(path, Buffer.from("{}"), Buffer.from("encrypted"));
  const outer = await openOuterArchive(path);
  expect(await readFile(outer.headerPath, "utf8")).toBe("{}");
  await outer.cleanup();
  await expect(
    validateArchiveEntries(
      await makeZip([
        { name: "header.json" },
        { name: "payload.enc" },
        { name: "extra.txt" },
      ]),
      "outer",
    ),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});

it("外层 ZIP 支持 Writable 输出目标", async () => {
  const root = await tempRoot();
  const path = join(root, "outer-stream.zip");
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await writeOuterArchive(output, Buffer.from("{}"), Buffer.from("encrypted"));
  await writeFile(path, Buffer.concat(chunks));
  const outer = await openOuterArchive(path);
  expect(await readFile(outer.headerPath, "utf8")).toBe("{}");
  await outer.cleanup();
});

it.each([
  ["路径穿越", [{ name: "../escape" }]],
  ["绝对路径", [{ name: "/etc/passwd" }]],
  ["重复文件", [{ name: "manifest.json" }, { name: "manifest.json" }]],
  ["符号链接", [{ name: "data/items.jsonl", mode: 0o120777 }]],
  ["超长路径", [{ name: "a".repeat(241) + ".jsonl" }]],
])("内层归档拒绝%s", async (_name, entries) => {
  const path = await makeZip(
    entries as Array<{ name: string; data?: string; mode?: number }>,
  );
  await expect(
    validateArchiveEntries(path, "inner", { maxFiles: 200000 }),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});

it("超过文件数限制会被拒绝", async () => {
  const path = await makeZip([
    { name: "manifest.json" },
    { name: "data/a.jsonl" },
  ]);
  await expect(
    validateArchiveEntries(path, "inner", { maxFiles: 1 }),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});

it("ZIP 声明展开大小与实际流不符时拒绝", async () => {
  const path = await makeZip([
    { name: "manifest.json", data: "{}", declaredSize: 99 },
  ]);
  await expect(validateArchiveEntries(path, "inner")).rejects.toMatchObject({
    code: "INVALID_BACKUP",
  });
});

it("压缩比超过上限时拒绝", async () => {
  const path = await makeZip([
    { name: "manifest.json", data: "x".repeat(1000) },
  ]);
  await expect(
    validateArchiveEntries(path, "inner", { maxCompressionRatio: 2 }),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});
