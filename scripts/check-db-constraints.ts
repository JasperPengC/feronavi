import "./_env.ts";
/**
 * 数据库约束回归 —— 逐条实测 CHECK / UNIQUE **真的在拦人**
 *
 * 为什么必须有这个脚本：约束"存在"不等于"生效"。本次就实测出一个反向的
 * CHECK（规范原文把 `type <> 'DEFECT'` 写成应该的方向的反面），它照样建得出约束、
 * 照样在 pg_constraint 里查得到，但语义完全相反。只有真插一条数据才能发现。
 *
 * 每条约束都测**正例 + 反例**：只测"该拒的被拒"会漏掉"该过的也被拒"。
 */
import { sql } from "../src/db/index.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

/** 执行 SQL，返回错误信息（成功则返回 null） */
async function trySql(q: string): Promise<string | null> {
  try {
    await sql.unsafe(q);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ── 准备夹具 ─────────────────────────────────────────────────
await sql`delete from work_item`;
await sql`delete from project where key like 'CK%'`;
await sql`delete from member where username like 'ck%'`;
await sql`insert into member (username, name, status, password_hash) values ('ckfix', '夹具', 'ACTIVE', '!')`;
const [m] = await sql<{ id: string }[]>`select id from member where username = 'ckfix'`;
const memberId = m!.id;
await sql`insert into project (key, name, created_by) values ('CKFIX', '夹具项目', ${memberId})`;
const [p] = await sql<{ id: string }[]>`select id from project where key = 'CKFIX'`;
const projectId = p!.id;
const [w] = await sql<{ id: string }[]>`select id from workflow where applies_to_type = 'TASK'`;
const [s] = await sql<{ id: string }[]>`select id from workflow_state where workflow_id = ${w!.id} order by sort_order limit 1`;

const wi = (cols: string, _vals: string) =>
  `insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id${cols})
   values ('${projectId}', `;

try {
  // ── 严重度仅缺陷有效（正反例都必须测）────────────────────
  ok("TASK 填严重度 → 拒绝",
    (await trySql(`${wi(", severity", "")}1, 'CKFIX-1', 'TASK', 'x', '${w!.id}', '${s!.id}', '${memberId}', 'S1')`))
      ?.includes("work_item_severity_only_defect") === true);
  ok("DEFECT 填严重度 → 通过",
    (await trySql(`${wi(", severity", "")}2, 'CKFIX-2', 'DEFECT', 'x', '${w!.id}', '${s!.id}', '${memberId}', 'S1')`)) === null);

  // ── 日期顺序 ─────────────────────────────────────────────
  ok("起始晚于截止 → 拒绝",
    (await trySql(`${wi(", start_date, due_date", "")}3, 'CKFIX-3', 'TASK', 'x', '${w!.id}', '${s!.id}', '${memberId}', '2026-12-01', '2026-01-01')`))
      ?.includes("work_item_date_order") === true);
  ok("日期顺序正常 → 通过",
    (await trySql(`${wi(", start_date, due_date", "")}4, 'CKFIX-4', 'TASK', 'x', '${w!.id}', '${s!.id}', '${memberId}', '2026-01-01', '2026-12-01')`)) === null);

  // ── 子任务必须有父项 ─────────────────────────────────────
  ok("SUBTASK 无父项 → 拒绝",
    (await trySql(`${wi("", "")}5, 'CKFIX-5', 'SUBTASK', 'x', '${w!.id}', '${s!.id}', '${memberId}')`))
      ?.includes("work_item_subtask_needs_parent") === true);

  // ── 编号：项目内唯一 + 溢出防护 ───────────────────────────
  ok("项目内编号重复 → 拒绝",
    (await trySql(`${wi("", "")}2, 'CKFIX-DUP', 'TASK', 'x', '${w!.id}', '${s!.id}', '${memberId}')`))
      ?.includes("work_item_project_number_key") === true);
  ok("计数器溢出 → 拒绝",
    (await trySql(`insert into project (key, name, created_by, next_issue_number) values ('CKOVF', 'x', '${memberId}', 2000000000)`))
      ?.includes("project_next_issue_number_range") === true);

  // ── 第二期：计划实体的 CHECK ───────────────────────────────
  // ⚠️ 这些约束是手写补丁（drizzle 表达不了）。实测踩过：补丁曾因
  //    shell 的 ambiguous redirect 而**静默追加失败**，结果约束一条都没建、
  //    但迁移照样「成功」。所以必须逐条实测正反例。

  ok("milestone 起始晚于截止 → 拒绝",
    (await trySql(`insert into milestone (project_id, name, start_date, due_date) values ('${projectId}','x','2026-12-01','2026-01-01')`))
      ?.includes("milestone_date_order") === true);
  ok("milestone 日期顺序正常 → 通过",
    (await trySql(`insert into milestone (project_id, name, start_date, due_date) values ('${projectId}','x','2026-01-01','2026-12-01')`)) === null);

  ok("milestone COUNT 模式带进度值 → 拒绝",
    (await trySql(`insert into milestone (project_id, name, progress_mode, progress_value) values ('${projectId}','x','COUNT',50)`))
      ?.includes("milestone_manual_progress") === true);
  ok("milestone MANUAL 缺进度值 → 拒绝",
    (await trySql(`insert into milestone (project_id, name, progress_mode) values ('${projectId}','x','MANUAL')`))
      ?.includes("milestone_manual_progress") === true);
  ok("milestone MANUAL 带进度值 → 通过",
    (await trySql(`insert into milestone (project_id, name, progress_mode, progress_value) values ('${projectId}','x','MANUAL',50)`)) === null);
  ok("milestone 进度值超 100 → 拒绝",
    (await trySql(`insert into milestone (project_id, name, progress_mode, progress_value) values ('${projectId}','x','MANUAL',150)`))
      ?.includes("milestone_progress_range") === true);

  ok("iteration 起始晚于截止 → 拒绝",
    (await trySql(`insert into iteration (project_id, name, start_date, end_date) values ('${projectId}','x','2026-12-01','2026-01-01')`))
      ?.includes("iteration_date_order") === true);

  // iteration_capacity：点数与工时二选一
  await trySql(`insert into iteration (project_id, name, start_date, end_date) values ('${projectId}','it-cap','2026-11-01','2026-11-14')`);
  const [capIt] = await sql<{ id: string }[]>`select id from iteration where project_id = ${projectId} limit 1`;
  if (capIt) {
    ok("容量同时给点数和工时 → 拒绝",
      (await trySql(`insert into iteration_capacity (iteration_id, member_id, capacity_points, capacity_hours) values ('${capIt.id}','${memberId}',10,20)`))
        ?.includes("iteration_capacity_one_of") === true);
    ok("容量只给点数 → 通过",
      (await trySql(`insert into iteration_capacity (iteration_id, member_id, capacity_points) values ('${capIt.id}','${memberId}',10)`)) === null);
    ok("同一人重复设容量 → 拒绝（唯一）",
      (await trySql(`insert into iteration_capacity (iteration_id, member_id, capacity_points) values ('${capIt.id}','${memberId}',20)`))
        ?.includes("iteration_capacity_unique_key") === true);
  }

  // saved_view：作用域与 project_id 的一致性
  ok("PROJECT_SHARED 缺 project_id → 拒绝",
    (await trySql(`insert into saved_view (owner_id, scope, view_type, name) values ('${memberId}','PROJECT_SHARED','LIST','x')`))
      ?.includes("saved_view_shared_needs_project") === true);
  ok("PERSONAL 视图 → 通过",
    (await trySql(`insert into saved_view (owner_id, scope, view_type, name) values ('${memberId}','PERSONAL','LIST','x')`)) === null);
  ok("PERSONAL 却带 project_id → 拒绝",
    (await trySql(`insert into saved_view (owner_id, scope, project_id, view_type, name) values ('${memberId}','PERSONAL','${projectId}','LIST','x')`))
      ?.includes("saved_view_personal_no_project") === true);

  // module：自引用外键
  ok("module 父节点不存在 → 拒绝",
    (await trySql(`insert into module (project_id, name, parent_id) values ('${projectId}','x','00000000-0000-0000-0000-000000000000')`)) !== null);
  ok("module 顶级 → 通过",
    (await trySql(`insert into module (project_id, name) values ('${projectId}','x')`)) === null);

  // ── 第三期：枚举 CHECK（迁移 0007 手写补丁）────────────────
  // 这些列此前只靠应用层校验 —— 绕过应用的写入能塞进非法值。
  // 全部实测正反例，锚定约束名而不是泛化报错。
  const memberRow = await sql<{ id: string }[]>`select id from member limit 1`;
  const mid = memberRow[0]!.id;
  const projRow = await sql<{ id: string }[]>`select id from project limit 1`;
  const pid0 = projRow[0]!.id;

  ok("notification 非法 category → 拒绝",
    (await trySql(`insert into notification (recipient_id, type, category, title, body) values ('${mid}','t','BAD','t','b')`))
      ?.includes("notification_category_allowed") === true);
  ok("comment 非法 target_type → 拒绝",
    (await trySql(`insert into comment (target_type, target_id, author_id, body) values ('BAD','${pid0}','${mid}','x')`))
      ?.includes("comment_target_type_allowed") === true);
  ok("mention 非法 source_type → 拒绝",
    (await trySql(`insert into mention (source_type, source_id, member_id) values ('BAD','${pid0}','${mid}')`))
      ?.includes("mention_source_type_allowed") === true);
  ok("attachment 非法 target_type → 拒绝",
    (await trySql(`insert into attachment (target_type, target_id, uploader_id, original_name, storage_path, mime_type, size_bytes, content_hash) values ('BAD','${pid0}','${mid}','a','/a','t',1,'h')`))
      ?.includes("attachment_target_type_allowed") === true);
  ok("subscription 非法 notify_channel → 拒绝",
    (await trySql(`insert into subscription (member_id, target_type, target_id, notify_channel) values ('${mid}','WORK_ITEM','${pid0}','SMS')`))
      ?.includes("subscription_notify_channel_allowed") === true);
  ok("saved_view 非法 view_type → 拒绝",
    (await trySql(`insert into saved_view (owner_id, scope, view_type, name) values ('${mid}','PERSONAL','GRID','x')`))
      ?.includes("saved_view_view_type_allowed") === true);
  ok("notification_preference 非法 digest → 拒绝",
    (await trySql(`insert into notification_preference (member_id, digest_frequency) values ('${mid}', 'HOURLY')`))
      ?.includes("notification_preference_digest_allowed") === true);
  ok("attachment size_bytes 是 bigint",
    (await sql<{ t: string }[]>`select data_type as t from information_schema.columns where table_name='attachment' and column_name='size_bytes'`)[0]?.t === "bigint");
  ok("module 有 lead_member_id 列",
    ((await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns where table_name='module' and column_name='lead_member_id'`)[0]?.n ?? 0) === 1);

  // ── 角色被项目使用时不可删（RESTRICT，第 5.2 节三级行为）──
  const [r] = await sql<{ id: string }[]>`select id from role where key = 'GUEST'`;
  await sql`insert into project_membership (project_id, member_id, role_id) values (${projectId}, ${memberId}, ${r!.id})`;
  ok("删除被项目使用的角色 → 拒绝（RESTRICT）",
    (await trySql(`delete from role where id = '${r!.id}'`)) !== null);
} finally {
  await sql`delete from work_item`;
  await sql`delete from iteration_capacity`;
  await sql`delete from iteration`;
  await sql`delete from milestone`;
  await sql`delete from saved_view`;
  await sql`delete from module`;
  await sql`delete from release`;
  await sql`delete from project_membership where project_id = ${projectId}`;
  await sql`delete from project where key like 'CK%'`;
  await sql`delete from member where username like 'ck%'`;
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
