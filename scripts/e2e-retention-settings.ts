import "./_env.ts";   // 环境预设必须最先加载
/**
 * 留存期设置自检（Round 25 长任务第 17 项）：
 * 管理员可在设置页配置审计/活动日志保留期（0–3650 整数，0 = 关闭清理）；
 * 生效顺序：显式环境变量 > setting > 默认 365；清理任务按生效值删除过期行。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, role, roleAssignment, setting } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { pruneHistoricalLogs, resolveRetentionConfig } from "../src/server/services/retention.service.ts";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const USER = "rset-admin";
const PW = "rset-pass-123456";
const DAY = 86_400_000;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
const marker = `retention-settings-${Date.now()}`;
const now = new Date("2026-10-22T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

await deleteTestMember(USER);
await db.delete(setting).where(inArray(setting.key, ["audit.retentionDays", "activity.retentionDays"]));
await db.delete(auditEntry);
await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: USER, email: "rset@x.test", name: "留存管理员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
try {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PW }),
  });
  const { csrfToken } = await login.json() as { csrfToken: string };
  const H = {
    cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json",
  };
  const getSettings = async () => (await (await fetch(`${BASE}/api/v1/settings`, { headers: { cookie: H.cookie } })).json()) as { settings: { key: string; value: unknown }[] };
  const put = (bodyledge: unknown) => fetch(`${BASE}/api/v1/settings`, { method: "PUT", headers: H, body: JSON.stringify(bodyledge) });

  // ① 保存合法值
  const saved = await put({ "audit.retentionDays": 30, "activity.retentionDays": 90 });
  ok("保存留存期 200", saved.status === 200, String(saved.status));
  const list = await getSettings();
  const byKey = (k: string) => list.settings.find((s) => s.key === k)?.value;
  ok("读取到保存的留存期", byKey("audit.retentionDays") === 30 && byKey("activity.retentionDays") === 90, JSON.stringify({ a: byKey("audit.retentionDays"), b: byKey("activity.retentionDays") }));

  // ② 校验：负数 / 超上限 / 非数字
  for (const bad of [{ "audit.retentionDays": -1 }, { "activity.retentionDays": 4000 }, { "audit.retentionDays": "abc" }]) {
    const r = await put(bad);
    ok(`非法留存期被拒：${JSON.stringify(bad)}`, r.status === 400, String(r.status));
  }

  // ③ 生效顺序：setting → resolveRetentionConfig
  const cfg = await resolveRetentionConfig();
  ok("生效值来自 setting", cfg.auditDays === 30 && cfg.activityDays === 90, JSON.stringify(cfg));

  // ④ 清理任务按 setting 值执行（注入固定 now，不显式传 days）
  await db.insert(auditEntry).values([
    { actorId: null, action: `${marker}-audit-old`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(40) },
    { actorId: null, action: `${marker}-audit-keep`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(10) },
  ]);
  await db.insert(activityEntry).values([
    { projectId: null, actorId: null, targetType: "TEST", action: `${marker}-act-old`, summary: "old", createdAt: daysAgo(100) },
    { projectId: null, actorId: null, targetType: "TEST", action: `${marker}-act-keep`, summary: "keep", createdAt: daysAgo(50) },
  ]);
  const r1 = await pruneHistoricalLogs({ now });
  ok("按 setting 值清理过期审计（30 天）", r1.auditDeleted === 1 && r1.auditDays === 30, JSON.stringify(r1));
  ok("按 setting 值清理过期活动（90 天）", r1.activityDeleted === 1 && r1.activityDays === 90, JSON.stringify(r1));

  // ⑤ 显式环境变量优先级高于 setting
  process.env.AUDIT_RETENTION_DAYS = "10";
  const cfgEnv = await resolveRetentionConfig();
  ok("环境变量优先于 setting", cfgEnv.auditDays === 10 && cfgEnv.activityDays === 90, JSON.stringify(cfgEnv));
  await db.insert(auditEntry).values({ actorId: null, action: `${marker}-audit-env`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(20) });
  const r2 = await pruneHistoricalLogs({ now });
  ok("环境变量生效值参与清理", r2.auditDeleted === 1 && r2.auditDays === 10, JSON.stringify(r2));
  delete process.env.AUDIT_RETENTION_DAYS;
} finally {
  await app.close();
  await db.delete(setting).where(inArray(setting.key, ["audit.retentionDays", "activity.retentionDays"]));
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await deleteTestMember(USER);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
