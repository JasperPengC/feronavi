import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 工作流配置自检（W6，REST 7 节） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workflow, workItem, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as svc from "../src/server/services/workflow-config.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w6-admin";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w6@x.test", name: "配置员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w6-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;

const KEY = "W6PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(admin, { key: KEY, name: "W6 项目" });

try {
  // ── 列表：平台模板可见（is_builtin），项目副本可见 ──
  const list = await svc.listWorkflows(admin, projectId);
  ok("项目工作流列表有 3 套（TASK/DEFECT/REQUIREMENT 副本）", list.length === 3, String(list.length));
  const task = list.find((w) => w.appliesToType === "TASK")!;

  // ── 内置模板只读 ──
  let builtinRO = false;
  try { await svc.updateWorkflow(admin, task.id, { name: "改名" }); } catch { builtinRO = false; }  // 副本可改
  const platform = (await db.select().from(workflow).where(eq(workflow.isBuiltin, true)).limit(1))[0]!;
  try { await svc.updateWorkflow(admin, platform.id, { name: "改模板" }); builtinRO = false; }
  catch { builtinRO = true; }
  ok("内置平台模板只读", builtinRO);

  // ── 加状态 ──
  const st = await svc.addState(admin, task.id, { key: "IN_REVIEW", name: "评审中", category: "IN_PROGRESS" });
  ok("加状态成功", st.key === "IN_REVIEW");
  let dupKey = false;
  try { await svc.addState(admin, task.id, { key: "IN_REVIEW", name: "重复", category: "IN_PROGRESS" }); } catch (e) { dupKey = (e as { code?: string }).code === "VALIDATION"; }
  ok("重复 key → VALIDATION", dupKey);
  let badCat = false;
  try { await svc.addState(admin, task.id, { key: "X1", name: "坏", category: "BAD" }); } catch (e) { badCat = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法 category → VALIDATION", badCat);

  // ── 加边 / 重复边 / 自环 / 终态出边 ──
  const states = await svc.listStates(admin, task.id);
  const todo = states.find((s) => s.key === "TODO")! ?? states[0]!;
  const edge = await svc.addTransition(admin, task.id, { fromStateId: todo.id, toStateId: st.id });
  ok("加迁移边成功", edge.id !== undefined);
  let dupEdge = false;
  try { await svc.addTransition(admin, task.id, { fromStateId: todo.id, toStateId: st.id }); } catch (e) { dupEdge = (e as { code?: string }).code === "VALIDATION"; }
  ok("重复边 → VALIDATION", dupEdge);
  let selfLoop = false;
  try { await svc.addTransition(admin, task.id, { fromStateId: st.id, toStateId: st.id }); } catch (e) { selfLoop = (e as { code?: string }).code === "VALIDATION"; }
  ok("自环 → VALIDATION", selfLoop);
  const terminal = states.find((s) => s.category === "TERMINAL");
  if (terminal) {
    let termOut = false;
    try { await svc.addTransition(admin, task.id, { fromStateId: terminal.id, toStateId: todo.id }); } catch (e) { termOut = (e as { code?: string }).code === "VALIDATION"; }
    ok("终态出边 → VALIDATION", termOut);
  }
  const edges = await svc.listTransitions(admin, task.id);
  ok("出边列表含新边", edges.some((e) => e.id === edge.id));

  // ── 被引用状态只能归档：有工作项在 TODO → 归档被拒 ──
  await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "引用者" });
  let blocked = false, blockedCode = "";
  try { await svc.archiveState(admin, task.id, todo.id); } catch (e) { blocked = true; blockedCode = (e as { code?: string }).code ?? ""; }
  ok("被引用状态归档被拒（BLOCKED_BY_PREREQUISITE）", blocked && blockedCode === "BLOCKED_BY_PREREQUISITE", blockedCode);

  // 未引用状态可归档
  await svc.archiveState(admin, task.id, st.id);
  const after = await svc.listStates(admin, task.id);
  ok("未引用状态可归档", !after.some((s) => s.id === st.id), String(after.length));

  // ── 删边 ──
  await svc.removeTransition(admin, task.id, edge.id);
  ok("删边成功", !(await svc.listTransitions(admin, task.id)).some((e) => e.id === edge.id));
} finally {
  await app0close();
}

async function app0close() {
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
