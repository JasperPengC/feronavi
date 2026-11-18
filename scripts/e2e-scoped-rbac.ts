import "./_env.ts";   // 环境预设必须最先加载
/** 按角色绑定作用域（Round 75）：并集放大禁止 + 部门写权限 + 数据范围 DTO 自检 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, department, member, project, role, roleAssignment, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as orgSvc from "../src/server/services/org-structure.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const MIXED = "sr-mixed";
const DEPT = "sr-dept";
const ORG = "sr-org";
const PW = "sr-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [MIXED, DEPT, ORG]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  return row!.id;
};
const mixedId = await mk(MIXED, "混合角色成员");
const deptOnlyId = await mk(DEPT, "部门管理员");
const orgAdminId = await mk(ORG, "组织管理员");
const adminActor = (await loadActor(orgAdminId))!;
await db.insert(roleAssignment).values({ memberId: orgAdminId, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
// mixed: ORG MEMBER + 部门 ADMIN；deptOnly: 部门 ADMIN
await db.insert(roleAssignment).values({ memberId: mixedId, roleId: memberRole!.id, scopeType: "ORG", scopeId: null });
const admin2 = (await loadActor(orgAdminId))!;
const root = await orgSvc.createDepartment(admin2, { name: `SR部门${SUFFIX}` });
const child = await orgSvc.createDepartment(admin2, { name: `SR子部门${SUFFIX}`, parentId: root!.id });
await db.insert(roleAssignment).values([
  { memberId: mixedId, roleId: adminRole!.id, scopeType: "DEPARTMENT", scopeId: root!.id },
  { memberId: deptOnlyId, roleId: adminRole!.id, scopeType: "DEPARTMENT", scopeId: root!.id },
]);
const pDept = await projectService.createProject(admin2, { key: `SR${SUFFIX}`, name: "SR部门项目", departmentId: child!.id } as never);
const pOther = await projectService.createProject(admin2, { key: `SO${SUFFIX}`, name: "SR其它项目" } as never);
const wiDept = await wiService.createWorkItem(admin2, pDept.id, { type: "TASK", title: "部门项目任务" } as never);
const wiOther = await wiService.createWorkItem(admin2, pOther.id, { type: "TASK", title: "其它项目任务" } as never);
void adminActor;

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
const patch = async (h: Awaited<ReturnType<typeof login>>, wi: { id: string; version?: number }, title: string) => {
  const res = await fetch(`${BASE}/api/v1/work-items/${wi.id}`, { headers: { cookie: h.cookie } });
  if (!res.ok) return res.status;   // 不可见时直接返回可见性状态（403），不要拿 undefined 去 PATCH
  const version = ((await res.json()) as { version: number }).version;
  return (await fetch(`${BASE}/api/v1/work-items/${wi.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ version, title }),
  })).status;
};
try {
  const M = await login(MIXED);
  ok("混合角色：部门项目工作项可写（部门 ADMIN 生效）", (await patch(M, wiDept as never, "部门项目任务（改）")) === 200);
  ok("混合角色：其它项目工作项不可写（ORG MEMBER 无 update_any，**并集放大被禁止**）", (await patch(M, wiOther as never, "越权改")) === 403);
  const meMixed = await (await fetch(`${BASE}/api/v1/auth/me`, { headers: { cookie: M.cookie } })).json() as { dataScopes: { scopeType: string }[] };
  ok("auth/me dataScopes 不含 synthetic PROJECT 展开", !meMixed.dataScopes.some((s) => s.scopeType === "PROJECT") && meMixed.dataScopes.some((s) => s.scopeType === "DEPARTMENT"), JSON.stringify(meMixed.dataScopes));

  const D = await login(DEPT);
  const dDeptStatus = await patch(D, wiDept as never, "部门项目任务（纯部门）");
  ok("纯部门 ADMIN：部门项目可写", dDeptStatus === 200, String(dDeptStatus));
  ok("纯部门 ADMIN：其它项目不可写", (await patch(D, wiOther as never, "越权改")) === 403);
  ok("纯部门 ADMIN：其它项目详情不可见 403", (await fetch(`${BASE}/api/v1/projects/${pOther.id}`, { headers: { cookie: D.cookie } })).status === 403);

  // Round 89：组织级动作不得被部门 ADMIN 用并集越权；跨项目进展更新不得绕过作用域
  const createMemberAsDept = await fetch(`${BASE}/api/v1/members`, {
    method: "POST", headers: D,
    body: JSON.stringify({ username: `sr-x-${Date.now().toString(36).slice(-4)}`, name: "越权成员", email: `sr-x-${Date.now()}@x.test`, password: "sr-pass-123456" }),
  });
  ok("部门 ADMIN 创建组织成员 → 403（org 级动作不允许并集越权）", createMemberAsDept.status === 403, String(createMemberAsDept.status));
  ok("部门 ADMIN 读系统迁移 → 403", (await fetch(`${BASE}/api/v1/system/migrations`, { headers: { cookie: D.cookie } })).status === 403);
  ok("部门 ADMIN 读系统运维 → 403", (await fetch(`${BASE}/api/v1/system/operations`, { headers: { cookie: D.cookie } })).status === 403);
  const progressOther = await fetch(`${BASE}/api/v1/work-items/${(wiOther as { id: string }).id}/progress-updates`, {
    method: "POST", headers: M, body: JSON.stringify({ summary: "越权进展" }),
  });
  ok("混合角色对非部门项目写进展 → 403（update_any 按作用域判定）", progressOther.status === 403, String(progressOther.status));
  const progressDept = await fetch(`${BASE}/api/v1/work-items/${(wiDept as { id: string }).id}/progress-updates`, {
    method: "POST", headers: M, body: JSON.stringify({ summary: "部门进展" }),
  });
  ok("混合角色对部门项目写进展 → 201（部门 ADMIN 生效）", progressDept.status === 201, String(progressDept.status));

  const O = await login(ORG);
  const o1 = await patch(O, wiDept as never, "组织改部门");
  const o2 = await patch(O, wiOther as never, "组织改其它");
  ok("ORG ADMIN：两个项目都可写", o1 === 200 && o2 === 200, `${o1}/${o2}`);
} finally {
  await app.close();
  await db.delete(workItem).where(eq(workItem.projectId, pDept.id));
  await db.delete(workItem).where(eq(workItem.projectId, pOther.id));
  await db.delete(project).where(eq(project.id, pDept.id));
  await db.delete(project).where(eq(project.id, pOther.id));
  await db.delete(department).where(eq(department.id, child!.id));
  await db.delete(department).where(eq(department.id, root!.id));
  await db.delete(auditEntry);
  for (const u of [MIXED, DEPT, ORG]) await deleteTestMember(u);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
