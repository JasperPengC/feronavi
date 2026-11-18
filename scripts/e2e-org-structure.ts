import "./_env.ts";   // 环境预设必须最先加载
/** 组织架构（Round 66 对标）：部门树/职位/成员归属/归档与权限自检 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, department, member, position, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "og-admin";
const GUEST = "og-guest";
const PW = "og-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "组织管理员", ar!.id);
const guestId = await mk(GUEST, "组织成员", mr!.id);
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
const H = await login(ADMIN);
const G = await login(GUEST);
// DELETE 无请求体：不要带 content-type: application/json（Fastify 会因空 body 报 400）
const Hd = { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] };
const Gd = { cookie: G.cookie, "x-csrf-token": G["x-csrf-token"] };
const api = (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, init);
let rootId = "", childId = "", posId = "";
const STAMP = Date.now().toString(36).slice(-5);
try {
  const createdRoot = await api("/api/v1/departments", { method: "POST", headers: H, body: JSON.stringify({ name: `研发部${STAMP}` }) });
  const root = await createdRoot.json() as { id: string };
  rootId = root.id;
  ok("创建顶级部门 201", createdRoot.status === 201);
  const createdChild = await api("/api/v1/departments", { method: "POST", headers: H, body: JSON.stringify({ name: `平台组${STAMP}`, parentId: rootId }) });
  const child = await createdChild.json() as { id: string; parentId: string };
  childId = child.id;
  ok("创建子部门且 parentId 正确", createdChild.status === 201 && child.parentId === rootId);

  const dup = await api("/api/v1/departments", { method: "POST", headers: H, body: JSON.stringify({ name: `平台组${STAMP}`, parentId: rootId }) });
  ok("同级重名 → 409", dup.status === 409, String(dup.status));
  const cycle = await api(`/api/v1/departments/${rootId}`, { method: "PATCH", headers: H, body: JSON.stringify({ parentId: childId }) });
  ok("把父部门挂到子部门下 → 400（环检测）", cycle.status === 400, String(cycle.status));

  const p = await api("/api/v1/positions", { method: "POST", headers: H, body: JSON.stringify({ name: `后端工程师${STAMP}`, code: `BE-${STAMP}`, departmentId: childId }) });
  const pos = await p.json() as { id: string };
  posId = pos.id;
  ok("创建职位（挂子部门）201", p.status === 201);

  const assign = await api(`/api/v1/members/${adminId}/organization`, { method: "PATCH", headers: H, body: JSON.stringify({ departmentId: childId, positionId: posId }) });
  ok("成员归属部门+职位 200", assign.status === 200, String(assign.status));
  const members = await (await api("/api/v1/members", { headers: { cookie: H.cookie } })).json() as { members: { id: string; departmentName: string | null; positionName: string | null }[] };
  const me = members.members.find((m) => m.id === adminId);
  ok("成员列表返回部门/职位名称", me?.departmentName === `平台组${STAMP}` && me?.positionName === `后端工程师${STAMP}`, JSON.stringify(me));
  const detail = await (await api(`/api/v1/members/${adminId}`, { headers: { cookie: H.cookie } })).json() as { departmentName: string; positionName: string };
  ok("成员详情返回部门/职位名称", detail.departmentName === `平台组${STAMP}` && detail.positionName === `后端工程师${STAMP}`);

  const deptList = await (await api("/api/v1/departments", { headers: { cookie: H.cookie } })).json() as { departments: { id: string; memberCount: number }[] };
  ok("部门列表含直属成员计数", deptList.departments.find((d) => d.id === childId)?.memberCount === 1, JSON.stringify(deptList.departments));

  ok("成员无权写部门 → 403", (await api("/api/v1/departments", { method: "POST", headers: G, body: JSON.stringify({ name: "越权部门" }) })).status === 403);
  ok("成员无权删部门 → 403", (await api(`/api/v1/departments/${rootId}`, { method: "DELETE", headers: Gd })).status === 403);
  const archiveRootBlocked = await api(`/api/v1/departments/${rootId}`, { method: "DELETE", headers: Hd });
  ok("有活跃子部门时归档父部门 → 409", archiveRootBlocked.status === 409, String(archiveRootBlocked.status));

  await api(`/api/v1/positions/${posId}`, { method: "DELETE", headers: Hd });
  const afterPos = await (await api("/api/v1/members", { headers: { cookie: H.cookie } })).json() as { members: { id: string; positionId: string | null }[] };
  ok("归档职位后成员职位置空", afterPos.members.find((m) => m.id === adminId)?.positionId === null);
  await api(`/api/v1/departments/${childId}`, { method: "DELETE", headers: Hd });
  await api(`/api/v1/departments/${rootId}`, { method: "DELETE", headers: Hd });
  const afterDept = await (await api("/api/v1/members", { headers: { cookie: H.cookie } })).json() as { members: { id: string; departmentId: string | null }[] };
  ok("归档部门后成员部门置空", afterDept.members.find((m) => m.id === adminId)?.departmentId === null);
  const auditRows = await db.select().from(auditEntry);
  ok("组织变更写审计", auditRows.some((a) => a.action.startsWith("department.")) && auditRows.some((a) => a.action.startsWith("position.")));
} finally {
  await app.close();
  await db.delete(position).where(eq(position.id, posId)).catch(() => {});
  await db.delete(department).where(eq(department.id, childId)).catch(() => {});
  await db.delete(department).where(eq(department.id, rootId)).catch(() => {});
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  void guestId;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
