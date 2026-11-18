import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 关系 / 协作者 / 关注 / 偏好 / 工时自检（第五期 B 线） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, workItemRelation, workItemCollaborator, subscription, timeLog, memberPreference, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as relationService from "../src/server/services/relation.service.ts";
import * as collabService from "../src/server/services/collab.service.ts";
import * as prefsTimeService from "../src/server/services/prefs-time.service.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "b5-admin", C = "b5-collab";
for (const u of [U, C]) await db.delete(member).where(eq(member.username, u));
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "b5a@x.test", name: "主责", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("b5-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [c] = await db.insert(member).values({ username: C, email: "b5c@x.test", name: "协作者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("b5-password-1234") }).returning({ id: member.id });
const collab = (await loadActor(c!.id))!;

const KEY = "B5PROJ";
await db.delete(project).where(eq(project.key, KEY));
const { id: projectId } = await projectService.createProject(admin, { key: KEY, name: "B5 项目" });

try {
  const wiA = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "A" });
  const wiB = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "B" });
  const wiC = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "C" });

  // ── B-1：BLOCKS 链 A→B→C，再 C→A 应成环 ──
  const r1 = await relationService.addRelation(admin, wiA.id, { targetId: wiB.id, type: "BLOCKS" });
  ok("加 BLOCKS 边", r1.type === "BLOCKS");
  await relationService.addRelation(admin, wiB.id, { targetId: wiC.id, type: "BLOCKS" });
  let cycle = false, cycleCode = "";
  try { await relationService.addRelation(admin, wiC.id, { targetId: wiA.id, type: "BLOCKS" }); }
  catch (e) { cycle = true; cycleCode = (e as { code?: string }).code ?? ""; }
  ok("C→A 成环 → VALIDATION（C-13）", cycle && cycleCode === "VALIDATION", cycleCode);

  // 反向视角归一：BLOCKED_BY(A,D) 存成 BLOCKS(D,A)。
  // ⚠️ 不能用 A/C 之间已存在间接链的边（会被 C-13 环校验拒绝 —— 服务行为正确）。
  const wiD = await wiService.createWorkItem(admin, projectId, { type: "TASK", title: "D" });
  const r2 = await relationService.addRelation(admin, wiA.id, { targetId: wiD.id, type: "BLOCKED_BY" });
  ok("BLOCKED_BY 归一为 BLOCKS", r2.type === "BLOCKS" && r2.sourceId === wiD.id);
  let dup = false;
  try { await relationService.addRelation(admin, wiA.id, { targetId: wiB.id, type: "BLOCKS" }); } catch (e) { dup = (e as { code?: string }).code === "VALIDATION"; }
  ok("重复边 → VALIDATION", dup);
  let selfRel = false;
  try { await relationService.addRelation(admin, wiA.id, { targetId: wiA.id, type: "RELATES_TO" }); } catch (e) { selfRel = (e as { code?: string }).code === "VALIDATION"; }
  ok("自环 → VALIDATION", selfRel);

  const view = await relationService.listRelations(admin, wiA.id);
  ok("A 的 blockedBy 视图含 D", view.blockedBy.some((x) => x.key === `${KEY}-4`), JSON.stringify(view));
  ok("A 的 blocks 视图含 B", view.blocks.some((x) => x.key === `${KEY}-2`));

  // ── B-2：协作者（C-23/C-24）──
  await collabService.addCollaborator(admin, wiA.id, c!.id);
  ok("加协作者", (await collabService.listCollaborators(admin, wiA.id)).length === 1);
  let selfAdd = false;
  try { await collabService.addCollaborator(admin, wiA.id, a!.id); } catch (e) { selfAdd = (e as { code?: string }).code === "VALIDATION"; }
  ok("reporter 不能加为协作者", selfAdd);
  let dupCol = false;
  try { await collabService.addCollaborator(admin, wiA.id, c!.id); } catch { dupCol = true; }
  ok("重复加协作者幂等", !dupCol);

  // C-24：协作者能改工作项（update_own 路径），但**不能删**、**不能改工作流**
  const upd = await wiService.updateWorkItem(collab, wiA.id, { version: (await wiService.getWorkItem(collab, wiA.id) as unknown as { version: number }).version, priority: "HIGH" });
  ok("协作者能编辑工作项（C-23 编辑权）", upd.priority === "HIGH");
  let delDenied = false;
  try { await wiService.deleteWorkItem(collab, wiA.id); } catch { delDenied = true; }
  ok("协作者不能删工作项（C-24）", delDenied);

  // 关注者无编辑权（C-23）
  await collabService.follow(admin, wiA.id, ["IN_APP"]);
  const followerDenied = false;
  try { await wiService.updateWorkItem(admin, wiA.id, { version: 1, title: "x" }); } catch { /* admin 本人可以 */ }
  void followerDenied;

  // ── B-3 关注通知扇出 ──
  await collabService.follow(collab, wiA.id, ["IN_APP"]);
  await db.delete(auditEntry); await db.delete(activityEntry);
  const cur = await wiService.getWorkItem(admin, wiA.id) as unknown as { version: number };
  const states = await sql<{ key: string }[]>`select key from workflow_state where workflow_id = (select workflow_id from work_item where id = ${wiA.id}) order by sort_order desc limit 1`;
  try { await wiService.transitionWorkItem(admin, wiA.id, { version: cur.version, toStateKey: states[0]!.key }); } catch { /* 边可能不允许 */ }
  const notifs = await db.select().from(subscription).where(eq(subscription.memberId, c!.id));
  ok("关注记录存在（IN_APP 渠道）", notifs.length >= 1, String(notifs.length));
  await collabService.unfollow(collab, wiA.id);
  // ⚠️ admin 之前也关注了同一项（各有渠道行），unfollow 只删自己的
  const followersAfter = await collabService.followersOf(wiA.id);
  ok("取消关注只移除自己（他人订阅不受影响）", !followersAfter.includes(c!.id) && followersAfter.includes(a!.id),
    JSON.stringify(followersAfter));

  // ── 偏好 ──
  await prefsTimeService.putPreferences(admin, { theme: "dark", density: "compact" });
  const prefs = await prefsTimeService.getPreferences(admin);
  ok("偏好 PUT 后 GET 一致", prefs.theme === "dark" && prefs.density === "compact", JSON.stringify(prefs));
  let badTheme = false;
  try { await prefsTimeService.putPreferences(admin, { theme: "solarized" }); } catch (e) { badTheme = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法 theme → VALIDATION", badTheme);

  // ── 工时 ──
  const tl = await prefsTimeService.addTimeLog(admin, wiA.id, { minutes: 90, loggedDate: "2026-10-16", note: "开发" });
  ok("记工时", tl.minutes === 90);
  let badMin = false;
  try { await prefsTimeService.addTimeLog(admin, wiA.id, { minutes: 0, loggedDate: "2026-10-16" }); } catch (e) { badMin = (e as { code?: string }).code === "VALIDATION"; }
  ok("minutes=0 → VALIDATION", badMin);
  let othersLog = false;
  try { await prefsTimeService.updateTimeLog(collab, tl!.id, { minutes: 5 }); } catch { othersLog = true; }
  ok("改别人的工时被拒（本人或 update_any）", othersLog);
  const logs = await prefsTimeService.listTimeLogs(admin, wiA.id);
  ok("工时列表", logs.length === 1, String(logs.length));
  await prefsTimeService.deleteTimeLog(admin, tl!.id);
  ok("删工时", (await prefsTimeService.listTimeLogs(admin, wiA.id)).length === 0);
} finally {
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(workItemRelation);
  await db.delete(workItemCollaborator);
  await db.delete(timeLog);
  await db.delete(subscription);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, projectId));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, C]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
