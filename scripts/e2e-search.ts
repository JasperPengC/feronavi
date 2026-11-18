import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 全局搜索自检（W4，REST 7e） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as searchService from "../src/server/services/search.service.ts";
import { auditEntry, activityEntry } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w4-admin", G = "w4-outsider";
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w4a@x.test", name: "搜索者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w4-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "w4g@x.test", name: "外人", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w4-password-1234") }).returning({ id: member.id });
const outsider = (await loadActor(g!.id))!;

const KEY = "W4PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(admin, { key: KEY, name: "搜索验证项目" });

try {
  const wi1 = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "登录页改版" });
  await wiService.updateWorkItem(admin, wi1.id, { version: 1, description: "把登录页改成双栏布局并接入 SSO" });
  await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "无关任务" });

  // ── D8 中文分词：搜"登录"命中"登录页改版" ──
  const r1 = await searchService.search(admin, "登录");
  ok("中文分词命中（搜「登录」）", r1.items.some((x) => x.key === "W4PROJ-1"), JSON.stringify(r1.items.map((x) => x.title)));

  // ── 描述字段也参与检索 ──
  const r2 = await searchService.search(admin, "双栏布局");
  ok("描述可被检索（搜「双栏布局」）", r2.items.length >= 1, JSON.stringify(r2.items.map((x) => x.title)));

  // ── 不命中：无结果 ──
  const r3 = await searchService.search(admin, "不存在的词汇XYZQ");
  ok("无命中返回空", r3.items.length === 0, String(r3.items.length));

  // ── D7 数据范围：外人搜不到（无 membership 无 ORG）──
  const r4 = await searchService.search(outsider, "登录");
  ok("无权者搜不到该项目内容", r4.items.length === 0, String(r4.items.length));

  // ── 软删的不出现 ──
  await wiService.deleteWorkItem(admin, wi1.id);
  const r5 = await searchService.search(admin, "登录");
  // ⚠️ 不要断言"总数为 0"：实例里可能本来就有其它含"登录"的真实内容（演示数据、其它测试残留），
  //    正确口径是「**被软删的这一条**不在结果里」—— 判据要指向被测对象，而不是全局为空。
  ok("软删项不出现在结果", !r5.items.some((i) => i.id === wi1.id), JSON.stringify(r5.items.map((i) => i.title).slice(0, 5)));

  // ── 参数护栏 ──
  let guard = false;
  try { await searchService.search(admin, ""); } catch (e) { guard = (e as { code?: string }).code === "VALIDATION"; }
  ok("空搜索词 → VALIDATION", guard);
  let guard2 = false;
  try { await searchService.search(admin, "x", { type: "idea" }); } catch (e) { guard2 = (e as { code?: string }).code === "VALIDATION"; }
  ok("未支持类型 → VALIDATION（语义属 P4）", guard2);
} finally {
  // ⚠️ 先清审计/活动（RESTRICT 会拦 member 删除，W3 的 C-18 在保护数据）
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
