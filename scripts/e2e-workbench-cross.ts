import "./_env.ts";   // 环境预设必须最先加载
/** 工作台跨域聚合（Round 68 对标）：缺陷/里程碑统计与可见性自检 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, milestone, project, role, roleAssignment, workItem, workflowState } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "wb-admin";
const GUEST = "wb-guest";
const PW = "wb-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
const dateOffset = (days: number) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const mk = async (username: string, name: string, roleId: string | null) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  if (roleId) await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "工作台管理员", ar!.id);
await mk(GUEST, "工作台成员", null);
const admin = (await loadActor(adminId))!;
let proj: { id: string } | null = null;
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken) };
};
try {
  const H = await login(ADMIN);
  const before = await (await fetch(`${BASE}/api/v1/workbench`, { headers: { cookie: H.cookie } })).json() as {
    crossDomain: { defects: { total: number; open: number; done: number; overdue: number }; myOpenDefects: number; milestones: { overdue: number; dueSoon: number; items: unknown[] } };
  };
  const base = before.crossDomain;

  // 在基线之后创建本套件数据（其它项目/历史数据不干扰断言）
  proj = await projectService.createProject(admin, { key: `WB${SUFFIX}`, name: "工作台跨域项目" } as never);
  await wiService.createWorkItem(admin, proj.id, { type: "DEFECT", title: "跨域 P0", severity: "S1", priority: "URGENT", assigneeId: adminId, dueDate: dateOffset(-1) } as never);
  await wiService.createWorkItem(admin, proj.id, { type: "DEFECT", title: "跨域普通", severity: "S3", assigneeId: adminId } as never);
  const d3 = await wiService.createWorkItem(admin, proj.id, { type: "DEFECT", title: "跨域已关闭", severity: "S2" } as never);
  // 把 d3 流转到关闭（TERMINAL/DONE）
  for (let i = 0; i < 6; i++) {
    const wi = await wiService.getWorkItem(admin, d3.id);
    const allowed = await wiService.allowedTransitions(admin, wi as never);
    const target = allowed.find((t) => t.toCategory === "DONE" || t.toCategory === "TERMINAL") ?? allowed[0];
    if (!target) break;
    await wiService.transitionWorkItem(admin, d3.id, { toStateKey: target.toStateKey, version: (wi as { version: number }).version } as never);
    const now = await wiService.getWorkItem(admin, d3.id);
    const [state] = await db.select({ category: workflowState.category }).from(workflowState)
      .where(eq(workflowState.id, (now as { statusId: string }).statusId));
    if (state && ["DONE", "TERMINAL"].includes(state.category)) break;
  }
  const msSoon = await planningService.createPlan(admin, proj.id, "milestone", { name: "临期里程碑", dueDate: dateOffset(3) } as never);
  await planningService.createPlan(admin, proj.id, "milestone", { name: "逾期里程碑", dueDate: dateOffset(-2) } as never);
  
  
  // 重新取工作台（同一 actor）
  const wb = await (await fetch(`${BASE}/api/v1/workbench`, { headers: { cookie: H.cookie } })).json() as {
    crossDomain: { defects: { total: number; open: number; p0: number; done: number; overdue: number; donePercent: number }; myOpenDefects: number; milestones: { overdue: number; dueSoon: number; items: { id: string; name: string }[] } };
  };
  const cd = wb.crossDomain;
  ok("缺陷统计增量：total +3 / open +2 / done +1", cd.defects.total - base.defects.total === 3 && cd.defects.open - base.defects.open === 2 && cd.defects.done - base.defects.done === 1, JSON.stringify({ base: base.defects, now: cd.defects }));
  ok("P0=1、逾期 +1、处理率按全量真算", cd.defects.p0 >= 1 && cd.defects.overdue - base.defects.overdue === 1 && cd.defects.donePercent >= 1, JSON.stringify(cd.defects));
  ok("我的未完成缺陷增量 +2", cd.myOpenDefects - base.myOpenDefects === 2, String(cd.myOpenDefects));
  ok("里程碑：临期 +1、逾期 +1、条目含新建两名", cd.milestones.dueSoon - base.milestones.dueSoon === 1
    && cd.milestones.overdue - base.milestones.overdue === 1
    && cd.milestones.items.some((m) => m.name === "临期里程碑") && cd.milestones.items.some((m) => m.name === "逾期里程碑"), JSON.stringify(cd.milestones));
  ok("临期里程碑条目含项目与详情 id", cd.milestones.items.some((m) => m.id === msSoon.id));

  const G = await login(GUEST);
  const gw = await (await fetch(`${BASE}/api/v1/workbench`, { headers: { cookie: G.cookie } })).json() as typeof wb;
  ok("无项目关系成员：缺陷/里程碑统计为 0、列表为空",
    gw.crossDomain.defects.total === 0 && gw.crossDomain.myOpenDefects === 0 && gw.crossDomain.milestones.items.length === 0,
    JSON.stringify(gw.crossDomain));
} finally {
  await app.close();
  if (proj) {
    await db.delete(workItem).where(eq(workItem.projectId, proj.id));
    await db.delete(milestone).where(eq(milestone.projectId, proj.id));
    await db.delete(project).where(eq(project.id, proj.id));
  }
  await db.delete(activityEntry); await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
