import "./_env.ts";   // 环境预设必须最先加载
/** 项目归属部门 + 成员按部门筛选（Round 72 组织架构增强） */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, department, member, project, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as orgSvc from "../src/server/services/org-structure.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "pd-admin";
const M1 = "pd-member-a";
const M2 = "pd-member-b";
const PW = "pd-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, M1, M2]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "项目部门管理员", ar!.id);
const m1Id = await mk(M1, "子部门成员", ar!.id);
const m2Id = await mk(M2, "根部门成员", ar!.id);
const admin = (await loadActor(adminId))!;
const root = await orgSvc.createDepartment(admin, { name: `项目部门${SUFFIX}` });
const child = await orgSvc.createDepartment(admin, { name: `项目子部门${SUFFIX}`, parentId: root!.id });
await orgSvc.assignMemberOrganization(admin, m1Id, { departmentId: child!.id });
await orgSvc.assignMemberOrganization(admin, m2Id, { departmentId: root!.id });
const proj = await projectService.createProject(admin, { key: `PD${SUFFIX}`, name: "带部门项目", departmentId: child!.id } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
let tmpProjId = "";
try {
  const H = await login(ADMIN);
  const detail = await (await fetch(`${BASE}/api/v1/projects/${proj.id}`, { headers: { cookie: H.cookie } })).json() as { departmentId: string; department: { name: string } };
  ok("项目详情返回归属部门", detail.departmentId === child!.id && detail.department.name === `项目子部门${SUFFIX}`, JSON.stringify(detail));
  const list = await (await fetch(`${BASE}/api/v1/projects?pageSize=100`, { headers: { cookie: H.cookie } })).json() as { items: { id: string; departmentName: string | null }[] };
  ok("项目列表返回部门名", list.items.find((p) => p.id === proj.id)?.departmentName === `项目子部门${SUFFIX}`);

  const patch = await fetch(`${BASE}/api/v1/projects/${proj.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ departmentId: root!.id }) });
  ok("项目改归属部门 200", patch.status === 200, String(patch.status));
  const after = await (await fetch(`${BASE}/api/v1/projects/${proj.id}`, { headers: { cookie: H.cookie } })).json() as { departmentId: string };
  ok("项目归属已更新", after.departmentId === root!.id);
  ok("无效部门 → 400", (await fetch(`${BASE}/api/v1/projects/${proj.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ departmentId: "11111111-1111-1111-1111-111111111111" }),
  })).status === 400);

  const filteredChild = await (await fetch(`${BASE}/api/v1/members?departmentId=${child!.id}`, { headers: { cookie: H.cookie } })).json() as { members: { id: string }[] };
  ok("成员部门筛选（子部门）只含 1 人", filteredChild.members.length === 1 && filteredChild.members[0]!.id === m1Id, JSON.stringify(filteredChild.members.map((m) => m.id)));
  const filteredRoot = await (await fetch(`${BASE}/api/v1/members?departmentId=${root!.id}`, { headers: { cookie: H.cookie } })).json() as { members: { id: string }[] };
  ok("成员部门筛选（根部门含子部门）含 2 人", filteredRoot.members.length === 2, String(filteredRoot.members.length));
  const all = await (await fetch(`${BASE}/api/v1/members`, { headers: { cookie: H.cookie } })).json() as { members: { id: string }[] };
  ok("无筛选返回全部（>=3）", all.members.length >= 3, String(all.members.length));

  const p2 = await projectService.createProject(admin, { key: `PD2${SUFFIX}`, name: "可清理项目" } as never);
  tmpProjId = p2.id;
  ok("无部门项目 department 为空", (await (await fetch(`${BASE}/api/v1/projects/${p2.id}`, { headers: { cookie: H.cookie } })).json() as { department: null }).department === null);
} finally {
  await app.close();
  await db.delete(project).where(eq(project.departmentId, root!.id)).catch(() => {});
  await db.delete(project).where(eq(project.id, proj.id)).catch(() => {});
  if (tmpProjId) await db.delete(project).where(eq(project.id, tmpProjId)).catch(() => {});
  await db.delete(department).where(eq(department.id, child!.id)).catch(() => {});
  await db.delete(department).where(eq(department.id, root!.id)).catch(() => {});
  await db.delete(auditEntry);
  for (const u of [ADMIN, M1, M2]) await deleteTestMember(u);
  void adminId;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
