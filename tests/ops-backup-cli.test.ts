// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "feronavi-ops-cli-")); roots.push(root);
  const backup = join(root, "backup"), data = join(root, "data"), destination = join(root, "restored");
  mkdirSync(backup); mkdirSync(data);
  writeFileSync(join(data, "master.key"), "original-encryption-key", { mode: 0o600 });
  writeFileSync(join(backup, "database.dump"), "fixture-database");
  execFileSync("tar", ["-czf", join(backup, "attachments.tar.gz"), "-C", data, "."]);
  const manifest = { format: "feronavi-backup/1", files: {
    database: { name: "database.dump", sha256: hash(join(backup, "database.dump")) },
    attachments: { name: "attachments.tar.gz", sha256: hash(join(backup, "attachments.tar.gz")) },
  } };
  const save = () => writeFileSync(join(backup, "manifest.json"), JSON.stringify(manifest)); save();
  const marker = join(root, "database-command");
  const pg = join(root, "pg-tool");
  writeFileSync(pg, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2))+'\\n');\nif(process.env.TEST_RESTORE_FAIL==='1') process.exit(42); process.stdout.write('fixture-database');\n`, { mode: 0o700 });
  const env = { ...process.env, PG_CONTAINER: "", PG_RESTORE_BIN: pg, PG_DUMP_BIN: pg, DATABASE_URL: "postgres://test@127.0.0.1/source", RESTORE_DATABASE_URL: "postgres://test@127.0.0.1/target", DATA_DIR: destination, TEST_RESTORE_FAIL: "0" };
  const run = (...args: string[]) => spawnSync(process.execPath, args, { cwd: resolve(import.meta.dirname, ".."), env, encoding: "utf8" });
  return { root, backup, data, destination, marker, manifest, save, env, run };
}

it("附件校验失败时不执行数据库恢复", () => {
  const f = fixture(); writeFileSync(join(f.backup, "attachments.tar.gz"), "corrupt");
  const r = f.run("scripts/restore.ts", "--backup", f.backup);
  expect(r.status).not.toBe(0); expect(r.stderr).toMatch(/校验和/);
  expect(existsSync(f.marker)).toBe(false);
});
it("哈希匹配但不是有效tar时不执行数据库恢复", () => {
  const f = fixture(); writeFileSync(join(f.backup, "attachments.tar.gz"), "not-a-tar");
  f.manifest.files.attachments.sha256 = hash(join(f.backup, "attachments.tar.gz")); f.save();
  expect(f.run("scripts/restore.ts", "--backup", f.backup).status).not.toBe(0);
  expect(existsSync(f.marker)).toBe(false);
});
it("含附件的备份不能静默省略数据目录", () => {
  const f = fixture(); delete (f.env as Partial<typeof f.env>).DATA_DIR;
  expect(f.run("scripts/restore.ts", "--backup", f.backup).status).not.toBe(0);
  expect(existsSync(f.marker)).toBe(false);
});
it("清单不能引用备份目录外的文件", () => {
  const f = fixture(); writeFileSync(join(f.root, "outside.dump"), "fixture-database");
  f.manifest.files.database.name = "../outside.dump"; f.save();
  expect(f.run("scripts/restore.ts", "--backup", f.backup).status).not.toBe(0);
  expect(existsSync(f.marker)).toBe(false);
});
it("相同数据库不能通过不同凭据和查询参数绕过来源保护", () => {
  const f = fixture(); f.env.RESTORE_DATABASE_URL = "postgresql://other:password@localhost:5432/source?application_name=restore";
  const r = f.run("scripts/restore.ts", "--backup", f.backup);
  expect(r.status).not.toBe(0); expect(existsSync(f.marker)).toBe(false);
});
it("归档中的符号链接不能在恢复时访问目录外内容", () => {
  const f = fixture(); symlinkSync(f.root, join(f.data, "outside"));
  execFileSync("tar", ["-czf", join(f.backup, "attachments.tar.gz"), "-C", f.data, "."]);
  f.manifest.files.attachments.sha256 = hash(join(f.backup, "attachments.tar.gz")); f.save();
  expect(f.run("scripts/restore.ts", "--backup", f.backup).status).not.toBe(0);
  expect(existsSync(f.marker)).toBe(false);
});
it("未知备份格式在恢复前拒绝", () => {
  const f = fixture(); f.manifest.format = "another-backup/1"; f.save();
  expect(f.run("scripts/restore.ts", "--backup", f.backup).status).not.toBe(0);
  expect(existsSync(f.marker)).toBe(false);
});
it("非空数据目录默认拒绝覆盖，保留原密钥", () => {
  const f = fixture(); mkdirSync(f.destination);
  writeFileSync(join(f.destination, "master.key"), "current-key");
  const r = f.run("scripts/restore.ts", "--backup", f.backup);
  expect(r.status).not.toBe(0); expect(r.stderr).toContain("恢复目录非空");
  expect(existsSync(f.marker)).toBe(false);
  expect(readFileSync(join(f.destination, "master.key"), "utf8")).toBe("current-key");
});
it("恢复前完整读取归档，数据库使用事务且附件和密钥随后可用", () => {
  const f = fixture(); const r = f.run("scripts/restore.ts", "--backup", f.backup);
  expect(r.status, r.stderr).toBe(0);
  expect(readFileSync(f.marker, "utf8")).toContain("--single-transaction");
  expect(readFileSync(join(f.destination, "master.key"), "utf8")).toBe("original-encryption-key");
});
it("数据库恢复失败时保留原目录并清理暂存目录", () => {
  const f = fixture(); f.env.TEST_RESTORE_FAIL = "1"; mkdirSync(f.destination);
  writeFileSync(join(f.destination, "master.key"), "current-key");
  expect(f.run("scripts/restore.ts", "--backup", f.backup, "--force").status).not.toBe(0);
  expect(readFileSync(join(f.destination, "master.key"), "utf8")).toBe("current-key");
  expect(readdirSync(f.root).some(name => name.startsWith(".feronavi-restore-"))).toBe(false);
});
it("显式替换数据目录时保留旧副本且不混入陈旧文件", () => {
  const f = fixture(); mkdirSync(f.destination); writeFileSync(join(f.destination, "stale.txt"), "old");
  const r = f.run("scripts/restore.ts", "--backup", f.backup, "--force");
  expect(r.status, r.stderr).toBe(0);
  expect(existsSync(join(f.destination, "stale.txt"))).toBe(false);
  const old = readdirSync(f.root).find(name => name.startsWith("restored.before-restore-"));
  expect(old).toBeTruthy(); expect(readFileSync(join(f.root, old!, "stale.txt"), "utf8")).toBe("old");
});
it("完整备份要求数据目录存在，防止静默漏掉附件和主密钥", () => {
  const f = fixture(); f.env.DATA_DIR = join(f.root, "missing");
  expect(f.run("scripts/backup.ts", "--out", join(f.root, "out")).status).not.toBe(0);
  expect(existsSync(f.marker)).toBe(false);
});
it("附件打包失败不能生成可用的备份清单", () => {
  const f = fixture(); f.env.DATA_DIR = f.data;
  const bin = join(f.root, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "tar"), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[3], 'incomplete archive'); process.exit(42);\n`, { mode: 0o700 });
  f.env.PATH = `${bin}:${process.env.PATH}`;
  const r = f.run("scripts/backup.ts", "--out", join(f.root, "out"));
  expect(r.status).not.toBe(0); expect(r.stdout).not.toContain("[backup] 完成");
});
