import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 审计与活动自检（W3，数据模型 8.1 + 总纲 5.4） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, auditEntry, activityEntry, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as auditService from "../src/server/services/audit.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w3-admin", G = "w3-guest";
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w3a@x.test", name: "审计员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w3-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "w3g@x.test", name: "普通", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w3-password-1234") }).returning({ id: member.id });
const guest = (await loadActor(g!.id))!;

const KEY = "W3PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(admin, { key: KEY, name: "W3 项目" });

try {
  const wi = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "被审计的" });
  await wiService.updateWorkItem(admin, wi.id, { version: 1, priority: "HIGH" });
  const cur = await wiService.getWorkItem(admin, wi.id) as unknown as { version: number };
  const states = await sql<{ key: string; name: string }[]>`select key, name from workflow_state where workflow_id = (select workflow_id from work_item where id = ${wi.id}) order by sort_order`;
  try { await wiService.transitionWorkItem(admin, wi.id, { version: cur.version, toStateKey: states[1]!.key }); } catch { /* 边可能不允许 */ }

  // ── D4 审计只读：写入点产生了审计 ──
  const audits = await db.select().from(auditEntry).where(eq(auditEntry.targetType, "WORK_ITEM"));
  ok("工作项变更产生审计", audits.length >= 2, String(audits.length));
  ok("changes 只含白名单键",
    audits.every((x) => x.changes === null || Object.keys(x.changes as object).every((k) =>
      !["email", "name", "username", "title", "body", "password"].includes(k))),
    JSON.stringify(audits[0]?.changes));

  // ── D5 白名单反控：把 email 塞进 changes 应被拦 ──
  await auditService.writeAudit({
    actorId: a!.id, action: "t", targetType: "T",
    changes: { email: "hacker@x.test", priority: "LOW", title: "正文混入" },
    severity: "BUSINESS",
  });
  const last = (await db.select().from(auditEntry).orderBy(auditEntry.createdAt)).at(-1)!;
  const keys = Object.keys((last.changes ?? {}) as object);
  ok("email 被白名单剔除", !keys.includes("email"), JSON.stringify(keys));
  ok("title（正文类）被剔除", !keys.includes("title"), JSON.stringify(keys));
  ok("priority（白名单）保留", keys.includes("priority"), JSON.stringify(keys));

  // 长文本截断
  await auditService.writeAudit({
    actorId: a!.id, action: "t2", targetType: "T",
    changes: { priority: "x".repeat(500) }, severity: "BUSINESS",
  });
  const last2 = (await db.select().from(auditEntry).orderBy(auditEntry.createdAt)).at(-1)!;
  ok("超长值截断为占位", (last2.changes as Record<string, string>).priority === "<redacted>");

  // ── D6 活动时间线 ──
  const acts = await auditService.projectActivity(admin, projectId);
  ok("项目活动有记录", acts.total >= 2, String(acts.total));
  ok("summary 预渲染含 key 与目标列", acts.items.some((x) => x.summary.includes("W3PROJ-1")),
    acts.items.map((x) => x.summary).slice(0, 2).join(" | "));
  const mine = await auditService.recentActivity(admin);
  ok("个人最近活动有记录", mine.items.length >= 1, String(mine.items.length));

  // ── 越权：无 audit:read 权限读不到 ──
  let denied = false;
  try { await auditService.listAuditEntries(guest, {}); } catch { denied = true; }
  ok("无权限读审计被拒", denied);

  // ── RESTRICT：有审计的成员不可物理删（C-18）──
  let restricted = false;
  try { await db.delete(member).where(eq(member.id, a!.id)); } catch { restricted = true; }
  ok("有审计的成员物理删被 RESTRICT 拦", restricted);
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
