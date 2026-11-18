import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 业务事件审计/活动第二批自检（Round 25 长任务第 3 项）：
 * 角色与授权、项目创建、计划实体（里程碑/迭代/版本/模块）、公告发送/撤回
 * 都要写 audit_entry（相应 severity）+ activity_entry（项目时间线）。
 *
 * 真实服务调用 + 真实库校验，不 mock。
 */
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, announcement, auditEntry, member, notification, project, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as roleService from "../src/server/services/role.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import * as announcementService from "../src/server/services/announcement.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN_USER = "aud2-admin";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
const PROJ_KEY = `AUD2${SUFFIX}`;
const ROLE_SLUG = `aud2-role-${SUFFIX}`.toLowerCase();

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ── 准备管理员 ──
await db.delete(member).where(eq(member.username, ADMIN_USER));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
if (!ar) throw new Error("种子未跑：找不到 ADMIN 角色");
const [adminRow] = await db.insert(member).values({
  username: ADMIN_USER, email: "aud2@x.test", name: "二批审计员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword("aud2-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });

let projectId = "";
let customRoleId = "";
let assignmentId = "";
let milestoneId = "";
let announcementId = "";
try {
  // ① 项目创建 → 审计 + 活动
  const proj = await projectService.createProject(admin, { key: PROJ_KEY, name: "二批审计项目" } as never);
  projectId = proj.id;
  ok("项目创建成功", !!projectId);

  // ② 角色与授权（安全审计）
  const roleView = await roleService.createRole(admin, { slug: ROLE_SLUG, name: "二批审计角色", permissionKeys: [] });
  customRoleId = roleView.id;
  await roleService.updateRole(admin, customRoleId, { name: "二批审计角色（改）" });
  const assignment = await roleService.createRoleAssignment(admin, {
    memberId: admin.memberId, roleId: customRoleId, scopeType: "ORG", scopeId: null,
  } as never);
  assignmentId = assignment.id;
  await roleService.deleteRoleAssignment(admin, assignmentId);
  assignmentId = "";
  await roleService.deleteRole(admin, customRoleId);
  customRoleId = "";
  ok("角色与授权流程跑通", true);

  // ③ 计划实体：创建里程碑 + 归档 + 取消归档
  const ms = await planningService.createPlan(admin, projectId, "milestone", { name: "二批审计里程碑", dueDate: "2026-12-31" });
  milestoneId = ms.id;
  await planningService.archive(admin, milestoneId, "milestone");
  await planningService.unarchive(admin, milestoneId, "milestone");
  ok("里程碑创建/归档/取消归档跑通", true);

  // ④ 公告：发送 + 撤回
  const ann = await announcementService.sendAnnouncement(admin, { title: `二批审计公告 ${SUFFIX}`, body: "内容", severity: "INFO" });
  announcementId = ann.id;
  await announcementService.revokeAnnouncement(admin, announcementId);
  ok("公告发送/撤回跑通", true);

  // ── 库内校验：审计 ──
  const audits = await db.select().from(auditEntry);
  const has = (action: string) => audits.some((a) => a.action === action);
  ok("项目创建写审计", has("project.created"));
  for (const a of ["role.created", "role.updated", "role.granted", "role.revoked", "role.deleted"]) {
    ok(`角色/授权写审计：${a}`, has(a));
  }
  ok("公告发送/撤回写审计", has("announcement.sent") && has("announcement.revoked"));
  ok("角色审计为 SECURITY 级", audits.filter((a) => a.action.startsWith("role.")).every((a) => a.severity === "SECURITY"));
  ok("审计不含敏感材料", !/aud2-password|fero_/i.test(JSON.stringify(audits.map((a) => ({ c: a.changes, s: a.actorSnapshot })))));

  // ── 库内校验：活动时间线 ──
  const acts = await db.select().from(activityEntry);
  const summaries = acts.map((a) => a.summary);
  ok("项目创建写活动", summaries.some((x) => x.includes(PROJ_KEY) && x.includes("创建了项目")));
  ok("里程碑创建写活动", summaries.some((x) => x.includes("二批审计里程碑") && x.includes("创建了里程碑")));
  ok("里程碑归档/取消归档写活动",
    summaries.some((x) => x.includes("二批审计里程碑") && x.includes("归档了里程碑"))
    && summaries.some((x) => x.includes("取消了里程碑")));
  ok("公告发送/撤回写活动",
    summaries.some((x) => x.includes("发布了公告")) && summaries.some((x) => x.includes("撤回了公告")));
  ok("活动归属项目正确（里程碑事件带 projectId）",
    acts.some((a) => a.projectId === projectId && a.action.startsWith("plan.milestone")));

  // ── HTTP 项目活动端点返回这些事件 ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: "aud2-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const actApi = await fetch(`${BASE}/api/v1/projects/${projectId}/activity?pageSize=50`, { headers: { cookie } });
  const actBody = await actApi.json() as { items?: { summary: string }[] };
  ok("项目活动端点可读且包含里程碑事件",
    actApi.status === 200 && (actBody.items ?? []).some((i) => i.summary.includes("二批审计里程碑")),
    `${actApi.status} ${JSON.stringify((actBody.items ?? []).slice(0, 2))}`);
} finally {
  await app.close();
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  if (announcementId) {
    await db.delete(notification).where(eq(notification.groupKey, `announcement:${announcementId}`));
    await db.delete(announcement).where(eq(announcement.id, announcementId));
  }
  if (assignmentId) await db.delete(roleAssignment).where(eq(roleAssignment.id, assignmentId));
  if (customRoleId) await db.delete(role).where(eq(role.id, customRoleId));
  if (milestoneId) {
    const { milestone } = await import("../src/db/schema.ts");
    await db.delete(milestone).where(eq(milestone.id, milestoneId));
  }
  if (projectId) {
    await db.delete(project).where(eq(project.id, projectId));
  }
  await db.delete(member).where(eq(member.username, ADMIN_USER));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
