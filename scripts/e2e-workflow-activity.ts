import "./_env.ts";   // 环境预设必须最先加载
/**
 * 工作流配置变更的活动记录自检（Round 25 长任务第 10 项）
 * 创建/改名工作流、增改归档状态、增删迁移，都要写项目活动（可在活动页按「工作流」筛选）。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, member, project, role, roleAssignment, workflow, workflowState, workflowTransition } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wfService from "../src/server/services/workflow-config.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const USER = "wf-act-admin";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
const KEY = `WFA${SUFFIX}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(USER);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: USER, email: "wf-act@x.test", name: "工作流活动员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword("wf-act-pass-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: KEY, name: "工作流活动项目" } as never);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });

let wfId = "";
let newStateId: string;
try {
  // ① 创建工作流（项目副本之外新建一个）
  const wf = await wfService.createWorkflow(admin, { projectId: proj.id, name: "验收工作流", appliesToType: "TASK" });
  wfId = wf.id;
  await wfService.updateWorkflow(admin, wfId, { name: "验收工作流（改）" });

  // ② 状态：新增 → 改名 → 归档
  const st = await wfService.addState(admin, wfId, { key: "ACCEPT", name: "验收状态", category: "IN_PROGRESS" });
  newStateId = st.id;
  await wfService.updateState(admin, wfId, newStateId, { name: "验收状态（改）" });

  // ③ 迁移：先直接插一个起始状态（不经过服务，避免多一条 state_added 干扰计数），
  //    再从它连到新状态，再删掉这条迁移
  const [startState] = await db.insert(workflowState).values({
    workflowId: wfId, key: "START", name: "起始状态", category: "NOT_STARTED", color: "#71717a", sortOrder: 1,
  }).returning({ id: workflowState.id });
  const tr = await wfService.addTransition(admin, wfId, { fromStateId: startState!.id, toStateId: newStateId });
  await wfService.removeTransition(admin, wfId, tr.id);
  await wfService.archiveState(admin, wfId, newStateId);

  // ── 库内校验 ──
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, proj.id));
  const byAction = (a: string) => acts.filter((x) => x.action === a);
  const sums = acts.map((a) => a.summary);
  ok("创建工作流写活动", byAction("workflow.created").length === 1 && sums.some((s) => s.includes("验收工作流") && s.includes("创建了工作流")));
  ok("工作流改名写活动", byAction("workflow.updated").length === 1 && sums.some((s) => s.includes("更新了工作流")));
  ok("状态新增/改名/归档写活动",
    byAction("workflow.state_added").length === 1
    && byAction("workflow.state_updated").length === 1
    && byAction("workflow.state_archived").length === 1
    && sums.some((s) => s.includes("新增状态") && s.includes("验收状态"))
    && sums.some((s) => s.includes("更新了工作流") && s.includes("验收状态"))
    && sums.some((s) => s.includes("归档了工作流") && s.includes("验收状态（改）")));
  ok("迁移新增/删除写活动",
    byAction("workflow.transition_added").length === 1
    && byAction("workflow.transition_removed").length === 1
    && sums.some((s) => s.includes("新增迁移"))
    && sums.some((s) => s.includes("移除了工作流") && s.includes("迁移")));
  ok("活动归属项目正确", acts.every((a) => a.projectId === proj.id));

  // ── HTTP 活动端点 category=workflow 可见 ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: "wf-act-pass-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const api = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity?pageSize=100&category=workflow`, { headers: { cookie } });
  const body = await api.json() as { items?: { action: string }[]; total?: number };
  ok("活动端点 category=workflow 返回全部 7 个事件",
    api.status === 200 && (body.total ?? 0) === 7
    && ["workflow.created", "workflow.updated", "workflow.state_added", "workflow.state_updated", "workflow.state_archived", "workflow.transition_added", "workflow.transition_removed"]
      .every((a) => (body.items ?? []).some((x) => x.action === a)),
    `${api.status} ${JSON.stringify(body.items?.map((x) => x.action))}`);
} finally {
  await app.close();
  await db.delete(activityEntry).where(eq(activityEntry.projectId, proj.id));
  if (wfId) {
    await db.delete(workflowTransition).where(eq(workflowTransition.workflowId, wfId));
    await db.delete(workflowState).where(eq(workflowState.workflowId, wfId));
    await db.delete(workflow).where(eq(workflow.id, wfId));
  }
  await db.delete(project).where(eq(project.id, proj.id));
  await deleteTestMember(USER);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
