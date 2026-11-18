#!/usr/bin/env node
/** Feronavi 恢复：校验 manifest → pg_restore → 解压附件。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pgRestoreCustom, readManifest, sha256File } from "./lib/backup-tools.ts";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const backupDir = arg("backup");
const target = arg("target-database-url") ?? process.env.RESTORE_DATABASE_URL;
const dataDir = arg("data-dir") ?? process.env.DATA_DIR;
if (!backupDir) { console.error("用法: restore.ts --backup <dir> --target-database-url <url> [--data-dir <dir>] [--force]"); process.exit(1); }
if (!target) { console.error("缺少 --target-database-url（拒绝猜测目标库）"); process.exit(1); }
if (process.env.DATABASE_URL && target === process.env.DATABASE_URL) {
  console.error("拒绝恢复到当前 DATABASE_URL；请显式指定另一个库（或先切换环境）"); process.exit(1);
}
const dir = resolve(backupDir);
const manifest = readManifest(dir) as { files?: Record<string, { name: string; sha256: string }> };
const dbMeta = manifest.files?.database;
if (!dbMeta) { console.error("manifest 缺少 database"); process.exit(1); }
const dbFile = join(dir, dbMeta.name);
if (sha256File(dbFile) !== dbMeta.sha256) { console.error("database.dump 校验和不匹配"); process.exit(1); }
// 非空库检查：交给 pg_restore --clean；这里只提示
console.log(`[restore] pg_restore → ${new URL(target).hostname}${new URL(target).pathname}`);
pgRestoreCustom(target, dbFile);

if (manifest.files?.attachments && dataDir) {
  const att = join(dir, manifest.files.attachments.name);
  if (sha256File(att) !== manifest.files.attachments.sha256) { console.error("attachments 校验和不匹配"); process.exit(1); }
  mkdirSync(dataDir, { recursive: true });
  console.log(`[restore] 附件 → ${dataDir}`);
  execFileSync("tar", ["-xzf", att, "-C", dataDir], { stdio: "pipe" });
}
void statSync;
console.log("[restore] 完成。请启动服务并执行冒烟检查。");
