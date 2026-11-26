#!/usr/bin/env node
/** Feronavi 备份：pg_dump(custom) + 附件 tar + manifest。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pgDumpCustom, sha256File, writeManifest } from "./lib/backup-tools.ts";
import { assertRegularTree } from "./lib/backup-archive.ts";

const args = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const databaseUrl = process.env.DATABASE_URL;
const dataDir = resolve(arg("data-dir", process.env.DATA_DIR ?? "/data")!);
const outRoot = resolve(arg("out", "./backups")!);
if (!databaseUrl) { console.error("缺少 DATABASE_URL"); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
assertRegularTree(dataDir);
if (outRoot === dataDir || outRoot.startsWith(`${dataDir}/`)) throw new Error("备份输出目录不能放在数据目录内");
mkdirSync(outRoot, { recursive: true });
const dir = mkdtempSync(join(outRoot, `.incomplete-${stamp}-`));
const finalDir = join(outRoot, `feronavi-backup-${stamp}-${dir.split("-").at(-1)}`);
try {
const dbFile = join(dir, "database.dump");
console.log(`[backup] pg_dump → ${dbFile}`);
pgDumpCustom(databaseUrl, dbFile);

const attachmentFile = join(dir, "attachments.tar.gz");
console.log(`[backup] attachments → ${attachmentFile}`);
execFileSync("tar", ["-czf", attachmentFile, "-C", dataDir, "."], { stdio: "pipe" });

const manifest = {
  format: "feronavi-backup/1",
  createdAt: new Date().toISOString(),
  database: new URL(databaseUrl).pathname.replace(/^\//, ""),
  dataDir,
  files: {
    database: { name: "database.dump", sha256: sha256File(dbFile), bytes: statSync(dbFile).size },
    ...(attachmentFile ? { attachments: { name: "attachments.tar.gz", sha256: sha256File(attachmentFile), bytes: statSync(attachmentFile).size } } : {}),
  },
};
writeManifest(dir, manifest);
writeFileSync(join(dir, "README.txt"), [
  "Feronavi 备份",
  `时间: ${manifest.createdAt}`,
  `数据库: ${manifest.database}`,
  "恢复: node --experimental-strip-types scripts/restore.ts --backup <dir> --target-database-url <url> --data-dir <dir>",
  "警告: 恢复前确认目标库不是当前生产库，并先做一次新备份。",
].join("\n"));
renameSync(dir, finalDir);
console.log(`[backup] 完成：${finalDir}`);
} catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
