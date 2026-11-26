import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 工作项自检（R5）—— 重点是两个"并发正确性"断言
 *
 * 1 **编号原子性**：并发建 N 个工作项，编号必须恰好是 1..N 且无重复、无空洞。
 *    用 `SELECT max(number)+1` 实现的话这里必然出现重复号 —— 而且单线程测试发现不了。
 * 2 **乐观锁**：两个请求拿同一 version 更新，第二个必须 VERSION_CONFLICT 而不是静默覆盖。
 *    顺带验证**软删后编号不复用**（计数器不回退）。
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, rolePermission, roleAssignment, project, workItem, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { anonymizeMember } from "../src/server/services/member.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const U = "r5-admin";
  await db.delete(auditEntry);
  await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: U, email: `${U}@example.test`, name: "R5", status: "ACTIVE",
  passwordHash: await hashPassword("r5-password-12345"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const actor = (await loadActor(m!.id))!;
const adminPermissions = await db.select({ key: rolePermission.permissionKey }).from(rolePermission).where(eq(rolePermission.roleId, adminRole!.id));
ok("Actor 装载完整管理员权限且无额外权限", adminPermissions.length > 0
  && actor.permissions.size === adminPermissions.length
  && adminPermissions.every(({ key }) => actor.permissions.has(key)), String(actor.permissions.size));

const KEY = "R5PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(actor, { key: KEY, name: "R5 项目" });

try {
  // ── ① 编号原子性：并发建 100 个 ────────────────────────────
  const N = 100;
  // 用 allSettled 而不是 all：并发下若有失败（例如编号撞唯一约束），
  // 测试要能**报告**这个失败，而不是让整个进程崩掉把其它断言一起带走。
  const settled = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      wiService.createWorkItem(actor, projectId, { type: "TASK", title: `并发任务 ${i}` })),
  );
  const rejected = settled.filter((r) => r.status === "rejected");
  ok(`并发建 ${N} 个无失败`, rejected.length === 0,
    rejected.length ? `失败 ${rejected.length} 个，首个原因：${(rejected[0] as PromiseRejectedResult).reason?.message?.slice(0, 90)}` : "");
  const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const numbers = results.map((r) => r.number).sort((a, b) => a - b);
  const expected = Array.from({ length: N }, (_, i) => i + 1);
  ok(`并发建 ${N} 个编号连续无重复`, JSON.stringify(numbers) === JSON.stringify(expected),
    `实际前 10 个：${numbers.slice(0, 10).join(",")}… 共 ${numbers.length} 个，去重后 ${new Set(numbers).size} 个`);

  const keys = results.map((r) => r.key);
  ok("key 格式为 `${projectKey}-${number}`", keys.every((k) => /^R5PROJ-\d+$/.test(k)), keys[0]);
  ok("key 无重复", new Set(keys).size === N);

  // ── ② 乐观锁 ─────────────────────────────────────────────
  const target = results[0]!;
  const first = await wiService.updateWorkItem(actor, target.id, { version: 1, title: "改过一次" });
  ok("首次更新成功且 version → 2", first?.version === 2, String(first?.version));

  let conflict = false, code = "";
  try { await wiService.updateWorkItem(actor, target.id, { version: 1, title: "用过期版本改" }); }
  catch (e) { conflict = true; code = (e as { code?: string }).code ?? ""; }
  ok("用过期 version 更新 → VERSION_CONFLICT", conflict && code === "VERSION_CONFLICT", code);

  const after = await wiService.getWorkItem(actor, target.id);
  ok("冲突时数据未被覆盖", after?.title === "改过一次", after?.title);

  // ── ③ 软删后编号不复用 ───────────────────────────────────
  const beforeDelete = await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "将删除" });
  await wiService.deleteWorkItem(actor, beforeDelete.id);
  const afterDelete = await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "删除后新建" });
  ok("软删后新编号不回收（严格递增）", afterDelete.number === beforeDelete.number + 1,
    `${beforeDelete.number} → ${afterDelete.number}`);

  const gone = await db.select().from(workItem).where(eq(workItem.id, beforeDelete.id));
  ok("软删的行仍在库中（deleted_at 非空）", gone[0]?.deletedAt !== null);
  let notVisible = false;
  try { await wiService.getWorkItem(actor, beforeDelete.id); } catch { notVisible = true; }
  ok("软删后按 id 查不到（仓储层过滤）", notVisible);

  // ── ④ 类型校验（应用层 + DB CHECK 双保险）────────────────
  let sevRejected = false;
  try { await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "x", severity: "S1" }); }
  catch (e) { sevRejected = (e as { code?: string }).code === "VALIDATION"; }
  ok("TASK 带 severity → VALIDATION", sevRejected);

  let subRejected = false;
  try { await wiService.createWorkItem(actor, projectId, { type: "SUBTASK", title: "x" }); }
  catch (e) { subRejected = (e as { code?: string }).code === "VALIDATION"; if (!subRejected) console.log("    实际错误:", (e as Error).message.slice(0,120), "code=", (e as {code?:string}).code); }
  ok("SUBTASK 无父项 → VALIDATION", subRejected);

  // ── ④b 子任务继承父项工作流（规范缺口补丁）──────────────
  const parentWi = await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "父任务" });
  const subWi = await wiService.createWorkItem(actor, projectId,
    { type: "SUBTASK", title: "子任务", parentId: parentWi.id });
  const parentRow = await wiService.getWorkItem(actor, parentWi.id);
  const subRow = await wiService.getWorkItem(actor, subWi.id);
  ok("子任务继承父项的 workflow_id", subRow?.workflowId === parentRow?.workflowId,
    `${subRow?.workflowId} vs ${parentRow?.workflowId}`);

  // ── ⑤ 中文检索（切片判据 A11）────────────────────────────
  await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "登录接口失败了" });
  const hit = await sql<{ n: number }[]>`
    select count(*)::int as n from work_item
    where project_id = ${projectId} and deleted_at is null
      and to_tsvector('chinese_zh', coalesce(title,'') || ' ' || coalesce(description,''))
          @@ plainto_tsquery('chinese_zh', '登录')
  `;
  ok("中文检索能命中（zhparser 生效）", (hit[0]?.n ?? 0) >= 1, String(hit[0]?.n));

  // ── ⑥ 生命周期锁禁止写入 ─────────────────────────────────
  await db.update(project).set({ lifecycleLock: true }).where(eq(project.id, projectId));
  let locked = false;
  try { await wiService.createWorkItem(actor, projectId, { type: "TASK", title: "锁定期" }); }
  catch (e) { locked = (e as { code?: string }).code === "CONFLICT"; }
  ok("项目生命周期锁 → 禁止建工作项（CONFLICT）", locked);
  await db.update(project).set({ lifecycleLock: false }).where(eq(project.id, projectId));
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.id, projectId));
  await db.delete(member).where(eq(member.id, m!.id));
  void anonymizeMember;
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
