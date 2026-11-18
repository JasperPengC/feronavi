import "./_env.ts";   // 环境预设必须最先加载
/**
 * 知识检索日志自检（Round 25 长任务第 28 项，规范 9 节）：
 * 检索写日志（只存 query_hash，不落原文）、固定 30 天保留、运维状态计数、失败不阻断检索。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { createHash } from "node:crypto";
import { db, sql } from "../src/db/index.ts";
import { auditEntry, knowledgeQueryLog, member, project, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { pruneHistoricalLogs } from "../src/server/services/retention.service.ts";
import { operationsStatus } from "../src/server/services/ops-status.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "kql-admin";
const PW = "kql-pass-123456";
const SECRET_Q = "绝密查询词_不可落库_XQZ";
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(ADMIN);
await db.delete(knowledgeQueryLog);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "kql@x.test", name: "检索日志管理员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: `KQL${Date.now().toString(36).slice(-5).toUpperCase()}`, name: "检索日志项目" } as never);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
try {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: PW }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const search = await fetch(`${BASE}/api/v1/projects/${proj.id}/knowledge/search?q=${encodeURIComponent(SECRET_Q)}`, { headers: { cookie } });
  ok("检索端点 200（无 AI 时降级关键词）", search.status === 200, String(search.status));

  let rows = await db.select().from(knowledgeQueryLog);
  for (let i = 0; i < 40 && rows.length === 0; i++) { await sleep(50); rows = await db.select().from(knowledgeQueryLog); }
  const row = rows[0];
  const expectedHash = createHash("sha256").update(SECRET_Q).digest("hex");
  ok("检索写入日志（一行）", rows.length === 1 && !!row, String(rows.length));
  ok("只存 SHA-256 哈希、不落原文", row?.queryHash === expectedHash && !JSON.stringify(row).includes(SECRET_Q), row?.queryHash?.slice(0, 16));
  ok("日志带成员/项目/引用数/延迟", row?.memberId === adminRow!.id && row?.projectId === proj.id && row.citationCount === 0 && (row.latencyMs ?? -1) >= 0,
    JSON.stringify({ member: row?.memberId === adminRow!.id, project: row?.projectId === proj.id, citations: row?.citationCount, latency: row?.latencyMs }));

  // 保留期：固定 30 天（与审计/活动配置解耦）
  const now = new Date();
  await db.insert(knowledgeQueryLog).values([
    { memberId: adminRow!.id, projectId: proj.id, queryHash: "old", createdAt: new Date(now.getTime() - 40 * DAY) },
    { memberId: adminRow!.id, projectId: proj.id, queryHash: "recent", createdAt: new Date(now.getTime() - 1 * DAY) },
  ]);
  const pruned = await pruneHistoricalLogs({ now, auditDays: 365, activityDays: 365 });
  const left = await db.select({ h: knowledgeQueryLog.queryHash }).from(knowledgeQueryLog);
  ok("清理任务删除 30 天前的检索日志", pruned.knowledgeDeleted === 1 && !left.some((x) => x.h === "old"), JSON.stringify(pruned));
  ok("30 天内日志保留", left.some((x) => x.h === "recent") && left.some((x) => x.h === expectedHash));

  const ops = await operationsStatus(admin);
  ok("运维状态暴露近 30 天查询数", ops.knowledge.queries30d >= 2, String(ops.knowledge.queries30d));
} finally {
  await app.close();
  await db.delete(knowledgeQueryLog);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  await deleteTestMember(ADMIN);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
