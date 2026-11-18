import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 想法与投票自检（第十一期）：收集→投票→转工作项 闭环 + score 口径 + 权限 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, idea, ideaVote, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference, metricSnapshot, dashboard, dashboardWidget, milestone, iteration, release, module as moduleT } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as ideaService from "../src/server/services/idea.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, and } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w11-admin", V1 = "w11-voter1", V2 = "w11-voter2", G = "w11-outsider";
const KEY = "W11PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, V1, V2, G]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string) => (await db.insert(member).values({
  username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("w11-password-1234"),
}).returning({ id: member.id }))[0]!;

const a = await mk(U, "想法管理员");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
const v1 = await mk(V1, "投票人一"), v2 = await mk(V2, "投票人二"), g = await mk(G, "无权者");
const outsider = (await loadActor(g.id))!;

await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W11 想法项目" });
// 投票人：项目档 MEMBER
for (const m of [v1, v2]) await db.insert(roleAssignment).values({ memberId: m.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid });
const voter1 = (await loadActor(v1.id))!;
const voter2 = (await loadActor(v2.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3989), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3989";

try {
  // ── 提交 ──
  const i1 = await ideaService.createIdea(voter1, pid, { title: "支持导出 Excel", description: "财务要" });
  ok("提交想法（状态 NEW）", i1!.status === "NEW" && i1!.score === "0.00", `${i1!.status}/${i1!.score}`);
  ok("提交者被记录", i1!.submittedByMemberId === v1.id);
  const ext = await ideaService.createIdea(admin, pid, { title: "外部客户提的", submitterDisplay: "客户 A" });
  ok("可记录外部提交者（无账号）", ext!.submittedByMemberId !== null && ext!.submitterDisplay === "客户 A");

  // ── 投票与 score 重算（真相源是 idea_vote）──
  const r1 = await ideaService.vote(voter1, i1!.id, 3);
  ok("投票后 score = 权重和", r1.score === "3.00", r1.score);
  const r2 = await ideaService.vote(voter2, i1!.id, 1);
  ok("第二人投票累加", r2.score === "4.00", r2.score);
  const r3 = await ideaService.vote(voter1, i1!.id, 5);      // 改票（天然幂等）
  ok("重复投票是改权重而非新增", r3.score === "6.00", r3.score);
  const votes = await db.select().from(ideaVote).where(eq(ideaVote.ideaId, i1!.id));
  ok("一人一票（PK 保证）", votes.length === 2, String(votes.length));
  let badWeight = false;
  try { await ideaService.vote(voter1, i1!.id, 9); } catch (e) { badWeight = (e as { code?: string }).code === "VALIDATION"; }
  ok("权重越界 → VALIDATION", badWeight);
  const down = await ideaService.vote(voter2, i1!.id, -1);
  ok("可投反对票（权重 -1）", down.score === "4.00", down.score);
  await ideaService.unvote(voter2, i1!.id);
  ok("撤票后重算", (await ideaService.getIdea(admin, i1!.id)).score === "5.00", (await ideaService.getIdea(admin, i1!.id)).score);

  // ── score 是对账可修正的缓存（规范：每日对账）──
  await sql`update idea set score = 999 where id = ${i1!.id}`;   // 故意写坏缓存
  const rec = await ideaService.reconcileScores();
  ok("对账修正被写坏的 score", rec.fixed >= 1 && (await ideaService.getIdea(admin, i1!.id)).score === "5.00",
    `fixed=${rec.fixed} score=${(await ideaService.getIdea(admin, i1!.id)).score}`);

  // ── 排序：按 score 高到低 ──
  const list = await ideaService.listIdeas(admin, pid);
  ok("列表按热度排序（score 降序）", list.items[0]!.id === i1!.id, list.items.map((i) => `${i.title}:${i.score}`).join(" | "));

  // ── 转工作项（单事务 + 幂等）──
  const p1 = await ideaService.promote(admin, i1!.id, { type: "REQUIREMENT" });
  ok("转工作项成功并回填", !!p1.workItem && !p1.alreadyPromoted);
  const after = await ideaService.getIdea(admin, i1!.id);
  ok("回填 promoted_work_item_id", after.promotedWorkItemId === p1.workItem!.id);
  ok("状态自动置 PLANNED", after.status === "PLANNED", after.status);
  const p2 = await ideaService.promote(admin, i1!.id, {});
  ok("重复转是幂等的（不重复创建）", p2.alreadyPromoted === true && p2.workItem!.id === p1.workItem!.id);
  // ⚠️ 这里的 sql 是 postgres.js：不能当 drizzle 字段传进 select({...})（会无限递归，第六次踩）
  const items = await sql<{ n: number }[]>`select count(*)::int as n from work_item where project_id = ${pid}`;
  ok("工作项只创建了一个", items[0]!.n === 1, String(items[0]!.n));
  // 第 33 项起，想法创建本身也会写活动（idea.created）——这里只断言**转化**那一条
  const acts = await db.select().from(activityEntry).where(and(eq(activityEntry.targetType, "IDEA"), eq(activityEntry.targetId, i1!.id)));
  const promotedActs = acts.filter((a) => a.action === "idea.promoted");
  ok("转工作项写了活动（时间线可见）", promotedActs.length === 1 && /转成了工作项/.test(promotedActs[0]!.summary ?? ""), JSON.stringify(acts.map((a) => a.action)));

  // ── 状态流转与列表过滤 ──
  await ideaService.updateIdea(admin, ext!.id, { status: "REJECTED" });
  const rejected = await ideaService.listIdeas(admin, pid, { status: "REJECTED" });
  ok("按状态过滤", rejected.items.length === 1 && rejected.items[0]!.id === ext!.id, String(rejected.items.length));
  let badStatus = false;
  try { await ideaService.updateIdea(admin, ext!.id, { status: "NOPE" }); } catch (e) { badStatus = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法状态 → VALIDATION", badStatus);
  let badFilter = false;
  try { await ideaService.listIdeas(admin, pid, { status: "NOPE" }); } catch (e) { badFilter = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法过滤值 → VALIDATION", badFilter);

  // ── 软删 ──
  await ideaService.deleteIdea(admin, ext!.id);
  ok("软删后不出现在列表", (await ideaService.listIdeas(admin, pid)).items.length === 1);

  // ── 权限与数据范围 ──
  let deniedSubmit = false;
  try { await ideaService.createIdea(outsider, pid, { title: "x" }); } catch { deniedSubmit = true; }
  ok("无数据范围者不能提交", deniedSubmit);
  let deniedPromote = false;
  try { await ideaService.promote(voter1, i1!.id, {}); } catch { deniedPromote = true; }
  ok("无 idea:manage 者不能转工作项", deniedPromote);

  // ── HTTP 端点（关键路径真实 HTTP）──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w11-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const httpList = await fetch(`${BASE}/api/v1/projects/${pid}/ideas`, { headers: { cookie } });
  ok("HTTP 想法列表 200", httpList.status === 200, String(httpList.status));
  const httpVote = await fetch(`${BASE}/api/v1/ideas/${i1!.id}/vote`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ weight: 2 }),
  });
  // ⚠️ 响应体只能读一次：先读进变量再用（重复读会抛 Body is unusable）
  const voteBody = (await httpVote.json()) as { score?: string };
  // 管理员此前没投过票：投票人一的 5 + 管理员的 2 = 7（投票是累加的）
  ok("HTTP 投票成功且 score 重算为累计值", httpVote.status === 200 && voteBody.score === "7.00", JSON.stringify(voteBody));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(ideaVote);
  await db.delete(idea);
  await db.delete(dashboardWidget); await db.delete(dashboard); await db.delete(metricSnapshot);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(milestone); await db.delete(iteration); await db.delete(release); await db.delete(moduleT);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, V1, V2, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
