#!/usr/bin/env node
/** Feronavi 恢复：校验 manifest → pg_restore → 解压附件。 */
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { containerUrl, pgRestoreCustom } from "./lib/backup-tools.ts";
import { prepareRestore } from "./lib/backup-archive.ts";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const backupDir = arg("backup");
const target = arg("target-database-url") ?? process.env.RESTORE_DATABASE_URL;
const dataDir = arg("data-dir") ?? process.env.DATA_DIR;
if (!backupDir) { console.error("用法: restore.ts --backup <dir> --target-database-url <url> [--data-dir <dir>] [--force]"); process.exit(1); }
if (!target) { console.error("缺少 --target-database-url（拒绝猜测目标库）"); process.exit(1); }
function databaseIdentity(value: string): string {
  const url = new URL(process.env.PG_CONTAINER ? containerUrl(value) : value);
  const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname;
  return `${host}:${url.port || "5432"}/${decodeURIComponent(url.pathname)}`;
}
if (process.env.DATABASE_URL && databaseIdentity(target) === databaseIdentity(process.env.DATABASE_URL)) {
  console.error("拒绝恢复到当前 DATABASE_URL；请显式指定另一个库（或先切换环境）"); process.exit(1);
}
const prepared = prepareRestore(resolve(backupDir), dataDir, args.includes("--force"));
let databaseRestored = false;
try {
  console.log(`[restore] 备份完整性预检通过；pg_restore → ${new URL(target).hostname}${new URL(target).pathname}`);
  pgRestoreCustom(target, prepared.database);
  databaseRestored = true;
  if (prepared.stage && prepared.destination) {
    const previous = `${prepared.destination}.before-restore-${randomUUID()}`;
    const hadPrevious = existsSync(prepared.destination);
    if (hadPrevious) renameSync(prepared.destination, previous);
    try { renameSync(prepared.stage, prepared.destination); }
    catch (error) {
      if (hadPrevious) renameSync(previous, prepared.destination);
      throw error;
    }
    if (hadPrevious) console.log(`[restore] 原数据目录保留在 ${previous}`);
    console.log(`[restore] 附件与主密钥 → ${prepared.destination}`);
  }
} catch (error) {
  if (prepared.stage && !databaseRestored) rmSync(prepared.stage, { recursive: true, force: true });
  if (databaseRestored && prepared.stage) console.error(`[restore] 数据库已恢复，但目录切换失败；请勿启动服务。已验证数据保留在 ${prepared.stage}，修复目录权限后完成切换。`);
  throw error;
}
console.log("[restore] 完成。请启动服务并执行冒烟检查。");
