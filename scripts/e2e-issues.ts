import "./_env.ts";   // 环境预设必须最先加载
/** 问题追踪（Round 64 对标）：缺陷统计/筛选 + 结构化处理进展自检 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, project, role, roleAssignment, workItem, workItemProgressUpdate, workflowState } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "iss-admin";
const GUEST = "iss-guest";
const PW = "iss-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "问题管理员", ar!.id);
await mk(GUEST, "问题成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `ISS${SUFFIX}`, name: "问题追踪项目" } as never);
const d1 = await wiService.createWorkItem(admin, proj.id, { type: "DEFECT", title: "登录接口 500", severity: "S1", priority: "URGENT", dueDate: "2020-01-01" } as never);
await wiService.createWorkItem(admin, proj.id, { type: "DEFECT", title: "列表分页错乱", severity: "S2", priority: "HIGH" } as never);
const d3 = await wiService.createWorkItem(admin, proj.id, { type: "DEFECT", title: "样式溢出", severity: "S3", priority: "MEDIUM" } as never);
await wiService.createWorkItem(admin, proj.id, { type: "TASK", title: "非缺陷不应出现在问题追踪" } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
let updateId: string | undefined;
try {
  const H = await login(ADMIN);
  const stats0 = await (await fetch(`${BASE}/api/v1/projects/${proj.id}/issues/stats`, { headers: { cookie: H.cookie } })).json() as Record<string, number>;
  ok("统计只算 DEFECT：total=3/open=3", stats0.total === 3 && stats0.open === 3, JSON.stringify(stats0));
  ok("S1 未完成=1、逾期=1、处理率=0%", stats0.p0 === 1 && stats0.overdue === 1 && stats0.donePercent === 0, JSON.stringify(stats0));

  // 把 S3 迁到关闭状态（缺陷流用 TERMINAL 表示已解决/已关闭；可能需多次流转），验证统计/筛选真实变化
  for (let i = 0; i < 6; i++) {
    const wi = await wiService.getWorkItem(admin, d3.id);
    const allowed = await wiService.allowedTransitions(admin, wi as never);
    const target = allowed.find((t) => t.toCategory === "DONE" || t.toCategory === "TERMINAL") ?? allowed[0];
    if (!target) break;
    await wiService.transitionWorkItem(admin, d3.id, { toStateKey: target.toStateKey, version: (wi as { version: number }).version } as never);
    const now = await wiService.getWorkItem(admin, d3.id);
    const [state] = await db.select({ category: workflowState.category }).from(workflowState)
      .where(eq(workflowState.id, (now as { statusId: string }).statusId));
    if (["DONE", "TERMINAL"].includes(state?.category ?? "")) break;
  }
  const stats1 = await (await fetch(`${BASE}/api/v1/projects/${proj.id}/issues/stats`, { headers: { cookie: H.cookie } })).json() as {
    done: number; open: number; donePercent: number;
    trend: { date: string; created: number; resolved: number }[];
    severity: Record<string, number>;
  };
  ok("流转后 done=1/open=2/处理率=33%", stats1.done === 1 && stats1.open === 2 && stats1.donePercent === 33, JSON.stringify(stats1));
  ok("趋势 14 天且今日新增 3/关闭 1", stats1.trend.length === 14
    && stats1.trend.reduce((n, d) => n + d.created, 0) === 3
    && stats1.trend.reduce((n, d) => n + d.resolved, 0) === 1, JSON.stringify(stats1.trend.slice(-2)));
  ok("严重度分布 S1/S2/S3 各 1", stats1.severity.S1 === 1 && stats1.severity.S2 === 1 && stats1.severity.S3 === 1, JSON.stringify(stats1.severity));

  const listAll = await (await fetch(`${BASE}/api/v1/projects/${proj.id}/issues`, { headers: { cookie: H.cookie } })).json() as { total: number; items: { key: string; statusName: string }[] };
  ok("列表 3 条且含状态名", listAll.total === 3 && listAll.items.every((x) => !!x.statusName), JSON.stringify(listAll.items.map((x) => [x.key, x.statusName])));
  const s1 = await (await fetch(`${BASE}/api/v1/projects/${proj.id}/issues?severity=S1`, { headers: { cookie: H.cookie } })).json() as { total: number };
  ok("severity=S1 过滤 1 条", s1.total === 1, JSON.stringify(s1));
  const done = await (await fetch(`${BASE}/api/v1/projects/${proj.id}/issues?statusCategory=DONE`, { headers: { cookie: H.cookie } })).json() as { total: number };
  ok("statusCategory=DONE（含 TERMINAL）过滤 1 条", done.total === 1, JSON.stringify(done));
  const q = await (await fetch(`${BASE}/api/v1/projects/${proj.id}/issues?q=${encodeURIComponent("分页")}`, { headers: { cookie: H.cookie } })).json() as { total: number };
  ok("关键字过滤 1 条", q.total === 1, JSON.stringify(q));

  const created = await fetch(`${BASE}/api/v1/work-items/${d1.id}/progress-updates`, {
    method: "POST", headers: H, body: JSON.stringify({ summary: "已定位到鉴权中间件", nextSteps: "补回归用例", blockers: "依赖测试环境" }),
  });
  const body = await created.json() as { id: string };
  updateId = body.id;
  ok("处理进展 POST 201", created.status === 201, String(created.status));
  const list = await (await fetch(`${BASE}/api/v1/work-items/${d1.id}/progress-updates`, { headers: { cookie: H.cookie } })).json() as { updates: { summary: string; authorName: string }[] };
  ok("处理进展返回 summary/作者", list.updates.length === 1 && list.updates[0]!.summary === "已定位到鉴权中间件" && list.updates[0]!.authorName === "问题管理员", JSON.stringify(list.updates[0]));
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, proj.id));
  ok("写项目活动 work_item.progress_added", acts.some((a) => a.action === "work_item.progress_added"));

  const G = await login(GUEST);
  ok("非报告人/处理人且无 update_any → 403", (await fetch(`${BASE}/api/v1/work-items/${d1.id}/progress-updates`, {
    method: "POST", headers: { cookie: G.cookie, "x-csrf-token": G["x-csrf-token"], "content-type": "application/json" },
    body: JSON.stringify({ summary: "越权" }),
  })).status === 403);
  ok("空 summary → 400", (await fetch(`${BASE}/api/v1/work-items/${d1.id}/progress-updates`, {
    method: "POST", headers: H, body: JSON.stringify({ summary: "" }),
  })).status === 400);

  await fetch(`${BASE}/api/v1/work-item-progress-updates/${updateId}`, { method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] } });
  ok("删除处理进展后为空", (await (await fetch(`${BASE}/api/v1/work-items/${d1.id}/progress-updates`, { headers: { cookie: H.cookie } })).json() as { updates: unknown[] }).updates.length === 0);
} finally {
  await app.close();
  await db.delete(workItemProgressUpdate).where(eq(workItemProgressUpdate.projectId, proj.id));
  await db.delete(workItem).where(eq(workItem.projectId, proj.id));
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(activityEntry); await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
