import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 第二期 S3–S5 自检：工作项关联 / 日历 / 时间线 / 工作台 / 个人待办
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, milestone, iteration, release, module, workItem, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as viewService from "../src/server/services/planning-view.service.ts";
import * as benchService from "../src/server/services/workbench.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "p2-admin";
  await db.delete(auditEntry);
  await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: U, email: `${U}@x.test`, name: "P2", status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("p2-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const actor = (await loadActor(m!.id))!;

const KEY = "P2PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(actor, { key: KEY, name: "P2 项目" });

/** 建一个 TASK 工作项并返回 */
async function makeWi(title: string, extra: Record<string, unknown> = {}) {
  return wiService.createWorkItem(actor, projectId, { type: "TASK", title, ...extra } as never);
}

try {
  // ══ S3：工作项关联计划实体 ═══════════════════════════════
  const [ms] = await db.insert(milestone).values({ projectId, name: "M1" }).returning({ id: milestone.id });
  const [it] = await db.insert(iteration).values({ projectId, name: "I1", startDate: "2026-11-01", endDate: "2026-11-14" }).returning({ id: iteration.id });
  const [rl] = await db.insert(release).values({ projectId, name: "R1" }).returning({ id: release.id });
  const [md] = await db.insert(module).values({ projectId, name: "D1" }).returning({ id: module.id });

  const wi = await makeWi("关联测试");
  const linked = await wiService.updateWorkItem(actor, wi.id, {
    version: 1, milestoneId: ms!.id, iterationId: it!.id, releaseId: rl!.id, moduleId: md!.id,
  } as never);
  ok("可同时关联四个计划实体", linked !== null);
  ok("关联后 milestoneId 生效", (linked as unknown as { milestoneId: string }).milestoneId === ms!.id);

  const reread = await wiService.getWorkItem(actor, wi.id);
  ok("重新读取关联仍在", (reread as unknown as { iterationId: string }).iterationId === it!.id);

  // 解除关联（传 null）
  const unlinked = await wiService.updateWorkItem(actor, wi.id, { version: 2, milestoneId: null } as never);
  ok("传 null 可解除关联", (unlinked as unknown as { milestoneId: string | null }).milestoneId === null);

  // ── 跨项目关联必须被拒 ────────────────────────────────────
  const KEY2 = "P2OTHER";
  await db.delete(project).where(eq(project.key, KEY2));
  const { id: project2 } = await projectService.createProject(actor, { key: KEY2, name: "别的项目" });
  const [ms2] = await db.insert(milestone).values({ projectId: project2, name: "别的里程碑" }).returning({ id: milestone.id });

  let cross = false, crossCode = "";
  try { await wiService.updateWorkItem(actor, wi.id, { version: 3, milestoneId: ms2!.id } as never); }
  catch (e) { cross = true; crossCode = (e as { code?: string }).code ?? ""; }
  ok("跨项目关联 → VALIDATION", cross && crossCode === "VALIDATION", crossCode);
  ok("拒绝后原关联未被改写",
    (await wiService.getWorkItem(actor, wi.id) as unknown as { milestoneId: string | null }).milestoneId === null);

  let ghost = false, ghostCode = "";
  try { await wiService.updateWorkItem(actor, wi.id, { version: 3, milestoneId: "00000000-0000-0000-0000-000000000000" } as never); }
  catch (e) { ghost = true; ghostCode = (e as { code?: string }).code ?? ""; }
  ok("关联不存在的实体 → VALIDATION", ghost && ghostCode === "VALIDATION", ghostCode);

  // 建项目时会复制工作流，改关联前先还原
  await wiService.updateWorkItem(actor, wi.id, { version: 3, milestoneId: ms!.id } as never);

  // ══ S4：日历聚合 ═════════════════════════════════════════
  const cal = await viewService.calendar(actor, projectId, "2026-11-01", "2026-11-30");
  ok("日历返回窗口", cal.from === "2026-11-01" && cal.to === "2026-11-30", `${cal.from} → ${cal.to}`);
  ok("日历有 unscheduled 字段", typeof cal.unscheduled === "number");

  // 造两个有日期的工作项，验证分组与去重
  const d1 = await makeWi("有日期的");
  const d2 = await makeWi("同一天的");
  await wiService.updateWorkItem(actor, d1.id, { version: 1, startDate: "2026-11-05", dueDate: "2026-11-10" } as never);
  await wiService.updateWorkItem(actor, d2.id, { version: 1, startDate: "2026-11-05", dueDate: "2026-11-05" } as never);

  const cal2 = await viewService.calendar(actor, projectId, "2026-11-01", "2026-11-30");
  const day5 = cal2.days.find((d) => d.date === "2026-11-05");
  ok("11-05 有工作项", (day5?.count ?? 0) >= 2, String(day5?.count));
  // 去重：d2 的 start 与 due 都是 11-05，只能出现一次
  const ids = day5?.items.map((i) => i.id) ?? [];
  ok("同一天同一项只出现一次（去重）", new Set(ids).size === ids.length, `${ids.length} → ${new Set(ids).size}`);
  ok("unscheduled 统计了无日期项", cal2.unscheduled >= 1, String(cal2.unscheduled));

  // ══ S4：时间线聚合 ═══════════════════════════════════════
  // 时间线只画「挂了里程碑 + 有完整起止」的项 —— 先把 d1 挂到 M1。
  // ⚠️ version 必须取**当前值**（乐观锁）：前面 assignee 那次更新已经把它 +1 了，
  //    写死 2 会撞 VERSION_CONFLICT。
  const d1Now = await wiService.getWorkItem(actor, d1.id) as unknown as { version: number };
  await wiService.updateWorkItem(actor, d1.id, { version: d1Now.version, milestoneId: ms!.id } as never);
  const tl = await viewService.timeline(actor, projectId, "2026-11-01", "2026-11-30");
  ok("时间线返回行", Array.isArray(tl.rows));
  const msRow = tl.rows.find((r) => r.kind === "milestone" && r.name === "M1");
  ok("里程碑行存在", msRow !== undefined);
  ok("里程碑行下有工作项条", (msRow?.bars.length ?? 0) >= 1, String(msRow?.bars.length));
  const bar = msRow?.bars[0];
  ok("条有起止日期", !!bar?.startDate && !!bar?.dueDate, JSON.stringify(bar));

  // ══ S5：工作台 ═══════════════════════════════════════════
  // 指派一个给我。version 同样取当前值（前面挂里程碑又 +1 了）
  const d1Now2 = await wiService.getWorkItem(actor, d1.id) as unknown as { version: number };
  await wiService.updateWorkItem(actor, d1.id, { version: d1Now2.version, assigneeId: m!.id } as never);
  const wb = await benchService.workbench(actor);
  ok("工作台返回 4 个分组", wb.groups.length === 4, String(wb.groups.length));
  const assigned = wb.groups.find((g) => g.key === "assignedToMe");
  ok("「指派给我的」有内容", (assigned?.count ?? 0) >= 1, String(assigned?.count));
  const overdue = wb.groups.find((g) => g.key === "overdue");
  ok("「已逾期」分组存在", overdue !== undefined);

  // ══ S5：个人待办 ═════════════════════════════════════════
  const t = await benchService.createTodo(actor, { title: "写周报" });
  ok("建待办", t?.id !== undefined);
  ok("默认未完成", t?.done === false);
  const t2 = await benchService.updateTodo(actor, t!.id, { done: true });
  ok("可标记完成", t2?.done === true);
  ok("完成时间被写入", t2?.doneAt !== null, String(t2?.doneAt));
  const t3 = await benchService.updateTodo(actor, t!.id, { done: false });
  ok("取消完成后时间被清空", t3?.doneAt === null, String(t3?.doneAt));
  ok("列表能看到", (await benchService.listTodos(actor, {})).length >= 1);
  ok("按 done 过滤", (await benchService.listTodos(actor, { done: false })).every((x) => !x.done));

  // 别人的待办不能改
  const [o] = await db.insert(member).values({
    username: "p2-other", email: "p2o@x.test", name: "别人", status: "ACTIVE",
    passwordHash: await hashPassword("p2-password-1234"),
  }).returning({ id: member.id });
  const outsider = (await loadActor(o!.id))!;
  let stole = false;
  try { await benchService.updateTodo(outsider, t!.id, { done: true }); } catch { stole = true; }
  ok("改别人的待办被拒（同形）", stole);
  await db.delete(member).where(eq(member.username, "p2-other"));

  // ══ V8：保存视图 ═══════════════════════════════════════════
  const sv = await planningService.createSavedView(actor, {
    name: "我的看板", viewType: "BOARD", scope: "PERSONAL",
  });
  ok("建个人视图", sv?.id !== undefined);

  const mine = await planningService.listSavedViews(actor);
  ok("列表能看到自己的视图", mine.some((v) => v.id === sv!.id));

  const shared = await planningService.createSavedView(actor, {
    name: "团队看板", viewType: "BOARD", scope: "PROJECT_SHARED", projectId,
  });
  ok("建项目共享视图", shared?.id !== undefined);

  const inProject = await planningService.listSavedViews(actor, projectId);
  ok("按项目能查到共享视图", inProject.some((v) => v.id === shared!.id));

  // PROJECT_SHARED 必须带 project（DB CHECK 之外的服务层前置校验）
  let badShared = false, badCode = "";
  try { await planningService.createSavedView(actor, { name: "x", viewType: "LIST", scope: "PROJECT_SHARED" }); }
  catch (e) { badShared = true; badCode = (e as { code?: string }).code ?? ""; }
  ok("PROJECT_SHARED 缺项目 → VALIDATION", badShared && badCode === "VALIDATION", badCode);

  // 别人的视图删不掉（同形）
  let stoleView = false;
  try { await planningService.deleteSavedView(outsider, sv!.id); } catch { stoleView = true; }
  ok("删别人的视图被拒（同形）", stoleView);

  await planningService.deleteSavedView(actor, sv!.id);
  ok("删自己的视图成功", !(await planningService.listSavedViews(actor)).some((v) => v.id === sv!.id));
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(project).where(eq(project.key, "P2OTHER"));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
