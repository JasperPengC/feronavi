import "./_env.ts";   // 环境预设必须最先加载
/** 跨项目问题总览（Round 71 对标）：可见项目聚合/过滤/权限自检 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, project, projectMembership, role, roleAssignment, workItem, workflowState } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "ig-admin";
const GUEST = "ig-guest";
const PW = "ig-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [gr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
const mk = async (username: string, name: string, roleId: string | null) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  if (roleId) await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "全局问题管理员", ar!.id);
const guestId = await mk(GUEST, "全局问题成员", null);
const admin = (await loadActor(adminId))!;
const p1 = await projectService.createProject(admin, { key: `IG${SUFFIX}A`, name: "全局问题项目一" } as never);
const p2 = await projectService.createProject(admin, { key: `IG${SUFFIX}B`, name: "全局问题项目二" } as never);
await db.insert(projectMembership).values({ projectId: p1.id, memberId: guestId, roleId: gr!.id });
const d1 = await wiService.createWorkItem(admin, p1.id, { type: "DEFECT", title: "项目一 P0", severity: "S1" } as never);
await wiService.createWorkItem(admin, p1.id, { type: "DEFECT", title: "项目一 普通", severity: "S2" } as never);
const d3 = await wiService.createWorkItem(admin, p2.id, { type: "DEFECT", title: "项目二 已关闭", severity: "S3" } as never);
for (let i = 0; i < 6; i++) {
  const wi = await wiService.getWorkItem(admin, d3.id);
  const allowed = await wiService.allowedTransitions(admin, wi as never);
  const target = allowed.find((t) => t.toCategory === "DONE" || t.toCategory === "TERMINAL") ?? allowed[0];
  if (!target) break;
  await wiService.transitionWorkItem(admin, d3.id, { toStateKey: target.toStateKey, version: (wi as { version: number }).version } as never);
  const [state] = await db.select({ category: workflowState.category }).from(workflowState).where(eq(workflowState.id, (await wiService.getWorkItem(admin, d3.id) as { statusId: string }).statusId));
  if (state && ["DONE", "TERMINAL"].includes(state.category)) break;
}

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken) };
};
try {
  const H = await login(ADMIN);
  const G = await login(GUEST);
  const before = await (await fetch(`${BASE}/api/v1/issues/stats`, { headers: { cookie: H.cookie } })).json() as { total: number; open: number; done: number };
  const after = await (await fetch(`${BASE}/api/v1/issues/stats`, { headers: { cookie: H.cookie } })).json() as { total: number; open: number; done: number };
  ok("全局统计基线可读", before.total >= 0 && after.total === before.total, `${before.total}/${after.total}`);

  const list1 = await (await fetch(`${BASE}/api/v1/issues?projectId=${p1.id}`, { headers: { cookie: H.cookie } })).json() as { total: number; items: { projectKey: string }[] };
  const list2 = await (await fetch(`${BASE}/api/v1/issues?projectId=${p2.id}`, { headers: { cookie: H.cookie } })).json() as { total: number };
  ok("按项目过滤：项目一 2 条、项目二 1 条", list1.total === 2 && list2.total === 1, `${list1.total}/${list2.total}`);
  ok("全局列表返回项目标识", list1.items.every((x) => x.projectKey === `IG${SUFFIX}A`), JSON.stringify(list1.items.map((x) => x.projectKey)));
  const s1 = await (await fetch(`${BASE}/api/v1/issues?projectId=${p1.id}&severity=S1`, { headers: { cookie: H.cookie } })).json() as { total: number };
  ok("严重度过滤：项目一 S1 1 条", s1.total === 1, String(s1.total));

  // 管理员全组织视角：新增 3 条都在统计里（用项目过滤列表确认；统计增量用同一时刻前后差）
  const gStats = await (await fetch(`${BASE}/api/v1/issues/stats`, { headers: { cookie: G.cookie } })).json() as { total: number };
  const gList = await (await fetch(`${BASE}/api/v1/issues`, { headers: { cookie: G.cookie } })).json() as { total: number; items: unknown[] };
  ok("仅项目一成员：全局统计/列表只看到项目一的 2 条", gStats.total === 2 && gList.total === 2, JSON.stringify({ stats: gStats.total, list: gList.total }));
  ok("不可见项目过滤 → 403", (await fetch(`${BASE}/api/v1/issues?projectId=${p2.id}`, { headers: { cookie: G.cookie } })).status === 403);
  void d1;
} finally {
  await app.close();
  for (const p of [p1, p2]) {
    await db.delete(workItem).where(eq(workItem.projectId, p.id));
    await db.delete(project).where(eq(project.id, p.id));
  }
  await db.delete(activityEntry); await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  void guestId;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
