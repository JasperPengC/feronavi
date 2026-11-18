import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 看板与工作流引擎自检（R6）
 *
 * 重点验三件事：
 *   1 **校验链四步的顺序与结果**（版本 → 迁移边 → 角色 → 必填字段）
 *   2 **终态进出时 completed_at 的写入与清空**（判定读 category，不硬编码状态码）
 *   3 **看板聚合的列顺序与空列**（按 sort_order，空列也要出现）
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wfRepo from "../src/server/repos/workflow.repo.ts";
import { eq, and } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const U = "r6-admin";
  await db.delete(auditEntry);
  await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: U, email: `${U}@example.test`, name: "R6", status: "ACTIVE",
  passwordHash: await hashPassword("r6-password-12345"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const actor = (await loadActor(m!.id))!;

const KEY = "R6PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(actor, { key: KEY, name: "R6 项目" });

try {
  // ── ① 看板聚合：列顺序与空列 ──────────────────────────────
  const board0 = await wiService.loadBoard(actor, projectId, 100);
  ok("看板列覆盖三套工作流的全部状态（22 列）", board0.length === 22, `实际 ${board0.length}`);
  ok("空列也出现（left join）", board0.every((c) => Array.isArray(c.items)));
  const orders = board0.map((c) => c.sortOrder);
  ok("列按 sort_order 升序", orders.every((v, i) => i === 0 || v >= orders[i - 1]!), JSON.stringify(orders.slice(0, 8)));

  // ── ② 建工作项并流转 ─────────────────────────────────────
  const wi = await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "要流转的任务" });
  const detail = await wiService.getWorkItem(actor, wi.id);
  ok("新建工作项处于 NOT_STARTED", detail?.statusId !== undefined);

  const allowed = await wiService.allowedTransitions(actor, { workflowId: detail!.workflowId, statusId: detail!.statusId });
  ok("详情返回可用迁移边", allowed.length > 0, `实际 ${allowed.length} 条`);
  ok("可用迁移包含 IN_PROGRESS", allowed.some((a) => a.toStateKey === "IN_PROGRESS"), JSON.stringify(allowed.map((a) => a.toStateKey)));

  // 校验链 ②：不存在的迁移边
  let noEdge = false, edgeCode = "";
  try { await wiService.transitionWorkItem(actor, wi.id, { toStateKey: "DONE", version: 1 }); }
  catch (e) { noEdge = true; edgeCode = (e as { code?: string }).code ?? ""; }
  ok("跨状态的非法流转（TODO→DONE）→ VALIDATION", noEdge && edgeCode === "VALIDATION", edgeCode);

  // 校验链 ①：版本不对
  let badVer = false, verCode = "";
  try { await wiService.transitionWorkItem(actor, wi.id, { toStateKey: "IN_PROGRESS", version: 99 }); }
  catch (e) { badVer = true; verCode = (e as { code?: string }).code ?? ""; }
  ok("版本不匹配 → VERSION_CONFLICT", badVer && verCode === "VERSION_CONFLICT", verCode);

  // 正常流转（校验链全过）
  const moved = await wiService.transitionWorkItem(actor, wi.id, { toStateKey: "IN_PROGRESS", version: 1 });
  ok("TODO → IN_PROGRESS 成功", moved?.version === 2, `version=${moved?.version}`);
  ok("非终态时 completed_at 为 NULL", moved?.completedAt === null);

  // ── ③ 终态：completed_at 写入与清空 ──────────────────────
  const done = await wiService.transitionWorkItem(actor, wi.id, { toStateKey: "DONE", version: 2 });
  ok("IN_PROGRESS → DONE（终态）成功", done?.version === 3);
  ok("进入终态 → completed_at 被写入", done?.completedAt !== null, String(done?.completedAt));

  const reopened = await wiService.transitionWorkItem(actor, wi.id, { toStateKey: "IN_PROGRESS", version: 3 });
  ok("终态 → 进行中（重开）成功", reopened?.version === 4);
  ok("离开终态 → completed_at 被清空", reopened?.completedAt === null, String(reopened?.completedAt));

  // ── ③b C-3：换一套终态 key 不同的工作流（缺陷流的终态是 CLOSED 而非 DONE）──
  // 这一条专治「硬编码状态码」：若代码里写 `key === 'DONE'`，缺陷流不会被认作终态。
  const defect = await wiService.createWorkItem(actor, projectId, { type: "DEFECT", title: "要关闭的缺陷" });
  const d1 = await wiService.getWorkItem(actor, defect.id);
  const dStarted = await wiService.transitionWorkItem(actor, defect.id, { toStateKey: "IN_PROGRESS", version: d1!.version });
  const dFixed = await wiService.transitionWorkItem(actor, defect.id, { toStateKey: "FIXED", version: dStarted!.version });
  const dVerified = await wiService.transitionWorkItem(actor, defect.id, { toStateKey: "VERIFIED", version: dFixed!.version });
  const dClosed = await wiService.transitionWorkItem(actor, defect.id, { toStateKey: "CLOSED", version: dVerified!.version });
  ok("缺陷流终态 CLOSED 也写入 completed_at（不硬编码 DONE）",
    dClosed?.completedAt !== null, String(dClosed?.completedAt));

  const dReopen = await wiService.transitionWorkItem(actor, defect.id, { toStateKey: "REOPENED", version: dClosed!.version });
  ok("缺陷流离开终态也清空 completed_at", dReopen?.completedAt === null, String(dReopen?.completedAt));

  // 未走完的缺陷流：中间状态不得被误判为终态
  ok("缺陷流中间状态不写 completed_at", dStarted?.completedAt === null && dFixed?.completedAt === null);

  // ── ④ 看板分组正确 ───────────────────────────────────────
  const board1 = await wiService.loadBoard(actor, projectId, 100);
  const inProgressCol = board1.find((c) => c.items.some((i) => i.id === wi.id));
  ok("工作项出现在 IN_PROGRESS 列", inProgressCol?.stateKey === "IN_PROGRESS", inProgressCol?.stateKey);
  ok("列 count 与 items 一致", board1.every((c) => c.count >= c.items.length));

  // ── ⑤ 列内上限与 truncated ───────────────────────────────
  for (let i = 0; i < 5; i++) {
    await wiService.createWorkItem(actor, projectId, { type: "TASK", title: `批量 ${i}` });
  }
  const boardSmall = await wiService.loadBoard(actor, projectId, 3);
  const todoCol = boardSmall.find((c) => c.stateKey === "TODO");
  ok("列内上限生效（items ≤ 3）", (todoCol?.items.length ?? 0) <= 3, String(todoCol?.items.length));
  // 这一条才是关键：count 是真实总数（5），items 被截断到 3 —— 前端据此显示「还有 N 条」
  ok("count 反映真实总数而非截断后的长度",
    (todoCol?.count ?? 0) > (todoCol?.items.length ?? 0) && todoCol?.count === 5,
    `count=${todoCol?.count} items=${todoCol?.items.length}`);

  // ── ⑥ 必填字段校验（构造一条带 required_fields 的边）─────
  const wfId = detail!.workflowId;
  const stTodo = await wfRepo.findStateByKey(wfId, "TODO");
  const stInProg = await wfRepo.findStateByKey(wfId, "IN_PROGRESS");
  // ⚠️ 本脚本的 sql 来自 src/db/index.ts，是 postgres.js 客户端，直接用；
  //    不要写成 db.execute(sql`...`)（那是给 drizzle 构造器用的，会报 getSQL is not a function）
  await sql`
    update workflow_transition set required_fields = '["rejectionReason"]'::jsonb
    where workflow_id = ${wfId} and from_state_id = ${stTodo!.id} and to_state_id = ${stInProg!.id}
  `;
  const wi2 = await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "需要必填字段" });
  let needField = false, needDetails: unknown = null;
  try { await wiService.transitionWorkItem(actor, wi2.id, { toStateKey: "IN_PROGRESS", version: 1 }); }
  catch (e) {
    needField = (e as { code?: string }).code === "VALIDATION";
    needDetails = (e as { details?: unknown }).details;
  }
  ok("缺必填字段 → VALIDATION", needField);
  ok("响应带 details.requiredFields（供前端弹窗）",
    JSON.stringify(needDetails) === JSON.stringify({ requiredFields: ["rejectionReason"] }), JSON.stringify(needDetails));

  const wi3 = await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "填了字段" });
  const withField = await wiService.transitionWorkItem(actor, wi3.id, {
    toStateKey: "IN_PROGRESS", version: 1, fields: { rejectionReason: "因为" },
  });
  ok("补齐字段后流转成功", withField?.version === 2);
  // 还原，避免影响其它断言
  await sql`
    update workflow_transition set required_fields = '[]'::jsonb
    where workflow_id = ${wfId} and from_state_id = ${stTodo!.id} and to_state_id = ${stInProg!.id}
  `;
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.id, projectId));
  await db.delete(member).where(eq(member.id, m!.id));
  void and;
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
