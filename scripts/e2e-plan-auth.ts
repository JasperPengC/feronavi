import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 计划实体创建自检（第十三期收口）：抽取服务后修掉的**授权缺口** + 计划写工具 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, milestone, iteration, release, module as moduleT, workItem, apiToken, idempotencyKey, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w13d-admin", MEMBERU = "w13d-member";
const KEY = "W13DPROJ", KEY2 = "W13D-B";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, MEMBERU]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13d-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "计划管理员"), m = await mk(MEMBERU, "项目成员");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
for (const k of [KEY, KEY2]) await db.delete(project).where(eq(project.key, k));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W13D 计划" });
const { id: pid2 } = await projectService.createProject(admin, { key: KEY2, name: "W13D 另一个" });
// 成员：PROJECT 档 MEMBER 角色（有项目可见性，但没有 *:manage 权限）
await db.insert(roleAssignment).values({ memberId: m.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid });
const memberActor = (await loadActor(m.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3979), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3979";

try {
  // ── 授权缺口：成员此前能建里程碑（内联实现无权限判定）──
  let memberDenied = false, code = "";
  try { await planningService.createPlan(memberActor, pid, "milestone", { name: "成员偷建的里程碑" }); }
  catch (e) { memberDenied = true; code = (e as { code?: string }).code ?? ""; }
  ok("**项目档成员建里程碑被拒**（此前的内联实现没有权限判定）", memberDenied && code === "FORBIDDEN", code);
  const count = await sql<{ n: number }[]>`select count(*)::int as n from milestone where project_id = ${pid}`;
  ok("库里确实没有落库（不是「先建后拒」）", count[0]!.n === 0, String(count[0]!.n));

  // ── 管理员按权限可建，四种类型都走同一服务 ──
  const ms = await planningService.createPlan(admin, pid, "milestone", { name: "M1", dueDate: "2026-12-01", progressMode: "MANUAL", progressValue: 10 });
  ok("管理员建里程碑成功", !!ms!.id);
  ok("numeric 进度按字符串落库（numeric 是 string 语义，标度为 10.00）", typeof (ms as { progressValue?: string }).progressValue === "string" && Number((ms as { progressValue?: string }).progressValue) === 10, String((ms as { progressValue?: string }).progressValue));
  let modeGuard = false;
  try { await planningService.createPlan(admin, pid, "milestone", { name: "模式不符", progressValue: 5 }); } catch (e) { modeGuard = (e as { code?: string }).code === "VALIDATION"; }
  ok("非 MANUAL 模式带进度值 → 可读的 VALIDATION（不是数据库原始错误）", modeGuard);
  const it = await planningService.createPlan(admin, pid, "iteration", { name: "迭代 1", startDate: "2026-12-01", endDate: "2026-12-14" });
  ok("建迭代成功并回填日期", !!it!.id && String((it as { startDate?: string }).startDate).startsWith("2026-12-01"));
  const rl = await planningService.createPlan(admin, pid, "release", { name: "v1.0" });
  const md = await planningService.createPlan(admin, pid, "module", { name: "前端" });
  ok("建版本与模块成功", !!rl!.id && !!md!.id);

  // ── 参数校验仍在（抽取后没丢）──
  let badInput = false;
  try { await planningService.createPlan(admin, pid, "iteration", { name: "缺日期" }); } catch (e) { badInput = (e as { code?: string }).code === "VALIDATION"; }
  ok("迭代缺起止日期 → VALIDATION（校验未丢）", badInput);

  // ── 模块父级必须同项目 ──
  const md2 = await planningService.createPlan(admin, pid2, "module", { name: "另一项目的模块" });
  let crossParent = false;
  try { await planningService.createPlan(admin, pid, "module", { name: "跨项目父子", parentId: md2!.id }); }
  catch (e) { crossParent = (e as { code?: string }).code === "VALIDATION"; }
  ok("父模块跨项目 → VALIDATION", crossParent);
  const child = await planningService.createPlan(admin, pid, "module", { name: "子模块", parentId: md!.id });
  ok("同项目父模块允许", !!child!.id);

  // ── MCP 计划写工具（经三重交集）──
  const rw = await tokenService.createToken(admin, { name: "读写", tier: "READ_WRITE" });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/v1/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${rw.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } }),
    });
    const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
    let data: Record<string, unknown> | null = null;
    try { data = JSON.parse(j.result?.content?.[0]?.text ?? "null"); } catch { /* 非 JSON */ }
    return { isError: j.result?.isError === true, data };
  };
  const listed = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${rw.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const names = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  ok("工具清单含四个计划创建工具", ["plan.createMilestone", "plan.createIteration", "plan.createRelease", "plan.createModule"].every((n) => names.includes(n)),
    String(names.length));
  const viaMcp = await call("plan.createMilestone", { projectId: pid, name: "MCP 建的里程碑", idempotencyKey: "ms-1" });
  ok("MCP plan.createMilestone 成功", !viaMcp.isError, JSON.stringify(viaMcp.data).slice(0, 80));
  const again = await call("plan.createMilestone", { projectId: pid, name: "MCP 建的里程碑", idempotencyKey: "ms-1" });
  ok("同幂等键重放（不重复创建）", (again.data as { replayed?: boolean })?.replayed === true, JSON.stringify(again.data).slice(0, 80));
  const msCount = await sql<{ n: number }[]>`select count(*)::int as n from milestone where project_id = ${pid}`;
  ok("里程碑共 2 条（管理员 1 + MCP 1），重放未新增", msCount[0]!.n === 2, String(msCount[0]!.n));
  // 项目档成员的令牌：写工具应被账号权限挡住（三重交集）
  const memberTok = await tokenService.createToken(memberActor, { name: "成员读写", tier: "READ_WRITE" });
  const deniedRes = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${memberTok.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "plan.createMilestone", arguments: { projectId: pid, name: "成员建的", userConfirmed: true } } }),
  });
  const deniedBody = (await deniedRes.json()) as { result?: { isError?: boolean; content?: { text: string }[] } };
  const deniedData = JSON.parse(deniedBody.result?.content?.[0]?.text ?? "{}");
  ok("成员令牌调计划写工具 → FORBIDDEN（账号权限 ∩ 档位）", deniedBody.result?.isError === true && deniedData.code === "FORBIDDEN",
    JSON.stringify(deniedData).slice(0, 70));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(idempotencyKey); await db.delete(apiToken);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  for (const id of [pid, pid2]) {
    await db.delete(milestone).where(eq(milestone.projectId, id));
    await db.delete(iteration).where(eq(iteration.projectId, id));
    await db.delete(release).where(eq(release.projectId, id));
    await db.delete(moduleT).where(eq(moduleT.projectId, id));
  }
  for (const k of [KEY, KEY2]) await db.delete(project).where(eq(project.key, k));
  for (const u of [ADMIN, MEMBERU]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
