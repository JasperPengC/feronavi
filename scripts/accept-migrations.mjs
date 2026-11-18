import "./_env.ts";
/** 空库迁移验收：建临时库 → 跑全部 drizzle 迁移 → 校验表/迁移数 → 删除临时库。 */
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { createSiblingTestDatabase } from "../tests/support/isolated-special.ts";
const DB = process.env.DATABASE_URL;
if (!DB) { console.error("缺少 DATABASE_URL"); process.exit(1); }
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
let target;
try {
  target = await createSiblingTestDatabase();
  execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { env: target.env, stdio: "pipe" });
  const s = postgres(target.url, { max: 1 });
  try {
    const tables = (await s`select count(*)::int n from information_schema.tables where table_schema='public'`)[0].n;
    const migrations = (await s`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n;
    const required = (await s`select table_name from information_schema.tables where table_schema='public' and table_name in ('automation_rule','sla_policy','work_item_sla','scim_token','idp_config')`).map((r) => r.table_name);
    check("空库迁移执行", tables > 80, `${tables} 表 / ${migrations} 迁移`);
    check("新表存在", required.length === 5, required.join(","));
    check("迁移记录完整", migrations >= 57, String(migrations));
  } finally { await s.end(); }
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
finally {
  await target?.cleanup();
}
const ok = checks.filter(Boolean).length;
console.log(`\n  迁移验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
