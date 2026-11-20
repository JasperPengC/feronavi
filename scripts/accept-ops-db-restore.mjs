import "./_env.ts";
/**
 * 可选运维数据库灾备验收（同构 PostgreSQL）：临时目标库 → 备份 → 恢复 → 校验 → 清理。
 * 产品系统迁移验收使用 accept-system-backup.mjs，不依赖 PostgreSQL CLI。
 * 依赖：隔离夹具、宿主 PATH 中的 pg_dump 和 pg_restore。
 */
import postgres from "postgres";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSiblingTestDatabase } from "../tests/support/isolated-special.ts";
const DB = process.env.DATABASE_URL;
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
if (!DB) { console.error("缺少 DATABASE_URL"); process.exit(1); }
for (const command of ["pg_dump", "pg_restore"]) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (probe.error?.code === "ENOENT") {
    console.log(`SKIP 缺少 ${command}，无法在当前宿主机执行备份恢复验收`);
    process.exit(77);
  }
}
const root = mkdtempSync(join(tmpdir(), "feronavi-backup-accept-"));
const sourceData = join(root, "data"); mkdirSync(join(sourceData, "attachments"), { recursive: true });
writeFileSync(join(sourceData, "attachments", "accept.txt"), "backup-accept\n");
let target;
try {
  target = await createSiblingTestDatabase();
  check("创建临时目标库", true, target.name);

  const out = join(root, "out");
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/backup.ts", "--out", out], {
    env: { ...process.env, DATABASE_URL: DB, DATA_DIR: sourceData },
    stdio: "pipe",
  });
  const folder = readdirSync(out, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.startsWith("feronavi-backup-"));
  const backupDir = folder ? join(out, folder.name) : undefined;
  check("备份生成", !!backupDir && !!readFileSync(join(backupDir, "manifest.json"), "utf8"), backupDir ?? "");
  const restoreOut = join(root, "restore");
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/restore.ts", "--backup", backupDir, "--data-dir", restoreOut], {
    env: { ...process.env, RESTORE_DATABASE_URL: target.url },
    stdio: "pipe",
  });
  check("附件恢复", readFileSync(join(restoreOut, "attachments", "accept.txt"), "utf8") === "backup-accept\n");

  const a = postgres(DB, { max: 1 }); const b = postgres(target.url, { max: 1 });
  try {
    for (const t of ["member", "project", "work_item", "page", "automation_rule", "sla_policy", "scim_token"]) {
      const x = (await a.unsafe(`select count(*)::int n from ${t}`))[0].n;
      const y = (await b.unsafe(`select count(*)::int n from ${t}`))[0].n;
      check(`恢复行数 ${t}`, x === y, `${x}/${y}`);
    }
  } finally { await a.end(); await b.end(); }
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  try { await target?.cleanup(); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const ok = checks.filter(Boolean).length;
console.log(`\n  备份/恢复验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
