import "./_env.ts";
/** 运维验收：健康检查 + 告警脚本 + SLA 暂停列存在。 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
const BASE = process.env.BASE;
if (!process.env.DATABASE_URL) { console.error("缺少 DATABASE_URL"); process.exit(1); }
const checks = [];
const check = (n, ok, d = "") => { checks.push(!!ok); console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
try {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
  const body = await res.json();
  check("GET /health 返回 200", res.status === 200, String(res.status));
  check("健康检查报告数据库", body.ok === true && body.database === "ok", JSON.stringify(body));
  try {
    execFileSync(process.execPath, ["scripts/health-alert.mjs"], { env: { ...process.env, HEALTH_URL: `${BASE}/health` }, stdio: "pipe" });
    check("告警脚本在健康时退出 0", true);
  } catch { check("告警脚本在健康时退出 0", false); }
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const cols = (await sql`select column_name from information_schema.columns where table_name='work_item_sla'`).map((r) => r.column_name);
    check("SLA 暂停字段已迁移", cols.includes("paused_at") && cols.includes("paused_ms"), cols.filter((c) => c.startsWith("paused")).join(","));
    const locks = await sql`select pg_try_advisory_lock(742002) as ok`;
    await sql`select pg_advisory_unlock(742002)`;
    check("PostgreSQL advisory lock 可用", locks[0]?.ok === true);
  } finally { await sql.end(); }
} catch (e) { console.error("  ❌", e?.message ?? e); checks.push(false); }
const ok = checks.filter(Boolean).length;
console.log(`\n  运维验收 ${ok}/${checks.length}`);
process.exit(ok === checks.length ? 0 : 1);
