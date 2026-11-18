import "./_env.ts";
/**
 * 备份/恢复全自动验收：临时目标库 → 备份 → 恢复 → 行数/附件校验 → 清理。
 * 依赖：隔离夹具、PostgreSQL 工具（或显式 PG_CONTAINER）。
 */
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSiblingTestDatabase } from "../tests/support/isolated-special.ts";
const DB = process.env.DATABASE_URL;
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
if (!DB) { console.error("缺少 DATABASE_URL"); process.exit(1); }
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
