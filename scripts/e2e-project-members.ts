import "./_env.ts";   // 环境预设必须最先加载
/**
 * 项目成员与邀请项目角色自检（Round 25 长任务第 54 项，REST 第 5 节）：
 * 加/移除项目成员（membership + PROJECT role_assignment 同步）、重复加更新角色、权限；
 * 邀请绑定项目角色 → 接受后成为项目成员且项目可见。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, invite, member, project, projectMembership, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "pm-admin";
const MEMBER = "pm-member";
const INVITED = `pm-invited-${Date.now().toString(36).slice(-5)}`;
const PW = "pm-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, MEMBER, INVITED]) await deleteTestMember(u);
await db.delete(invite);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id, key: role.key }).from(role).where(eq(role.key, "MEMBER"));
const [pmrole] = await db.select({ id: role.id, key: role.key }).from(role).where(eq(role.key, "PM"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "项目成员管理员", ar!.id);
const memberId = await mk(MEMBER, "项目普通成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `PM${SUFFIX}`, name: "项目成员项目" } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string, password = PW) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await r.json() as { csrfToken?: string };
  return {
    status: r.status,
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": body.csrfToken ? decodeURIComponent(body.csrfToken) : "", "content-type": "application/json",
  };
};
let invitedId = "";
try {
  const H = await login(ADMIN);
  // ① 加成员 + 项目级角色（两个载体同事务）
  const added = await fetch(`${BASE}/api/v1/projects/${proj.id}/members`, {
    method: "POST", headers: H, body: JSON.stringify({ memberId, roleId: mr!.id }),
  });
  ok("POST 项目成员 201", added.status === 201, String(added.status));
  const membership = (await db.select().from(projectMembership).where(eq(projectMembership.projectId, proj.id)))
    .find((m) => m.memberId === memberId);
  const assignment = (await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, memberId))).find((a) => a.scopeType === "PROJECT");
  ok("membership 与 PROJECT role_assignment 都写入", membership?.memberId === memberId && assignment?.scopeId === proj.id,
    JSON.stringify({ membership: membership?.memberId, assignment: assignment?.scopeId }));
  const listed = (await (await fetch(`${BASE}/api/v1/projects/${proj.id}/members`, { headers: { cookie: H.cookie } })).json() as { members: { id: string }[] }).members;
  ok("项目成员列表包含该成员", listed.some((m) => m.id === memberId));

  // ② 重复加 + 换角色 → 更新而非重复
  const readd = await fetch(`${BASE}/api/v1/projects/${proj.id}/members`, {
    method: "POST", headers: H, body: JSON.stringify({ memberId, roleId: pmrole!.id }),
  });
  const memberships = (await db.select().from(projectMembership).where(eq(projectMembership.projectId, proj.id)))
    .filter((m) => m.memberId === memberId);
  const projectAssigns = (await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, memberId)))
    .filter((a) => a.scopeType === "PROJECT" && a.scopeId === proj.id);
  ok("重复加成员不产生重复行、角色更新且旧 PROJECT 指派被替换", readd.status === 201 && memberships.length === 1
    && memberships[0]!.roleId === pmrole!.id && projectAssigns.length === 1 && projectAssigns[0]!.roleId === pmrole!.id,
    JSON.stringify({ memberships: memberships.map((m) => ({ member: m.memberId, role: m.roleId })), assigns: projectAssigns.map((a) => a.roleId) }));

  // ③ 权限
  // 用 GUEST（MEMBER 角色本身可能含 project:manage_member 之外的权限，GUEST 更严格）
  const [guestRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
  const guestUsername = "pm-guest";
  await deleteTestMember(guestUsername);
  await mk(guestUsername, "项目访客", guestRole!.id);
  const G = await login(guestUsername);
  ok("无 project:manage_member 加成员 → 403", (await fetch(`${BASE}/api/v1/projects/${proj.id}/members`, {
    method: "POST", headers: G, body: JSON.stringify({ memberId: adminId, roleId: mr!.id }),
  })).status === 403);

  // ④ 邀请绑定项目角色 → 接受后成为项目成员且项目可见
  const inv = await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H,
    body: JSON.stringify({ email: `${INVITED}@x.test`, projectId: proj.id, projectRoleIds: [pmrole!.id] }),
  });
  const invBody = await inv.json() as { token: string };
  ok("创建带项目角色的邀请 201", inv.status === 201 && !!invBody.token, String(inv.status));
  const accept = await fetch(`${BASE}/api/v1/invites/${invBody.token}/accept`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: INVITED, name: "受邀项目成员", password: PW }),
  });
  const acceptBody = await accept.json() as { id: string };
  invitedId = acceptBody.id;
  ok("接受邀请 201", accept.status === 201 && !!invitedId, String(accept.status));
  const invMembership = (await db.select().from(projectMembership).where(eq(projectMembership.projectId, proj.id)))
    .find((m) => m.memberId === invitedId);
  ok("受邀成员写入 project_membership", invMembership?.memberId === invitedId, JSON.stringify(invMembership?.memberId));
  const invLogin = await login(INVITED);
  const visibleProjects = await (await fetch(`${BASE}/api/v1/projects`, { headers: { cookie: invLogin.cookie } })).json() as { items: { id: string }[] };
  ok("受邀成员能看见该项目（数据范围生效）", visibleProjects.items.some((p) => p.id === proj.id), JSON.stringify(visibleProjects.items.map((p) => p.id)));

  // ⑤ 移除成员（两个载体同时清理）
  const removed = await fetch(`${BASE}/api/v1/projects/${proj.id}/members/${memberId}`, {
    method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] },
  });
  const left = await db.select().from(projectMembership).where(eq(projectMembership.projectId, proj.id));
  const leftAssign = (await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, memberId))).filter((a) => a.scopeType === "PROJECT");
  ok("DELETE 移除成员并清理 membership/role_assignment", removed.status === 200
    && !left.some((m) => m.memberId === memberId) && leftAssign.length === 0, JSON.stringify({ left: left.length, assigns: leftAssign.length }));
  ok("移除后项目成员列表不再包含", !(await (await fetch(`${BASE}/api/v1/projects/${proj.id}/members`, { headers: { cookie: H.cookie } })).json() as { members: { id: string }[] }).members.some((m) => m.id === memberId));
} finally {
  await app.close();
  await db.delete(invite);
  await db.delete(projectMembership).where(eq(projectMembership.projectId, proj.id));
  if (invitedId) {
    await db.delete(roleAssignment).where(eq(roleAssignment.memberId, invitedId));
    await db.delete(activityEntry).where(eq(activityEntry.actorId, invitedId));
    await db.delete(auditEntry).where(eq(auditEntry.actorId, invitedId));
    await db.delete(member).where(eq(member.id, invitedId));
  }
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await deleteTestMember("pm-guest");
  for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
