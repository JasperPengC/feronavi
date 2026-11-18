import "./_env.ts";   // 环境预设必须最先加载
/**
 * 团队自检（Round 25 长任务第 44 项，数据模型 1.2 / REST 第 3 节）：
 * 树列表、建/改名/移动、防环（C-12）、同级重名、删除约束（有子团队/有成员）、成员含子团队展开、权限。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment, team } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as teamService from "../src/server/services/team.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "team-admin";
const MEMBER = "team-member";
const GUEST = "team-guest";
const PW = "team-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, MEMBER, GUEST]) await deleteTestMember(u);
await db.delete(team);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "团队管理员", ar!.id);
const memberId = await mk(MEMBER, "团队成员", mr!.id);
await mk(GUEST, "团队普通成员", mr!.id);
const admin = (await loadActor(adminId))!;
const guest = (await loadActor((await db.select({ id: member.id }).from(member).where(eq(member.username, GUEST)))[0]!.id))!;

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return {
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json",
  };
};
try {
  // ① 建三层树
  const root = await teamService.createTeam(admin, { name: "研发中心" });
  const fe = await teamService.createTeam(admin, { name: "前端组", parentId: root.id });
  const be = await teamService.createTeam(admin, { name: "后端组", parentId: root.id });
  ok("建树成功（根 + 两子）", !!root.id && fe.parentId === root.id && be.parentId === root.id);
  ok("同级重名 → 409", await (async () => {
    try { await teamService.createTeam(admin, { name: "前端组", parentId: root.id }); return false; }
    catch (e) { return (e as { code?: string }).code === "CONFLICT"; }
  })());

  // ② 列表树形结构
  const tree = await teamService.listTeams(admin);
  const rootNode = tree.find((t) => t.id === root.id);
  ok("树列表含子团队", !!rootNode && rootNode.children.length === 2 && rootNode.children.some((c) => c.id === fe.id),
    JSON.stringify(rootNode?.children.map((c) => c.name)));

  // ③ 改名 + 移动
  const renamed = await teamService.updateTeam(admin, fe.id, { name: "前端平台组" });
  ok("改名成功", renamed.name === "前端平台组");
  await teamService.updateTeam(admin, be.id, { parentId: fe.id });
  const tree2 = await teamService.listTeams(admin);
  ok("移动后后端组在前端组下面", tree2.find((t) => t.id === root.id)?.children.find((c) => c.id === fe.id)?.children.some((c) => c.id === be.id) === true);

  // ④ 防环（C-12）：把根挂到孙子下 → 400
  ok("父级位于子树内 → 400", await (async () => {
    try { await teamService.updateTeam(admin, root.id, { parentId: be.id }); return false; }
    catch (e) { return (e as { code?: string }).code === "VALIDATION"; }
  })());
  ok("挂到自己下面 → 400", await (async () => {
    try { await teamService.updateTeam(admin, root.id, { parentId: root.id }); return false; }
    catch (e) { return (e as { code?: string }).code === "VALIDATION"; }
  })());

  // ⑤ 成员展开（含子团队）：给后端组挂一个 TEAM 角色
  await db.insert(roleAssignment).values({ memberId, roleId: mr!.id, scopeType: "TEAM", scopeId: be.id });
  const members = await teamService.listTeamMembers(admin, root.id);
  ok("团队成员含子团队展开", members.members.some((m) => m.id === memberId) && members.teamIds.length === 3,
    JSON.stringify({ n: members.members.length, teams: members.teamIds.length }));
  ok("根团队自身 memberCount 不含孙团队？按 team 行计数（0）", members.members.length === 1);

  // ⑥ 删除约束
  ok("有子团队不能删 → 409", await (async () => {
    try { await teamService.deleteTeam(admin, root.id); return false; }
    catch (e) { return (e as { code?: string }).code === "CONFLICT"; }
  })());
  ok("有成员不能删 → 409", await (async () => {
    try { await teamService.deleteTeam(admin, be.id); return false; }
    catch (e) { return (e as { code?: string }).code === "CONFLICT"; }
  })());

  // ⑦ 权限：普通成员可读、不可写
  ok("普通成员可读团队列表", (await teamService.listTeams(guest)).length >= 1);
  ok("普通成员建团队 → 403", await (async () => {
    try { await teamService.createTeam(guest, { name: "越权团队" }); return false; }
    catch (e) { return (e as { code?: string }).code === "FORBIDDEN"; }
  })());

  // ⑧ HTTP 端点
  const H = await login(ADMIN);
  const listRes = await fetch(`${BASE}/api/v1/teams`, { headers: { cookie: H.cookie } });
  ok("HTTP GET /teams 200", listRes.status === 200);
  const createdRes = await fetch(`${BASE}/api/v1/teams`, {
    method: "POST", headers: H, body: JSON.stringify({ name: "HTTP 团队", parentId: root.id }),
  });
  ok("HTTP POST /teams 201", createdRes.status === 201, String(createdRes.status));
  const G = await login(GUEST);
  ok("HTTP POST /teams 无权限 → 403", (await fetch(`${BASE}/api/v1/teams`, {
    method: "POST", headers: G, body: JSON.stringify({ name: "x" }),
  })).status === 403);
  const membersRes = await fetch(`${BASE}/api/v1/teams/${root.id}/members`, { headers: { cookie: H.cookie } });
  ok("HTTP GET /teams/:id/members 200", membersRes.status === 200);

  // ⑨ 清理顺序：先移除成员指派，再逐层删
  await db.delete(roleAssignment).where(eq(roleAssignment.scopeType, "TEAM"));
  // ⚠️ 不能依赖 orderBy(parentId) 的 UUID 顺序（随机 UUID 可能先删有子节点的父级 → 误判失败）：
  //    反复尝试"删得掉的叶子"，直到无进展，再断言为空。
  for (let guard = 0; guard < 50; guard++) {
    const before = (await db.select({ id: team.id }).from(team)).length;
    if (before === 0) break;
    let progressed = false;
    for (const t of await db.select({ id: team.id }).from(team)) {
      try { await teamService.deleteTeam(admin, t.id); progressed = true; } catch { /* 仍有子节点：下一轮 */ }
    }
    if (!progressed) break;
  }
  ok("逐层删除后团队表为空", (await db.select({ id: team.id }).from(team)).length === 0);
} finally {
  await app.close();
  await db.delete(roleAssignment).where(eq(roleAssignment.scopeType, "TEAM"));
  await db.delete(team);
  await db.delete(auditEntry);
  for (const u of [ADMIN, MEMBER, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
