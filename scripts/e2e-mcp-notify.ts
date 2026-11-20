import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** MCP 通知写工具自检（第十三期补）：仅本人、幂等、传什么改什么 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, apiToken, idempotencyKey, notification, notificationPreference, auditEntry, activityEntry, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const A = "w13g-alice", B = "w13g-bob";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [A, B]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13g-password-1234") }).returning({ id: member.id }))[0]!;
const alice = await mk(A, "爱丽丝"), bob = await mk(B, "鲍勃");
await db.insert(roleAssignment).values([{ memberId: alice.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null }]);
const aliceActor = (await loadActor(alice.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3973), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3973";

const call = async (token: string, name: string, args: Record<string, unknown>) => {
  const res = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } }),
  });
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(j.result?.content?.[0]?.text ?? "null"); } catch { /* 非 JSON */ }
  return { isError: j.result?.isError === true, data };
};

try {
  // 给爱丽丝与鲍勃各造一条通知
  await db.insert(notification).values([
    { recipientId: alice.id, actorId: bob.id, type: "work_item.assigned", category: "ASSIGN", title: "爱丽丝的通知", body: "b", link: null, groupKey: null, itemCount: 1 },
    { recipientId: bob.id, actorId: alice.id, type: "work_item.assigned", category: "ASSIGN", title: "鲍勃的通知", body: "b", link: null, groupKey: null, itemCount: 1 },
  ]);
  const aliceNote = (await db.select().from(notification).where(eq(notification.recipientId, alice.id)).limit(1))[0]!;
  const bobNote = (await db.select().from(notification).where(eq(notification.recipientId, bob.id)).limit(1))[0]!;

  const tokA = (await tokenService.createToken(aliceActor, { name: "读写作答", tier: "READ_WRITE" })).token;

  // ① 标自己的通知已读
  const r1 = await call(tokA, "notification.markRead", { notificationId: aliceNote.id });
  ok("notification.markRead 成功", !r1.isError, JSON.stringify(r1.data).slice(0, 70));
  const after1 = (await db.select().from(notification).where(eq(notification.id, aliceNote.id)).limit(1))[0]!;
  ok("该通知在库里被标为已读", after1.readAt !== null);
  // ② 幂等：再标一次仍成功
  const r2 = await call(tokA, "notification.markRead", { notificationId: aliceNote.id });
  ok("重复标记是幂等的（仍返回成功）", !r2.isError, JSON.stringify(r2.data).slice(0, 90));
  // ③ **不能标别人的通知**（服务层按 actor 过滤）
  const r3 = await call(tokA, "notification.markRead", { notificationId: bobNote.id });
  const bobAfter = (await db.select().from(notification).where(eq(notification.id, bobNote.id)).limit(1))[0]!;
  ok("**标他人通知无效**（服务层只认本人，不越权）", bobAfter.readAt === null,
    r3.isError ? `报错 ${JSON.stringify(r3.data).slice(0, 40)}` : "未报错但也没改到他人数据");
  // ④ 全部标已读
  await db.insert(notification).values({ recipientId: alice.id, actorId: bob.id, type: "work_item.assigned", category: "ASSIGN", title: "尚未阅读的第二条通知", body: "b", itemCount: 1 });
  const allRead = await call(tokA, "notification.markRead", {});
  ok("全部已读工具明确成功", !allRead.isError && allRead.data?.scope === "all", JSON.stringify(allRead.data));
  const allMine = await db.select().from(notification).where(eq(notification.recipientId, alice.id));
  ok("不带 id 时全部标为已读（仅限本人）", allMine.every((n) => n.readAt !== null));
  const bobStill = (await db.select().from(notification).where(eq(notification.recipientId, bob.id)).limit(1))[0]!;
  ok("「全部已读」不影响他人", bobStill.readAt === null);

  // ⑤ 偏好：传什么改什么
  const p1 = await call(tokA, "notification.setPrefs", { categoryPrefs: { ASSIGN: { inApp: true, email: false } } });
  ok("notification.setPrefs 成功", !p1.isError, JSON.stringify(p1.data).slice(0, 70));
  const pref = (await db.select().from(notificationPreference).where(eq(notificationPreference.memberId, alice.id)).limit(1))[0]!;
  ok("分类偏好已落库且返回一致", p1.data?.memberId === alice.id && JSON.stringify(pref.categoryPrefs) === JSON.stringify(p1.data?.categoryPrefs), JSON.stringify(pref.categoryPrefs).slice(0, 70));
  const firstHalf = await call(tokA, "notification.setPrefs", { dndStart: "23:00" });
  ok("首次仅设置一端返回 VALIDATION", firstHalf.isError && firstHalf.data?.code === "VALIDATION", JSON.stringify(firstHalf.data));
  const paired = await call(tokA, "notification.setPrefs", { dndStart: "22:00", dndEnd: "08:00" });
  ok("完整免打扰时段设置成功", !paired.isError, JSON.stringify(paired.data));
  const pref2 = (await db.select().from(notificationPreference).where(eq(notificationPreference.memberId, alice.id)).limit(1))[0]!;
  ok("**只改传入字段**：第二次只传免打扰，分类偏好仍在（不会被清空）",
    String(pref2.dndStart).startsWith("22:00") && JSON.stringify(pref2.categoryPrefs).includes("ASSIGN"),
    `${pref2.dndStart} / ${JSON.stringify(pref2.categoryPrefs).slice(0, 40)}`);
  const empty = await call(tokA, "notification.setPrefs", {});
  ok("不传任何字段 → VALIDATION（不静默清空偏好）", empty.isError && (empty.data as { code?: string }).code === "VALIDATION",
    JSON.stringify(empty.data).slice(0, 60));
  // PATCH 合并已有值后仍成对，允许只调整一端。
  const half = await call(tokA, "notification.setPrefs", { dndStart: "23:00" });
  ok("已有时段可单独调整开始时间", !half.isError && String(half.data?.dndStart).startsWith("23:00") && String(half.data?.dndEnd).startsWith("08:00"), JSON.stringify(half.data));
  const clearHalf = await call(tokA, "notification.setPrefs", { dndStart: null });
  ok("单独清空一端返回 VALIDATION", clearHalf.isError && clearHalf.data?.code === "VALIDATION");
  const invalidTime = await call(tokA, "notification.setPrefs", { dndStart: "25:90", dndEnd: "08:00" });
  ok("非法时刻返回 VALIDATION", invalidTime.isError && invalidTime.data?.code === "VALIDATION");
  const cleared = await call(tokA, "notification.setPrefs", { dndStart: null, dndEnd: null });
  ok("可关闭免打扰且保留分类偏好", !cleared.isError && cleared.data?.dndStart === null && cleared.data?.dndEnd === null && JSON.stringify(cleared.data?.categoryPrefs) === JSON.stringify(pref.categoryPrefs));
  // ⑥ 只见自己的偏好（B 的令牌读不到 A 的）
  const prefsB = (await db.select().from(notificationPreference).where(eq(notificationPreference.memberId, bob.id)));
  ok("另一个账号没有偏好记录（互不干扰）", prefsB.length === 0);
} catch (e) {
  fail++; console.log("  FAIL 链路异常: " + (e as Error).message);
  console.log(String((e as Error).stack).split("\n").slice(1, 5).join("\n"));
} finally {
  await app.close();
  await db.delete(notification); await db.delete(notificationPreference);
  await db.delete(idempotencyKey); await db.delete(apiToken);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(subscription); await db.delete(timeLog);
  await db.delete(workItemCollaborator); await db.delete(workItemRelation); await db.delete(memberPreference);
  for (const u of [A, B]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
