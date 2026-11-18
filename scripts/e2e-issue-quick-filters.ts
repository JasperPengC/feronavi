import "./_env.ts";
/** 问题追踪个人快捷筛选 + 排序（Round 81 · 对标 YouQu 列表） */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();
import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, project, role, roleAssignment, subscription, workItem, workItemCollaborator } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const U = "qf-user";
const PW = "qf-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
await deleteTestMember(U); await db.delete(auditEntry); await db.delete(activityEntry);
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [row] = await db.insert(member).values({ username: U, email: `${U}@x.test`, name: "快捷筛选用户", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: row!.id, roleId: mr!.id, scopeType: "ORG", scopeId: null });
const user = (await loadActor(row!.id))!;
const proj = await projectService.createProject((await loadActor((await db.select({ id: role.id }).from(role)).length ? (await db.select({ memberId: roleAssignment.memberId }).from(roleAssignment).where(eq(roleAssignment.roleId, (await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN")))[0]!.id)).limit(1))[0]!.memberId : row!.id))!, { key: `QF${SUFFIX}`, name: "快捷筛选项目" } as never);
const mkDefect = async (title: string, extra: Record<string, unknown> = {}) => wiService.createWorkItem(user, proj.id, { type: "DEFECT", title, severity: "S3", ...extra } as never);
const assigned = await mkDefect(`指派给我${SUFFIX}`, { assigneeId: row!.id });
await mkDefect(`我登记${SUFFIX}`);
const watched = await mkDefect(`我关注${SUFFIX}`);
const collab = await mkDefect(`我协作${SUFFIX}`);
const other = await mkDefect(`无关${SUFFIX}`);
await db.insert(subscription).values({ memberId: row!.id, targetType: "WORK_ITEM", targetId: watched.id, notifyChannel: "IN_APP" });
await db.insert(workItemCollaborator).values({ workItemId: collab.id, memberId: row!.id });

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async () => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: U, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken) };
};
const get = async (path: string, H: Awaited<ReturnType<typeof login>>) => (await fetch(`${BASE}${path}`, { headers: { cookie: H.cookie } })).json();
try {
  const H = await login();
  const all = await get(`/api/v1/projects/${proj.id}/issues`, H) as { items: { id: string; type: string; reporterName: string | null }[]; total: number };
  ok("列表返回 type/reporterName 列", all.total === 5 && all.items.every((i) => i.type === "DEFECT") && all.items.every((i) => i.reporterName === "快捷筛选用户"),
    JSON.stringify({ total: all.total, t: all.items.map((i) => i.reporterName) }));
  const assignedList = await get(`/api/v1/projects/${proj.id}/issues?quick=ASSIGNED`, H) as { items: { id: string }[] };
  ok("项目 quick=ASSIGNED 只含指派给我", assignedList.items.length === 1 && assignedList.items[0]!.id === assigned.id);
  const reportedList = await get(`/api/v1/projects/${proj.id}/issues?quick=REPORTED`, H) as { items: { id: string }[] };
  ok("项目 quick=REPORTED 命中全部（都是本人登记）", reportedList.items.length === 5);
  const watchingList = await get(`/api/v1/projects/${proj.id}/issues?quick=WATCHING`, H) as { items: { id: string }[] };
  ok("项目 quick=WATCHING 只含关注项", watchingList.items.length === 1 && watchingList.items[0]!.id === watched.id);
  const collabList = await get(`/api/v1/projects/${proj.id}/issues?quick=COLLABORATING`, H) as { items: { id: string }[] };
  ok("项目 quick=COLLABORATING 只含协作项", collabList.items.length === 1 && collabList.items[0]!.id === collab.id);
  const globalWatching = await get(`/api/v1/issues?quick=WATCHING`, H) as { items: { id: string }[] };
  ok("全局 quick=WATCHING 同样生效", globalWatching.items.some((i) => i.id === watched.id));
  const severitySort = await get(`/api/v1/projects/${proj.id}/issues?sort=SEVERITY`, H) as { items: { id: string }[] };
  ok("sort=SEVERITY 返回 5 条", severitySort.items.length === 5);
  void other;
} finally {
  await app.close();
  await db.delete(subscription).where(eq(subscription.targetId, watched.id)).catch(() => {});
  await db.delete(workItemCollaborator).where(eq(workItemCollaborator.workItemId, collab.id)).catch(() => {});
  await db.delete(workItem).where(eq(workItem.projectId, proj.id));
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await deleteTestMember(U);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
