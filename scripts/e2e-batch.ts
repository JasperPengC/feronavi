import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 批量操作自检（W2，总纲 5.12） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem , auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as batchService from "../src/server/services/batch.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "b2-admin", G = "b2-guest";
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
const [a] = await db.insert(member).values({ username: U, email: "b2a@x.test", name: "管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("b2-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "b2g@x.test", name: "无权者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("b2-password-1234") }).returning({ id: member.id });
// GUEST 无任何指派 → 看不到项目
const guest = (await loadActor(g!.id))!;

const KEY = "B2PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(admin, { key: KEY, name: "B2 项目" });

const wfId = (await sql<{ id: string }[]>`select id from workflow where project_id is null and is_builtin and applies_to_type='TASK' limit 1`)[0]!.id;
const states = await sql<{ id: string; key: string }[]>`select id, key from workflow_state where workflow_id = ${wfId} order by sort_order`;
const next = states[1] ?? states[0]!;

try {
  // 建 12 个工作项
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const wi = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: `任务 ${i + 1}` });
    ids.push(wi.id);
  }

  // ── D1 部分成功：12 项全部流转 ──
  const r1 = await batchService.runBatch(admin, { op: "transition", itemIds: ids, patch: { toStateKey: next.key } });
  ok("全部成功计数正确", r1.succeeded === 12 && r1.failed === 0, `${r1.succeeded}/${r1.failed}`);
  ok("逐项结果齐全且有序", r1.results.length === 12 && r1.results[0]!.id === ids[0]);

  // ── D2 权限预检：无权者批量 → 全部 FORBIDDEN，不执行任何写 ──
  const before = await wiService.getWorkItem(admin, ids[0]!) as unknown as { version: number };
  const r2 = await batchService.runBatch(guest, { op: "update", itemIds: ids, patch: { title: "篡改" } });
  ok("无权者全部失败", r2.failed === 12 && r2.succeeded === 0, `${r2.succeeded}/${r2.failed}`);
  ok("失败原因标记 FORBIDDEN", r2.results.every((r) => r.error?.code === "FORBIDDEN"));
  const after = await wiService.getWorkItem(admin, ids[0]!) as unknown as { version: number };
  ok("预检失败不产生任何写入", after.version === before.version, `${before.version} → ${after.version}`);

  // ── D3 混合：一半有效 + 不存在项 → 各自归位 ──
  const ghost = "00000000-0000-0000-0000-000000000000";
  const r3 = await batchService.runBatch(admin, { op: "update", itemIds: [ids[0]!, ghost], patch: { priority: "HIGH" } });
  ok("有效项成功", r3.results.find((r) => r.id === ids[0])?.ok === true);
  ok("不存在项失败且原因可读", r3.results.find((r) => r.id === ghost)?.error?.code === "FORBIDDEN");

  // ── D4 可重试：拿失败 id 单独重试 ──
  const r4 = await batchService.runBatch(admin, { op: "delete", itemIds: [ghost] });
  ok("失败项可单独重试（仍然失败但结构一致）", r4.failed === 1 && r4.results[0]!.error !== undefined);

  // ── D5 分批：120 项建一半删一半（>50 触发分批路径）──
  const many: string[] = [];
  for (let i = 0; i < 120; i++) {
    const wi = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: `批量 ${i}` });
    many.push(wi.id);
  }
  const r5 = await batchService.runBatch(admin, { op: "delete", itemIds: many });
  ok("120 项分批删除全部成功", r5.succeeded === 120, String(r5.succeeded));
  const remain = await sql<{ n: number }[]>`select count(*)::int as n from work_item where project_id = ${projectId} and deleted_at is null`;
  ok("软删后仅剩原 12 项", remain[0]!.n === 12, String(remain[0]!.n));

  // ── D6 参数护栏 ──
  let guard = false;
  try { await batchService.runBatch(admin, { op: "update", itemIds: [ids[0]!] }); } catch (e) { guard = (e as { code?: string }).code === "VALIDATION"; }
  ok("update 无 patch → VALIDATION", guard);
  let guard2 = false;
  try { await batchService.runBatch(admin, { op: "delete", itemIds: [] }); } catch (e) { guard2 = (e as { code?: string }).code === "VALIDATION"; }
  ok("空 itemIds → VALIDATION", guard2);
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
