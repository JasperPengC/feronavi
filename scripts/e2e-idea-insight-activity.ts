import "./_env.ts";   // 环境预设必须最先加载
/**
 * 想法与洞察配置的活动覆盖自检（Round 25 长任务第 33 项）：
 * 想法创建/更新/删除、项目看板与挂件的增改删都要进项目时间线；全局看板只写审计不写项目活动。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, dashboard, dashboardWidget, idea, member, project, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as ideaService from "../src/server/services/idea.service.ts";
import * as insightService from "../src/server/services/insight.service.ts";
import { eq } from "drizzle-orm";

const ADMIN = "ii-admin";
const PW = "ii-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(ADMIN);
await db.delete(activityEntry);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "ii@x.test", name: "想法洞察员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: `II${SUFFIX}`, name: "想法洞察项目" } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
let dashboardId = "";
try {
  // ① 想法：创建 → 更新 → 删除
  const created = await ideaService.createIdea(admin, proj.id, { title: "想法活动验收", description: "描述" });
  await ideaService.updateIdea(admin, created!.id, { title: "想法活动验收（改）", status: "UNDER_REVIEW" });
  await ideaService.deleteIdea(admin, created!.id);

  // ② 项目看板：创建 → 加挂件 → 更新挂件 → 更新看板 → 删挂件 → 删看板
  const dash = await insightService.createDashboard(admin, { name: "看板活动验收", projectId: proj.id });
  dashboardId = dash.id;
  const widget = await insightService.addWidget(admin, dash.id, { type: "COUNT", config: {}, sortOrder: 1 });
  await insightService.updateWidget(admin, widget.id, { sortOrder: 2 });
  await insightService.updateDashboard(admin, dash.id, { name: "看板活动验收（改）" });
  await insightService.deleteWidget(admin, widget.id);
  await insightService.deleteDashboard(admin, dash.id);

  // ③ 全局看板：只写审计、不写项目活动（projectId=null）
  const global = await insightService.createDashboard(admin, { name: "全局看板验收" });
  await insightService.deleteDashboard(admin, global.id);

  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, proj.id));
  const ofAct = (a: string) => acts.filter((x) => x.action === a);
  ok("想法创建/更新/删除写活动",
    ofAct("idea.created").length === 1 && ofAct("idea.updated").length === 1 && ofAct("idea.deleted").length === 1,
    JSON.stringify(acts.map((x) => x.action)));
  ok("看板创建/更新/删除写活动",
    ofAct("insight.dashboard_created").length === 1 && ofAct("insight.dashboard_updated").length === 1
    && ofAct("insight.dashboard_deleted").length === 1);
  ok("挂件增加/更新/删除写活动",
    ofAct("insight.widget_added").length === 1 && ofAct("insight.widget_updated").length === 1
    && ofAct("insight.widget_deleted").length === 1);
  ok("活动摘要可读且含名称", acts.some((x) => x.summary.includes("想法活动验收")) && acts.some((x) => x.summary.includes("看板活动验收")),
    JSON.stringify(acts.slice(0, 2).map((x) => x.summary)));
  ok("全局看板不写项目活动（仅审计）", !acts.some((x) => x.summary.includes("全局看板")));

  const audits = (await db.select().from(auditEntry)).filter((x) => x.action.startsWith("insight.") || x.action.startsWith("idea."));
  ok("想法与洞察动作均写审计（BUSINESS）",
    audits.some((a) => a.action === "idea.created") && audits.some((a) => a.action === "insight.dashboard_created")
    && audits.every((a) => a.severity === "BUSINESS"),
    JSON.stringify(audits.map((a) => a.action)));
} finally {
  await app.close();
  if (dashboardId) {
    await db.delete(dashboardWidget).where(eq(dashboardWidget.dashboardId, dashboardId));
    await db.delete(dashboard).where(eq(dashboard.id, dashboardId));
  }
  await db.delete(dashboard).where(eq(dashboard.projectId, proj.id));
  await db.delete(idea).where(eq(idea.projectId, proj.id));
  await db.delete(activityEntry);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  await deleteTestMember(ADMIN);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
