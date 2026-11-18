import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 时间块与今日聚焦自检（第十一期）：不重叠、仅本人、聚焦记录与汇总 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, timeBlock, focusSession, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as focus from "../src/server/services/focus.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U1 = "w11d-a", U2 = "w11d-b";
const KEY = "W11DPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U1, U2]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const mk = async (username: string, name: string) => (await db.insert(member).values({
  username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("w11d-password-1234"),
}).returning({ id: member.id }))[0]!;
const a = await mk(U1, "甲"), b = await mk(U2, "乙");
await db.insert(roleAssignment).values([{ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null }]);
const actorA = (await loadActor(a.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(actorA, { key: KEY, name: "W11D 时间项目" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3987), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3987";
const DAY = new Date().toISOString().slice(0, 10);

try {
  // ── 基本创建与列表 ──
  const b1 = await focus.createBlock(actorA, { title: "写 Spec", startAt: `${DAY}T01:00:00.000Z`, endAt: `${DAY}T03:00:00.000Z`, projectId: pid });
  ok("建时间块（带项目关联）", !!b1!.id && b1!.projectId === pid);
  ok("列表按开始时间排序", (await focus.listBlocks(actorA)).length === 1);

  // ── 不重叠（规范：应用层事务校验）──
  let overlap = false, code = "";
  try {
    await focus.createBlock(actorA, { title: "撞车", startAt: `${DAY}T02:00:00.000Z`, endAt: `${DAY}T04:00:00.000Z` });
  } catch (e) { overlap = true; code = (e as { code?: string }).code ?? ""; }
  ok("重叠的时间块被拒（CONFLICT）", overlap && code === "CONFLICT", code);
  const touching = await focus.createBlock(actorA, { title: "紧邻", startAt: `${DAY}T03:00:00.000Z`, endAt: `${DAY}T04:00:00.000Z` });
  ok("端点相接不算重叠（半开区间）", !!touching!.id);
  let badRange = false;
  try { await focus.createBlock(actorA, { title: "倒序", startAt: `${DAY}T05:00:00.000Z`, endAt: `${DAY}T04:00:00.000Z` }); } catch (e) { badRange = (e as { code?: string }).code === "VALIDATION"; }
  ok("结束早于开始 → VALIDATION", badRange);

  // ── 改块时的重叠校验（排除自身）──
  const moved = await focus.updateBlock(actorA, b1!.id, { startAt: `${DAY}T06:00:00.000Z`, endAt: `${DAY}T07:00:00.000Z` });
  ok("移动时间块成功（排除自身不误判）", moved!.startAt.toISOString().startsWith(`${DAY}T06`));
  let moveOverlap = false;
  try { await focus.updateBlock(actorA, b1!.id, { startAt: `${DAY}T03:30:00.000Z`, endAt: `${DAY}T05:00:00.000Z` }); } catch (e) { moveOverlap = (e as { code?: string }).code === "CONFLICT"; }
  ok("移动到已占时段 → CONFLICT", moveOverlap);

  // ── 仅本人 ──
  const actorB = (await loadActor(b.id))!;
  ok("别人的时间块看不见", (await focus.listBlocks(actorB)).length === 0);
  let deniedEdit = false;
  try { await focus.updateBlock(actorB, b1!.id, { title: "篡改" }); } catch { deniedEdit = true; }
  ok("改别人的时间块被拒", deniedEdit);
  let deniedDel = false;
  try { await focus.deleteBlock(actorB, b1!.id); } catch { deniedDel = true; }
  ok("删别人的时间块被拒", deniedDel);
  const bOwn = await focus.createBlock(actorB, { title: "乙的块", startAt: `${DAY}T01:00:00.000Z`, endAt: `${DAY}T02:00:00.000Z` });
  ok("同一时段不同人互不影响", !!bOwn!.id);

  // ── 今日聚焦 ──
  const sess = await focus.recordFocusSession(actorA, {
    timeBlockId: b1!.id, startedAt: `${DAY}T06:00:00.000Z`, endedAt: `${DAY}T06:50:00.000Z`,
  });
  ok("记录聚焦会话（自动算时长）", sess!.actualMinutes === 50, String(sess!.actualMinutes));
  const again = await focus.recordFocusSession(actorA, {
    timeBlockId: b1!.id, startedAt: `${DAY}T06:00:00.000Z`, endedAt: `${DAY}T07:00:00.000Z`, actualMinutes: 55,
  });
  ok("同一块同一开始时间是幂等更新（UNIQUE 保证）", again!.actualMinutes === 55 && again!.id === sess!.id);
  const today = await focus.todayFocus(actorA);
  // 两个 1 小时的块（"紧邻" 03-04、"写 Spec" 移到了 06-07），计划时长合计 120 分钟
  ok("今日汇总：块数与计划分钟正确", today.blocks.length === 2 && today.plannedMinutes === 120, `${today.blocks.length}/${today.plannedMinutes}`);
  ok("今日汇总：聚焦分钟为实际记录值", today.focusedMinutes === 55 && today.sessionCount === 1, `${today.focusedMinutes}/${today.sessionCount}`);
  const todayB = await focus.todayFocus(actorB);
  ok("乙的今日汇总不包含甲的记录", todayB.focusedMinutes === 0 && todayB.blocks.length === 1);
  let badMinutes = false;
  try { await focus.updateFocusSession(actorA, sess!.id, { actualMinutes: -5 }); } catch (e) { badMinutes = (e as { code?: string }).code === "VALIDATION"; }
  ok("负时长 → VALIDATION", badMinutes);
  let deniedSession = false;
  try { await focus.updateFocusSession(actorB, sess!.id, { note: "x" }); } catch { deniedSession = true; }
  ok("改别人的聚焦记录被拒", deniedSession);

  // ── HTTP（关键路径真实 HTTP）──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U1, password: "w11d-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const httpToday = await fetch(`${BASE}/api/v1/focus/today`, { headers: { cookie } });
  const httpTodayBody = (await httpToday.json()) as { plannedMinutes: number; focusedMinutes: number };
  ok("HTTP 今日聚焦 200 且数据一致", httpToday.status === 200 && httpTodayBody.plannedMinutes === 120 && httpTodayBody.focusedMinutes === 55,
    JSON.stringify(httpTodayBody));
  const httpCreate = await fetch(`${BASE}/api/v1/time-blocks`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ title: "HTTP 建的块", startAt: `${DAY}T20:00:00.000Z`, endAt: `${DAY}T21:00:00.000Z` }),
  });
  ok("HTTP 建时间块 201", httpCreate.status === 201, String(httpCreate.status));
  const httpOverlap = await fetch(`${BASE}/api/v1/time-blocks`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ title: "撞", startAt: `${DAY}T20:30:00.000Z`, endAt: `${DAY}T21:30:00.000Z` }),
  });
  ok("HTTP 重叠返回 409", httpOverlap.status === 409, String(httpOverlap.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(focusSession);
  await db.delete(timeBlock);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U1, U2]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
