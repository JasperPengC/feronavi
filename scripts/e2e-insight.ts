import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 洞察自检（第十期，判据）：燃尽 / 累积流 / 仪表盘 / 快照写入口 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, iteration, milestone, release, module as moduleT, metricSnapshot, dashboard, dashboardWidget, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference, customFieldDef, customFieldValue, importBatch, importMapping } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as insightService from "../src/server/services/insight.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, and } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w10-admin", G = "w10-outsider";
const KEY = "W10PROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w10@x.test", name: "洞察管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w10-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "w10g@x.test", name: "无权者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w10-password-1234") }).returning({ id: member.id });
const outsider = (await loadActor(g!.id))!;

await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W10 洞察项目" });
// 迭代：起止日期固定，便于断言逐日序列
const today = new Date();
const start = new Date(today.getTime() - 4 * 86400_000).toISOString().slice(0, 10);
const end = new Date(today.getTime() + 2 * 86400_000).toISOString().slice(0, 10);
const [it] = await db.insert(iteration).values({ projectId: pid, name: "迭代 1", startDate: start, endDate: end }).returning();

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3990), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3990";

try {
  // 两个工作项：一个完成（3 点）、一个进行中（5 点）
  const w1 = await wiService.createWorkItem(admin, pid, { type: "TASK", title: "已完成的任务", estimatePoints: 3, iterationId: it!.id });
  await wiService.createWorkItem(admin, pid, { type: "TASK", title: "进行中的任务", estimatePoints: 5, iterationId: it!.id });
  // 走到终态：**必须沿合法迁移边逐跳走**（不能直接跳终态，服务会正确拒绝）。
  // 每一跳优先选终态目标；最多 5 跳，避免工作流有环时死循环。
  const states = await sql<{ key: string; category: string; name: string }[]>`
    select key, category, name from workflow_state where workflow_id = ${w1!.workflowId} order by sort_order`;
  const catOf = new Map(states.map((s) => [s.key, s.category]));
  let cur = await wiService.getWorkItem(admin, w1!.id);
  for (let hop = 0; hop < 5; hop++) {
    if (catOf.get(cur.statusKey ?? "") === "TERMINAL") break;
    const allowed = await wiService.allowedTransitions(admin, { workflowId: cur.workflowId, statusId: cur.statusId });
    const toTerminal = allowed.find((a) => catOf.get(a.toStateKey ?? "") === "TERMINAL");
    const next = toTerminal ?? allowed[0];
    if (!next) break;
    cur = await wiService.transitionWorkItem(admin, w1!.id, { toStateKey: next.toStateKey, version: cur.version } as never);
  }

  // ── 燃尽图 ──
  const bd = await insightService.burnDown(admin, it!.id);
  ok("燃尽图逐日序列覆盖迭代起止（today-4 … today+2 = 7 天）", bd.points.length === 7, String(bd.points.length));
  ok("口径写在返回体里（不是哑数据）", /remaining = scope - done/.test(bd.metric), bd.metric.slice(0, 40));
  const last = bd.points[bd.points.length - 1]!;
  ok("末日范围 = 3 + 5 = 8 点", last.scope === 8, String(last.scope));
  ok("末日已完成 = 3 点（只算进入完成态的）", last.done === 3, String(last.done));
  ok("剩余 = 5 点", last.remaining === 5, String(last.remaining));
  ok("理想线从首日范围线性降到 0", bd.points[0]!.ideal === 8 && last.ideal === 0, `${bd.points[0]!.ideal} → ${last.ideal}`);
  ok("无快照的日期标注 source=live（不伪造历史）", bd.points.every((p) => p.source === "live"), bd.points[0]!.source);

  // ── 快照写入口（唯一）──
  const snap = await insightService.snapshotIteration(it!.id, last.date);
  ok("快照写入成功（scope/done 与实时一致）", snap.scope === 8 && snap.done === 3, JSON.stringify(snap));
  const snap2 = await insightService.snapshotIteration(it!.id, last.date);
  ok("快照幂等（同一天重复写不报错、不重复）", snap2.scope === 8, JSON.stringify(snap2));
  const rows = await db.select().from(metricSnapshot).where(and(eq(metricSnapshot.iterationId, it!.id), eq(metricSnapshot.snapshotDate, last.date)));
  ok("每天每迭代只有一行", rows.length === 1, String(rows.length));
  const bd2 = await insightService.burnDown(admin, it!.id);
  ok("有快照的日期改标 source=snapshot", bd2.points[bd2.points.length - 1]!.source === "snapshot", bd2.points[bd2.points.length - 1]!.source);

  // ── 累积流 ──
  const cf = await insightService.cumulativeFlow(admin, it!.id);
  ok("累积流逐日（与燃尽同一序列长度）", cf.series.length === 7, String(cf.series.length));
  ok("累积流口径写明", /状态类别/.test(cf.metric), cf.metric.slice(0, 40));
  const cfLast = cf.series[cf.series.length - 1]! as unknown as Record<string, number>;
  ok("末日总数 = 2 个工作项", cfLast.total === 2, String(cfLast.total));
  ok("末日终态 = 1", cfLast.TERMINAL === 1, JSON.stringify(cfLast));
  ok("累积流是单调不减的累计（总数不随时间倒减）",
    cf.series.every((s, i) => i === 0 || (s as unknown as { total: number }).total >= (cf.series[i - 1] as unknown as { total: number }).total),
    JSON.stringify(cf.series.map((s) => (s as unknown as { total: number }).total)));

  // ── 空迭代不报错（规范：空项目不报错）──
  const [emptyIt] = await db.insert(iteration).values({ projectId: pid, name: "空迭代", startDate: start, endDate: end }).returning();
  const bdEmpty = await insightService.burnDown(admin, emptyIt!.id);
  ok("空迭代燃尽图不报错且全 0", bdEmpty.points.every((p) => p.scope === 0 && p.done === 0), JSON.stringify(bdEmpty.points[0]));

  // ── 仪表盘 ──
  const dash = await insightService.createDashboard(admin, { name: "我的洞察", projectId: pid });
  ok("建仪表盘", !!dash!.id);
  let badType = false;
  try { await insightService.addWidget(admin, dash!.id, { type: "NOPE" }); } catch (e) { badType = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法挂件类型 → VALIDATION", badType);
  let noIter = false;
  try { await insightService.addWidget(admin, dash!.id, { type: "BURNDOWN" }); } catch (e) { noIter = (e as { code?: string }).code === "VALIDATION"; }
  ok("BURNDOWN 缺 iterationId → VALIDATION", noIter);
  const wBurndown = await insightService.addWidget(admin, dash!.id, { type: "BURNDOWN", config: { iterationId: it!.id }, sortOrder: 1 });
  await insightService.addWidget(admin, dash!.id, { type: "CUMULATIVE_FLOW", config: { iterationId: it!.id }, sortOrder: 2 });
  ok("挂件创建成功", !!wBurndown!.id);
  const detail = await insightService.getDashboard(admin, dash!.id);
  ok("详情含两个挂件且有序", detail.widgets.length === 2 && detail.widgets[0]!.sortOrder === 1, String(detail.widgets.length));
  const wd = await insightService.widgetData(admin, wBurndown!);
  ok("挂件数据可直接渲染（带上燃尽序列）", !!wd && Array.isArray((wd as { points: unknown[] }).points), JSON.stringify(wd).slice(0, 60));
  await insightService.updateWidget(admin, wBurndown!.id, { sortOrder: 9 });
  ok("改挂件排序", (await insightService.listWidgets(admin, dash!.id)).find((w) => w.id === wBurndown!.id)!.sortOrder === 9);
  await insightService.deleteWidget(admin, wBurndown!.id);
  ok("删挂件后只剩一个", (await insightService.listWidgets(admin, dash!.id)).length === 1);
  await insightService.updateDashboard(admin, dash!.id, { name: "改名后的洞察" });
  ok("改仪表盘名", (await insightService.getDashboard(admin, dash!.id)).name === "改名后的洞察");

  // ── 权限与可见性 ──
  let denied = false;
  try { await insightService.burnDown(outsider, it!.id); } catch { denied = true; }
  ok("无数据范围者读不到燃尽图", denied);
  let deniedCreate = false;
  try { await insightService.createDashboard(outsider, { name: "x", projectId: pid }); } catch { deniedCreate = true; }
  ok("无 dashboard:manage 者不能建项目仪表盘", deniedCreate);
  const visible = await insightService.listDashboards(admin, pid);
  ok("仪表盘列表含自己的", visible.some((d) => d.id === dash!.id));

  // ── HTTP 端点（关键路径要有真实 HTTP 断言）──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w10-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const httpBd = await fetch(`${BASE}/api/v1/iterations/${it!.id}/burndown`, { headers: { cookie } });
  ok("HTTP 燃尽端点 200 且含 points", httpBd.status === 200 && Array.isArray(((await httpBd.json()) as { points: unknown[] }).points), String(httpBd.status));
  const httpCf = await fetch(`${BASE}/api/v1/iterations/${it!.id}/cumulative-flow`, { headers: { cookie } });
  ok("HTTP 累积流端点 200", httpCf.status === 200, String(httpCf.status));
  const httpDash = await fetch(`${BASE}/api/v1/dashboards/${dash!.id}`, { headers: { cookie } });
  const httpDashBody = (await httpDash.json()) as { widgets: { data: unknown }[] };
  ok("HTTP 仪表盘详情带挂件数据", httpDash.status === 200 && httpDashBody.widgets.length === 1 && !!httpDashBody.widgets[0]!.data,
    JSON.stringify(httpDashBody).slice(0, 80));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(dashboardWidget);
  await db.delete(dashboard);
  await db.delete(metricSnapshot);
  await db.delete(importMapping); await db.delete(importBatch);
  await db.delete(customFieldValue); await db.delete(customFieldDef);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(iteration).where(eq(iteration.projectId, pid));
  await db.delete(milestone); await db.delete(release); await db.delete(moduleT);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
