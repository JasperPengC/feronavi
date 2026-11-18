import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 演示数据播种（**开发/验收用，不是产品种子**）
 *
 * 为什么需要：多轮 e2e 全量回归会清掉开发实例里的演示数据（这是测试套件的清理纪律），
 * 结果本地实例变成"空壳"—— 视觉验收、密度/列表检查都只能跳过，人也看不出产品实际密度。
 * 本脚本幂等补齐一套**真实业务动作创建出来的**演示数据（全部走服务层，不直接改表），
 * 这样活动/审计/趋势等真实链路都有数据。
 *
 * 用法：`npm run seed:demo`
 */
import { ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { and, eq, isNull } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { idea, member, project, workItem } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as wikiService from "../src/server/services/wiki.service.ts";
import * as ideaService from "../src/server/services/idea.service.ts";
import * as wfService from "../src/server/services/workflow-config.service.ts";

const log = (msg: string) => console.log(`  · ${msg}`);

const seedUsername = process.env.SEED_USERNAME ?? "";
const demo = seedUsername
  ? (await db.select({ id: member.id }).from(member).where(eq(member.username, seedUsername)).limit(1))[0]
  : (await db.select({ id: member.id }).from(member).orderBy(member.createdAt).limit(1))[0];
if (!demo) {
  console.error("找不到可用的管理员账号 —— 请先完成安装向导，或通过 SEED_USERNAME=<username> 指定账号");
  process.exit(1);
}
const actor = (await loadActor(demo.id))!;
log(`actor: ${actor.username}（${(actor.permissions ?? []).length} 权限）`);

// ① 项目
let proj = (await db.select({ id: project.id }).from(project).where(eq(project.key, "FINOK")).limit(1))[0];
if (!proj) {
  proj = await projectService.createProject(actor, { key: "FINOK", name: "结项终验" } as never);
  log("创建项目 FINOK · 结项终验");
} else {
  log("项目 FINOK 已存在");
}
const pid = proj.id;

// ② 迭代（燃尽图需要真实迭代上下文）
let iterations = await planningService.list(actor, pid, "iteration");
if (iterations.length === 0) {
  await planningService.createPlan(actor, pid, "iteration", {
    name: "2026 秋季迭代", startDate: "2026-10-12", endDate: "2026-10-25", status: "ACTIVE",
  });
  iterations = await planningService.list(actor, pid, "iteration");
  log("创建迭代 2026 秋季迭代");
} else {
  log(`迭代已有 ${iterations.length} 个`);
}
const iterationId = iterations[0]!.id;

// ③ 里程碑
const milestones = await planningService.list(actor, pid, "milestone");
for (const m of [
  { name: "Beta 验收", dueDate: "2026-10-30" },
  { name: "设计系统 v1.0", dueDate: "2026-11-10" },
]) {
  if (milestones.some((x) => x.name === m.name)) { log(`里程碑已存在：${m.name}`); continue; }
  await planningService.createPlan(actor, pid, "milestone", m);
  log(`创建里程碑 ${m.name}`);
}

// ④ 工作项（真实服务创建；两条尝试推进到进行中）
const existing = await db.select({ title: workItem.title }).from(workItem)
  .where(and(eq(workItem.projectId, pid), isNull(workItem.deletedAt)));
const wanted = [
  { type: "TASK", title: "登录接口联调", priority: "HIGH", dueDate: "2026-10-24", iteration: true },
  { type: "DEFECT", title: "权限矩阵回归失败", priority: "URGENT", severity: "S2", dueDate: "2026-10-20", iteration: true },
  { type: "TASK", title: "移动端首屏优化", priority: "MEDIUM", dueDate: "2026-10-27", iteration: false },
  { type: "REQUIREMENT", title: "批量导入体验改进", priority: "LOW", dueDate: null, iteration: false },
] as const;
const createdItems: { id: string; type: string; version: number; statusId: string }[] = [];
for (const w of wanted) {
  const hit = existing.find((x) => x.title === w.title);
  if (hit) { log(`工作项已存在：${w.title}`); continue; }
  const row = await wiService.createWorkItem(actor, pid, {
    type: w.type, title: w.title, priority: w.priority,
    ...(w.type === "DEFECT" ? { severity: w.severity } : {}),
    ...(w.dueDate ? { dueDate: w.dueDate } : {}),
    assigneeId: actor.memberId,
    ...(w.iteration ? { iterationId } : {}),
  } as never) as { id: string; type: string; version: number; statusId: string };
  createdItems.push(row);
  log(`创建工作项 ${w.title}`);
}

// 尝试把两条工作项推进到「进行中」（只在迁移边允许时做，失败不伪造）
for (const row of createdItems.slice(0, 2)) {
  try {
    const workflows = await wfService.listWorkflows(actor, pid);
    const wf = workflows.find((x) => x.appliesToType === row.type);
    if (!wf) continue;
    const states = await wfService.listStates(actor, wf.id);
    const target = states.find((s) => s.category === "IN_PROGRESS" && s.id !== row.statusId);
    if (!target) continue;
    const edges = await wfService.listTransitions(actor, wf.id);
    if (!edges.some((e) => e.fromStateId === row.statusId && e.toStateId === target.id)) continue;
    await wiService.transitionWorkItem(actor, row.id, { toStateKey: target.key, version: row.version });
    log(`工作项已推进到「${target.name}」`);
  } catch (e) {
    log(`推进跳过：${(e as Error).message}`);
  }
}

// ⑤ 文档
const pages = await wikiService.listPages(actor, pid);
for (const p of [
  { title: "项目背景与目标", content: "结项终验的验收目标：统一表单语义、图标一致、真实视觉验收。" },
  { title: "发布前检查清单", content: "1. 迁移与种子\n2. 全量验收\n3. 回滚方案确认" },
]) {
  if (pages.some((x) => x.title === p.title)) { log(`文档已存在：${p.title}`); continue; }
  await wikiService.createPage(actor, pid, p);
  log(`创建文档 ${p.title}`);
}

// ⑥ 想法
const ideaRows = await db.select({ title: idea.title }).from(idea)
  .where(and(eq(idea.projectId, pid), isNull(idea.deletedAt)));
for (const title of ["支持富文本粘贴", "工作项支持批量转派"]) {
  if (ideaRows.some((x) => x.title === title)) { log(`想法已存在：${title}`); continue; }
  await ideaService.createIdea(actor, pid, { title, description: "演示数据（seed:demo）" });
  log(`创建想法 ${title}`);
}

// 注意：这里的 sql 是 postgres.js 客户端（不是 drizzle 的 sql 模板），直接打库做汇总
const counts = await sql<{ work_items: number; milestones: number; pages: number }[]>`
  select
    (select count(*)::int from work_item where project_id = ${pid} and deleted_at is null) as work_items,
    (select count(*)::int from milestone where project_id = ${pid} and archived_at is null) as milestones,
    (select count(*)::int from page where project_id = ${pid} and deleted_at is null) as pages
`;
console.log("\n演示数据计数:", JSON.stringify(counts[0]));
await sql.end();
// 服务模块可能持有 Redis/定时器句柄；脚本完成后显式退出，避免 CI 卡住。
process.exit(0);
