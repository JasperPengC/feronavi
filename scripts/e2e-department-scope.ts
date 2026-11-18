import "./_env.ts";   // 环境预设必须最先加载
/** 部门数据范围（Round 73，只读可见性）：项目可见 + 写权限边界自检 */
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
const ADMIN = "ds-admin";
const USER = "ds-user";
const PW = "ds-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, USER]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string, scopeType: "ORG" | "DEPARTMENT", scopeId: string | null) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType, scopeId });
  return row!.id;
};
const adminId = await mk(ADMIN, "部门范围管理员", ar!.id, "ORG", null);
const admin = (await loadActor(adminId))!;
const root = await orgSvc.createDepartment(admin, { name: `范围部门${SUFFIX}` });
const child = await orgSvc.createDepartment(admin, { name: `范围子部门${SUFFIX}`, parentId: root!.id });
const userId = await mk(USER, "部门范围成员", mr!.id, "DEPARTMENT", root!.id);
const pDept = await projectService.createProject(admin, { key: `DS${SUFFIX}`, name: "部门范围项目", departmentId: child!.id } as never);
const pOther = await projectService.createProject(admin, { key: `DO${SUFFIX}`, name: "其它部门项目" } as never);
const wi = await wiService.createWorkItem(admin, pDept.id, { type: "TASK", title: "部门项目任务" } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
try {
  const U = await login(USER);
  const projects = await (await fetch(`${BASE}/api/v1/projects?pageSize=100`, { headers: { cookie: U.cookie } })).json() as { items: { id: string; key: string }[] };
  ok("部门成员的项目列表只含部门项目（含子部门）", projects.items.some((p) => p.id === pDept.id) && !projects.items.some((p) => p.id === pOther.id), JSON.stringify(projects.items.map((p) => p.key)));
  ok("部门项目详情可读（200）", (await fetch(`${BASE}/api/v1/projects/${pDept.id}`, { headers: { cookie: U.cookie } })).status === 200);
  ok("其它部门项目不可见（403）", (await fetch(`${BASE}/api/v1/projects/${pOther.id}`, { headers: { cookie: U.cookie } })).status === 403);
  ok("部门项目工作项列表可读（200）", (await fetch(`${BASE}/api/v1/projects/${pDept.id}/work-items?view=table`, { headers: { cookie: U.cookie } })).status === 200);
  // 只读边界：DEPARTMENT 档不覆盖写权限（写仍要求 TEAM/PROJECT/ORG）
  const patch = await fetch(`${BASE}/api/v1/work-items/${wi.id}`, {
    method: "PATCH", headers: { cookie: U.cookie, "x-csrf-token": U["x-csrf-token"], "content-type": "application/json" },
    body: JSON.stringify({ version: (wi as { version: number }).version, title: "越权修改" }),
  });
  ok("部门档写工作项 → 403（只读边界）", patch.status === 403, String(patch.status));
  // 管理端 scope-options 支持 DEPARTMENT
  const A = await login(ADMIN);
  const opts = await (await fetch(`${BASE}/api/v1/roles/scope-options?scopeType=DEPARTMENT`, { headers: { cookie: A.cookie } })).json() as { scopes: { id: string; name: string }[] };
  ok("scope-options 支持 DEPARTMENT 且含部门", opts.scopes.some((s) => s.id === root!.id), JSON.stringify(opts.scopes.slice(0, 3)));
} finally {
  await app.close();
  await db.delete(workItem).where(eq(workItem.projectId, pDept.id));
  await db.delete(project).where(eq(project.id, pDept.id));
  await db.delete(project).where(eq(project.id, pOther.id));
  await db.delete(department).where(eq(department.id, child!.id));
  await db.delete(department).where(eq(department.id, root!.id));
  await db.delete(auditEntry);
  for (const u of [ADMIN, USER]) await deleteTestMember(u);
  void userId;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
