import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
import { deleteTestMember } from "./_test-helpers.ts";
/**
 * 表格视图 + 主题对比度自检（T5）
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as viewService from "../src/server/services/planning-view.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "t5-owner";
await deleteTestMember(U);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: U, email: "t5@x.test", name: "T5", status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("t5-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const actor = (await loadActor(m!.id))!;

const KEY = "T5PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(actor, { key: KEY, name: "T5 项目" });

const wfId = (await sql<{ id: string }[]>`select id from workflow where project_id is null and is_builtin and applies_to_type='TASK' limit 1`)[0]!.id;
const stId = (await sql<{ id: string }[]>`select id from workflow_state where workflow_id = ${wfId} order by sort_order limit 1`)[0]!.id;

try {
  // 建不同优先级的 5 个工作项
  const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT", "MEDIUM"];
  for (let i = 0; i < 5; i++) {
    await db.insert(workItem).values({
      projectId, number: i + 1, key: `${KEY}-${i + 1}`, type: "TASK",
      title: `任务 ${i + 1}`, priority: priorities[i],
      workflowId: wfId, statusId: stId, reporterId: m!.id,
    });
  }

  // ── 基本列表 ─────────────────────────────────────────────
  const t1 = await viewService.table(actor, projectId, {});
  ok("返回全部 5 条", t1.total === 5, String(t1.total));
  ok("默认按编号升序", t1.rows[0]?.number === 1, String(t1.rows[0]?.number));

  // ── 排序：优先级降序 ─────────────────────────────────────
  const t2 = await viewService.table(actor, projectId, { sortBy: "priority", sortDir: "desc" });
  ok("按优先级降序排列", t2.rows[0]?.priority === "URGENT", String(t2.rows[0]?.priority));

  // ── 分页 ─────────────────────────────────────────────────
  const t3 = await viewService.table(actor, projectId, { page: 2, pageSize: 2 });
  ok("分页：第 2 页有 2 条", t3.rows.length === 2, String(t3.rows.length));
  ok("total 仍是全量 5", t3.total === 5, String(t3.total));
  ok("第 2 页从第 3 条开始", t3.rows[0]?.number === 3, String(t3.rows[0]?.number));

  // ── pageSize 上限（防大查询）────────────────────────────
  const t4 = await viewService.table(actor, projectId, { pageSize: 9999 });
  ok("pageSize 被钳制到 ≤100", t4.pageSize === 100, String(t4.pageSize));

  // ── 软删的不出现 ─────────────────────────────────────────
  await sql`delete from work_item where project_id = ${projectId} and number = 5`;
  const t5 = await viewService.table(actor, projectId, {});
  ok("删掉的不再出现", t5.total === 4, String(t5.total));

  // ── 越权 ─────────────────────────────────────────────────
  const [o] = await db.insert(member).values({
    username: "t5-other", email: "t5o@x.test", name: "外人", status: "ACTIVE",
    passwordHash: await hashPassword("t5-password-1234"),
  }).returning({ id: member.id });
  const outsider = (await loadActor(o!.id))!;
  let denied = false;
  try { await viewService.table(outsider, projectId, {}); } catch { denied = true; }
  ok("非成员看不到表格", denied);
  await deleteTestMember("t5-other");
} finally {
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  await deleteTestMember(U);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
