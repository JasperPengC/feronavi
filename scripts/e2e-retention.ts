import "./_env.ts";   // 环境预设必须最先加载
/**
 * 历史日志保留/清理自检（Round 25 长任务第 5 项）
 *
 * 规范 8.4：保留期可配置，默认 1 年（安全类）。此前 audit/activity 只增不减。
 * 本脚本用固定 now 注入验证边界，不依赖系统时间。
 */
import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry } from "../src/db/schema.ts";
import { pruneHistoricalLogs, retentionConfig } from "../src/server/services/retention.service.ts";
import { like } from "drizzle-orm";

const MARK = `retention-e2e-${Date.now()}`;
const DAY = 86_400_000;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const now = new Date("2026-10-22T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

async function seed() {
  await db.insert(auditEntry).values([
    { actorId: null, action: `${MARK}-audit-old`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(400) },
    { actorId: null, action: `${MARK}-audit-keep`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(1) },
    { actorId: null, action: `${MARK}-audit-mid`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(300) },
  ]);
  await db.insert(activityEntry).values([
    { projectId: null, actorId: null, targetType: "TEST", action: `${MARK}-act-old`, summary: `${MARK} old`, createdAt: daysAgo(400) },
    { projectId: null, actorId: null, targetType: "TEST", action: `${MARK}-act-keep`, summary: `${MARK} keep`, createdAt: daysAgo(1) },
  ]);
}
const countAudit = async () => (await db.select({ id: auditEntry.id }).from(auditEntry).where(like(auditEntry.action, `${MARK}%`))).length;
const countAct = async () => (await db.select({ id: activityEntry.id }).from(activityEntry).where(like(activityEntry.action, `${MARK}%`))).length;

try {
  // ① 边界：400 天前删除、300 天/1 天前保留（默认 365）
  await seed();
  const r1 = await pruneHistoricalLogs({ now, auditDays: 365, activityDays: 365 });
  ok("过期审计被清理（400 天前）", r1.auditDeleted === 1, String(r1.auditDeleted));
  ok("过期活动被清理（400 天前）", r1.activityDeleted === 1, String(r1.activityDeleted));
  ok("未过期审计保留（300 天前）", (await countAudit()) === 2, String(await countAudit()));
  ok("未过期活动保留（1 天前）", (await countAct()) === 1, String(await countAct()));

  // ② 关闭清理（0）不删任何行
  await db.insert(auditEntry).values({ actorId: null, action: `${MARK}-audit-disabled`, targetType: "TEST", severity: "SECURITY", createdAt: daysAgo(1000) });
  const r2 = await pruneHistoricalLogs({ now, auditDays: 0, activityDays: 0 });
  ok("保留期=0 时不清理", r2.auditDeleted === 0 && r2.activityDeleted === 0 && (await countAudit()) === 3, JSON.stringify(r2));

  // ③ 环境变量解析：合法 / 非法 / 0
  process.env.AUDIT_RETENTION_DAYS = "30";
  ok("环境变量可配置保留期", retentionConfig().auditDays === 30, JSON.stringify(retentionConfig()));
  process.env.AUDIT_RETENTION_DAYS = "abc";
  ok("非法值回落默认 365", retentionConfig().auditDays === 365);
  process.env.AUDIT_RETENTION_DAYS = "0";
  ok("0 保留（=关闭）被接受", retentionConfig().auditDays === 0);
  delete process.env.AUDIT_RETENTION_DAYS;
} finally {
  await db.delete(auditEntry).where(like(auditEntry.action, `${MARK}%`));
  await db.delete(activityEntry).where(like(activityEntry.action, `${MARK}%`));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
