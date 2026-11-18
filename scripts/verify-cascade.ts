import "./_env.ts";
/** 验证：删项目会级联清掉工作流副本与状态（修复 workflow 漏建外键） */
import { db, sql } from "../src/db/index.ts";
import { member, project, role, roleAssignment , auditEntry, activityEntry } from "../src/db/schema.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await db.delete(auditEntry);

await db.delete(activityEntry);


await db.delete(member).where(eq(member.username, "cas"));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: "cas", email: "cas@x.test", name: "C", status: "ACTIVE",
  passwordHash: await hashPassword("cas-password-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const actor = (await loadActor(m!.id))!;

await db.delete(project).where(eq(project.key, "CAS"));
const { id } = await projectService.createProject(actor, { key: "CAS", name: "级联测试" });

try {
  const wf = await sql<{ n: number }[]>`select count(*)::int as n from workflow where project_id = ${id}`;
  const st = await sql<{ n: number }[]>`select count(*)::int as n from workflow_state s join workflow w on w.id = s.workflow_id where w.project_id = ${id}`;
  ok("建项目后复制出 3 套工作流", wf[0]?.n === 3, String(wf[0]?.n));
  ok("建项目后有 22 个状态", st[0]?.n === 22, String(st[0]?.n));

  await db.delete(project).where(eq(project.id, id));

  const wfAfter = await sql<{ n: number }[]>`select count(*)::int as n from workflow where project_id = ${id}`;
  const stAfter = await sql<{ n: number }[]>`select count(*)::int as n from workflow_state s join workflow w on w.id = s.workflow_id where w.project_id = ${id}`;
  const edgeAfter = await sql<{ n: number }[]>`select count(*)::int as n from workflow_transition t join workflow w on w.id = t.workflow_id where w.project_id = ${id}`;
  ok("删项目后 workflow 副本清零", wfAfter[0]?.n === 0, String(wfAfter[0]?.n));
  ok("删项目后 状态清零", stAfter[0]?.n === 0, String(stAfter[0]?.n));
  ok("删项目后 迁移边清零", edgeAfter[0]?.n === 0, String(edgeAfter[0]?.n));

  // 平台模板不受影响
  const tpl = await sql<{ n: number }[]>`select count(*)::int as n from workflow where project_id is null`;
  ok("平台模板不受影响（仍 3 套）", tpl[0]?.n === 3, String(tpl[0]?.n));
} finally {
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, "CAS"));
  await db.delete(member).where(eq(member.username, "cas"));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
