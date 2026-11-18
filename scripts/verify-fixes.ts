import "./_env.ts";
/** 验证两个迭代修复：ProjectMembership 回落 + 工作项计数 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, projectMembership, workItem , auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor, loadPermissionContext } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as projectRepo from "../src/server/repos/project.repo.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const OWNER = "fx-owner", PEER = "fx-peer";
await db.delete(auditEntry);
await db.delete(activityEntry);

await db.delete(member).where(eq(member.username, OWNER));
await db.delete(member).where(eq(member.username, PEER));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [gr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));

const [o] = await db.insert(member).values({
  username: OWNER, email: "fo@x.test", name: "Owner", status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("fx-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: o!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const owner = (await loadActor(o!.id))!;

await db.delete(project).where(eq(project.key, "FXPROJ"));
const { id: projectId } = await projectService.createProject(owner, { key: "FXPROJ", name: "修复验证" });

try {
  // ── ① 工作项计数 ──────────────────────────────────────────
  for (let i = 0; i < 3; i++) await wiService.createWorkItem(owner, projectId, { type: "TASK", title: `任务 ${i}` });
  const counts = await projectRepo.countWorkItemsByProject([projectId]);
  ok("工作项计数 = 3", counts.get(projectId) === 3, String(counts.get(projectId)));

  // 软删后计数应减少
  const wi = await wiService.createWorkItem(owner, projectId, { type: "TASK", title: "要删的" });
  await wiService.deleteWorkItem(owner, wi.id);
  const counts2 = await projectRepo.countWorkItemsByProject([projectId]);
  ok("软删后计数不增加（仍 3）", counts2.get(projectId) === 3, String(counts2.get(projectId)));

  // ── ② ProjectMembership 回落路径 ──────────────────────────
  const [p] = await db.insert(member).values({
    username: PEER, email: "fp@x.test", name: "Peer", status: "ACTIVE", timezone: "Asia/Shanghai",
    passwordHash: await hashPassword("fx-password-1234"),
  }).returning({ id: member.id });
  // 只有 GUEST 组织级角色，**没有**该项目的 role_assignment
  await db.insert(roleAssignment).values({ memberId: p!.id, roleId: gr!.id, scopeType: "ORG", scopeId: null });
  await db.insert(projectMembership).values({ projectId, memberId: p!.id, roleId: gr!.id });
  const peer = (await loadActor(p!.id))!;
  const ctx = await loadPermissionContext(p!.id);

  ok("回落路径：memberProjectIds 含该项目", ctx.memberProjectIds.has(projectId),
    JSON.stringify([...ctx.memberProjectIds]));
  ok("该成员没有该项目的显式 role_assignment",
    !peer.grants.some((g) => g.scopeType === "PROJECT" && g.scopeId === projectId));

  // 无 membership 的成员不应命中
  const [lonely] = await db.insert(member).values({
    username: "fx-lonely", email: "fl@x.test", name: "Lonely", status: "ACTIVE",
    passwordHash: await hashPassword("fx-password-1234"),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: lonely!.id, roleId: gr!.id, scopeType: "ORG", scopeId: null });
  const ctx2 = await loadPermissionContext(lonely!.id);
  ok("无 membership 的成员不命中", !ctx2.memberProjectIds.has(projectId));

  // 用它验证「可见性」：peer 能看见该项目
  const visible = await projectRepo.isVisibleTo(p!.id, projectId, false);
  ok("有 membership 的成员看得见该项目", visible === true);
  const notVisible = await projectRepo.isVisibleTo(lonely!.id, projectId, false);
  ok("无 membership 的成员看不见", notVisible === false);
  await db.delete(member).where(eq(member.username, "fx-lonely"));
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, "FXPROJ"));
  await db.delete(member).where(eq(member.username, OWNER));
  await db.delete(member).where(eq(member.username, PEER));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
