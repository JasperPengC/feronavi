import "./_env.ts";   // 环境预设必须最先加载
/** 里程碑详情 + 结构化进展记录自检（Round 62 对标 P1） */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, milestone, milestoneProgressUpdate, project, role, roleAssignment, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "msd-admin";
const GUEST = "msd-guest";
const PW = "msd-pass-123456";
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
const adminId = await mk(ADMIN, "里程碑管理员", ar!.id);
const guestId = await mk(GUEST, "里程碑成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `MSD${SUFFIX}`, name: "里程碑详情项目" } as never);
const ms = await planningService.createPlan(admin, proj.id, "milestone", { name: "里程碑详情验收", dueDate: "2026-12-31" } as never);
const wi1 = await wiService.createWorkItem(admin, proj.id, { type: "TASK", title: "关联任务一", milestoneId: ms.id } as never);
await wiService.createWorkItem(admin, proj.id, { type: "TASK", title: "关联任务二", milestoneId: ms.id } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
let updateId: string;
try {
  const H = await login(ADMIN);
  const detail = await fetch(`${BASE}/api/v1/milestones/${ms.id}/detail`, { headers: { cookie: H.cookie } });
  const d = await detail.json() as { milestone: { name: string; progressMode: string }; project: { id: string }; relatedWorkItems: { id: string }[]; progressUpdates: unknown[] };
  ok("GET 详情 200 且含项目与 2 个关联工作项", detail.status === 200 && d.project.id === proj.id && d.relatedWorkItems.length === 2, JSON.stringify({ status: detail.status, n: d.relatedWorkItems.length }));
  ok("初始无进展记录", d.progressUpdates.length === 0);

  const created = await fetch(`${BASE}/api/v1/milestones/${ms.id}/progress-updates`, {
    method: "POST", headers: H,
    body: JSON.stringify({ summary: "完成第一轮验收", nextSteps: "修复回归问题", blockers: "等待部署窗口" }),
  });
  const createdBody = await created.json() as { id: string; summary: string };
  updateId = createdBody.id;
  ok("POST 进展 201", created.status === 201 && createdBody.summary === "完成第一轮验收", String(created.status));
  const after = await (await fetch(`${BASE}/api/v1/milestones/${ms.id}/progress-updates`, { headers: { cookie: H.cookie } })).json() as { updates: { summary: string; nextSteps: string; blockers: string; authorName: string }[] };
  ok("GET 进展返回 summary/next/blockers/作者", after.updates.length === 1 && after.updates[0]!.nextSteps === "修复回归问题"
    && after.updates[0]!.blockers === "等待部署窗口" && after.updates[0]!.authorName === "里程碑管理员", JSON.stringify(after.updates[0]));
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, proj.id));
  ok("写项目活动 milestone.progress_added", acts.some((a) => a.action === "milestone.progress_added"), JSON.stringify(acts.map((a) => a.action)));

  const G = await login(GUEST);
  ok("无 milestone:manage 写进展 → 403", (await fetch(`${BASE}/api/v1/milestones/${ms.id}/progress-updates`, {
    method: "POST", headers: { cookie: G.cookie, "x-csrf-token": G["x-csrf-token"], "content-type": "application/json" },
    body: JSON.stringify({ summary: "越权" }),
  })).status === 403);
  ok("空 summary → 400", (await fetch(`${BASE}/api/v1/milestones/${ms.id}/progress-updates`, {
    method: "POST", headers: H, body: JSON.stringify({ summary: "" }),
  })).status === 400);

  const del = await fetch(`${BASE}/api/v1/milestone-progress-updates/${updateId}`, { method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] } });
  ok("作者删除进展 200", del.status === 200);
  ok("删除后列表为空", (await (await fetch(`${BASE}/api/v1/milestones/${ms.id}/progress-updates`, { headers: { cookie: H.cookie } })).json() as { updates: unknown[] }).updates.length === 0);
} finally {
  await app.close();
  await db.delete(milestoneProgressUpdate).where(eq(milestoneProgressUpdate.projectId, proj.id));
  await db.delete(workItem).where(eq(workItem.projectId, proj.id));
  await db.delete(milestone).where(eq(milestone.projectId, proj.id));
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(activityEntry); await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  void wi1; void guestId;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
