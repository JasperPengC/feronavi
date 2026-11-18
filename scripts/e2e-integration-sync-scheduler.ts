import "./_env.ts";   // 环境预设必须最先加载
/**
 * 集成同步定时调度自检（Round 25 长任务第 39 项）：
 * 只调度"已启用且配置 repo"的集成；系统 actor 同步写 audit（actor 为空/快照=系统同步）；
 * 停止后不再发起请求；禁用/缺配置的集成不被请求。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, devActivityDaily, integration, member, role, roleAssignment, syncCursor } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as integrationService from "../src/server/services/integration.service.ts";
import { startIntegrationSyncScheduler } from "../src/server/services/integration-sync-scheduler.ts";
import { eq } from "drizzle-orm";

const ADMIN = "sched-int-admin";
const DEV = "sched-int-dev";
const PW = "sched-int-pass-123456";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, DEV]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "sched-int@x.test", name: "同步调度员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const [devRow] = await db.insert(member).values({
  username: DEV, email: "sched-int-dev@x.test", name: "同步开发者", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: devRow!.id, roleId: mr!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;

const active = await integrationService.createIntegration(admin, {
  kind: "GITHUB", name: "调度同步集成", baseUrl: "https://api.github.com", token: "ghp_sched",
  config: { repo: "acme/sched", userMap: { alice: DEV } },
});
await integrationService.createIntegration(admin, {
  kind: "GITLAB", name: "调度停用集成", baseUrl: "https://gitlab.com", token: "glpat_sched",
  config: { repo: "group/x", userMap: { bob: DEV } }, isActive: false,
});
await integrationService.createIntegration(admin, {
  kind: "GITEE", name: "调度缺配置集成", baseUrl: "https://gitee.com", token: "gitee_sched",
});

const requested: string[] = [];
const fake = (async (url: string | URL | Request) => {
  requested.push(String(url));
  return new Response(JSON.stringify([
    { sha: "s1", author: { login: "alice" }, commit: { author: { name: "Alice", date: "2026-10-23T01:00:00Z" } } },
  ]), { status: 200, headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
try {
  const handle = startIntegrationSyncScheduler({ intervalMs: 60, deps: { fetchImpl: fake } });
  let rows = await db.select().from(devActivityDaily).where(eq(devActivityDaily.memberId, devRow!.id));
  for (let i = 0; i < 80 && rows.length === 0; i++) { await sleep(50); rows = await db.select().from(devActivityDaily).where(eq(devActivityDaily.memberId, devRow!.id)); }
  handle.stop();
  ok("调度器触发同步并写入活跃度", rows.length === 1 && rows[0]!.commits === 1, JSON.stringify(rows));
  ok("只请求已启用且配置 repo 的集成（1 个）", requested.length >= 1 && requested.filter((u) => u.includes("acme/sched")).length >= 1
    && !requested.some((u) => u.includes("group/x")) && !requested.some((u) => u.includes("gitee")), JSON.stringify(requested));
  const cursor = (await db.select().from(syncCursor).where(eq(syncCursor.integrationId, active.id)))[0];
  ok("调度同步推进游标", cursor?.cursor === "2026-10-23T01:00:00.000Z", JSON.stringify(cursor));
  const audits = await db.select().from(auditEntry).where(eq(auditEntry.action, "integration.synced"));
  ok("系统同步写审计且 actor 为空/快照=系统同步",
    audits.length >= 1 && audits.every((a) => a.actorId === null && a.actorSnapshot === "系统同步"), JSON.stringify(audits.map((a) => a.actorSnapshot)));
  const callsAtStop = requested.length;
  await sleep(250);
  ok("停止后不再发起同步请求", requested.length === callsAtStop, `${callsAtStop} → ${requested.length}`);

  await db.delete(syncCursor);
  await db.delete(devActivityDaily).where(eq(devActivityDaily.memberId, devRow!.id));
} finally {
  await app.close();
  await db.delete(syncCursor);
  await db.delete(devActivityDaily).where(eq(devActivityDaily.memberId, devRow!.id));
  await db.delete(integration);
  await db.delete(auditEntry);
  for (const u of [ADMIN, DEV]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
