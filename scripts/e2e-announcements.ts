/** 群发公告自检（第十四期）：最高风险操作的护栏 */
import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, announcement, notification, apiToken, idempotencyKey, auditEntry, activityEntry, subscription, memberPreference, notificationPreference, timeLog, workItemCollaborator, workItemRelation } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as ann from "../src/server/services/announcement.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const A = "w14h-admin", B = "w14h-member";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(announcement); await db.delete(notification);
for (const u of [A, B]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14h-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(A, "公告管理员"), b = await mk(B, "普通成员");
await db.insert(roleAssignment).values([
  { memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null },
  { memberId: b.id, roleId: memberRole!.id, scopeType: "ORG", scopeId: null },
]);
const admin = (await loadActor(a.id))!, plain = (await loadActor(b.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3969), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3969";
const call = async (token: string, name: string, args: Record<string, unknown>) => {
  const res = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: confirmedTestArgs(name, args) } }),
  });
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(j.result?.content?.[0]?.text ?? "null"); } catch { /* 非 JSON */ }
  return { isError: j.result?.isError === true, data };
};

try {
  // ① 权限：普通成员不能群发
  let denied = false;
  try { await ann.sendAnnouncement(plain, { title: "x", body: "y" }); } catch (e) { denied = (e as { code?: string }).code === "FORBIDDEN"; }
  ok("无 notification:send 者不能群发", denied);

  // ② 管理员发送：扇出到全员并如实记录投递人数
  const sent = await ann.sendAnnouncement(admin, { title: "维护通知", body: "今晚 22:00 起停机维护。", severity: "WARNING" });
  ok("发送成功并记录严重级别", sent!.severity === "WARNING" && !!sent!.id);
  const actives = await db.select({ id: member.id }).from(member).where(eq(member.status, "ACTIVE"));
  ok("**delivered_count 是实际投递人数**（免打扰/偏好会让人被跳过，故不得等于目标数硬编码）",
    sent!.deliveredCount <= actives.length && sent!.deliveredCount > 0, `${sent!.deliveredCount}/${actives.length}`);
  ok("投递失败计数为 0（不静默吞异常）", (sent as { failedCount?: number }).failedCount === 0, String((sent as { failedCount?: number }).failedCount));
  const notes = await db.select().from(notification).where(eq(notification.groupKey, `announcement:${sent!.id}`));
  ok("通知按公告分组扇出（走既有通知服务）", notes.length === sent!.deliveredCount && notes.length > 0, );

  // ③ 撤回：仅限发送人本人
  let crossRevoke = false;
  try { await ann.revokeAnnouncement(plain, sent!.id); } catch (e) { crossRevoke = (e as { code?: string }).code === "FORBIDDEN"; }
  ok("**他人不能撤回公告**（撤回仅限发送人本人）", crossRevoke);
  const revoked = await ann.revokeAnnouncement(admin, sent!.id);
  ok("本人撤回成功", revoked.revokedAt !== null && revoked.alreadyRevoked === false);
  const left = await db.select().from(notification).where(eq(notification.groupKey, `announcement:${sent!.id}`));
  ok("**撤回后对应通知一并清除**（否则点进去看到已撤回内容）", left.length === 0, String(left.length));
  ok("默认列表不含已撤回", (await ann.listAnnouncements(admin)).every((r) => r.revokedAt === null));
  ok("显式查询可见已撤回（便于审计）", (await ann.listAnnouncements(admin, { includeRevoked: true })).some((r) => r.id === sent!.id));
  const again = await ann.revokeAnnouncement(admin, sent!.id);
  ok("重复撤回是幂等的", again.alreadyRevoked === true);

  // ④ 空标题/正文
  let emptyTitle = false;
  try { await ann.sendAnnouncement(admin, { title: "  ", body: "x" }); } catch (e) { emptyTitle = (e as { code?: string }).code === "VALIDATION"; }
  ok("空标题 → VALIDATION", emptyTitle);

  // ⑤ MCP 双条件：READ_WRITE 档即使有权限也被拒
  const rw = (await tokenService.createToken(admin, { name: "读写", tier: "READ_WRITE" })).token;
  const adminTok = (await tokenService.createToken(admin, { name: "管理", tier: "ADMIN" })).token;
  const viaRw = await call(rw, "announcement.send", { title: "x", body: "y" });
  ok("**READ_WRITE 档调群发 → 被拒**（最高风险操作需 ADMIN 档）",
    viaRw.isError && (viaRw.data as { code?: string }).code === "FORBIDDEN", JSON.stringify(viaRw.data).slice(0, 80));
  const before = (await db.select().from(announcement)).length;
  const viaAdmin = await call(adminTok, "announcement.send", { title: "MCP 公告", body: "来自 MCP", idempotencyKey: "ann-1" });
  ok("ADMIN 档调群发成功", !viaAdmin.isError, JSON.stringify(viaAdmin.data).slice(0, 90));
  const viaAgain = await call(adminTok, "announcement.send", { title: "MCP 公告", body: "来自 MCP", idempotencyKey: "ann-1" });
  ok("同幂等键重放不二次群发", (viaAgain.data as { replayed?: boolean })?.replayed === true);
  const after = (await db.select().from(announcement)).length;
  ok("**幂等生效：公告只多了一条**", after === before + 1, `${before}→${after}`);
  // ⑥ **REST 三个端点**（规范 8.5 列了它们；只做 MCP 工具不做 REST 是缺口 —— 冒烟时抓到过）
  {
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: A, password: "w14h-password-1234" }),
    });
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
    const httpSend = await fetch(`${BASE}/api/v1/announcements`, {
      method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ title: "HTTP 公告", body: "经 REST 发送", severity: "CRITICAL" }),
    });
    const sentBody = (await httpSend.json()) as { id?: string; severity?: string };
    ok("HTTP 群发 201 且含严重级别", httpSend.status === 201 && sentBody.severity === "CRITICAL", String(httpSend.status));
    const httpList = await fetch(`${BASE}/api/v1/announcements`, { headers: { cookie } });
    ok("HTTP 列表 200", httpList.status === 200, String(httpList.status));
    const httpRevoke = await fetch(`${BASE}/api/v1/announcements/${sentBody.id}/revoke`, {
      method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf }, body: "{}",
    });
    ok("HTTP 撤回 200", httpRevoke.status === 200, String(httpRevoke.status));
    // 普通成员（无 notification:send）经 HTTP 也被拒
    const login2 = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: B, password: "w14h-password-1234" }),
    });
    const cookie2 = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const csrf2 = ((await login2.json()) as { csrfToken: string }).csrfToken;
    const deniedHttp = await fetch(`${BASE}/api/v1/announcements`, {
      method: "POST", headers: { "content-type": "application/json", cookie: cookie2, "x-csrf-token": csrf2 },
      body: JSON.stringify({ title: "x", body: "y" }),
    });
    ok("HTTP 上也拦住无权限者（403）", deniedHttp.status === 403, String(deniedHttp.status));
    const anonList = await fetch(`${BASE}/api/v1/announcements`);
    ok("匿名读公告被拒", anonList.status === 403, String(anonList.status));
  }

  const listed = await fetch(`${BASE}/api/v1/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const names = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  ok("工具清单含两个公告工具（写工具共 21）", names.includes("announcement.send") && names.includes("announcement.revoke"), String(names.length));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}`);
  console.log(String((e as Error).stack).split("\n").slice(1, 4).join("\n"));
} finally {
  await app.close();
  await db.delete(notification).where(eq(notification.groupKey, `announcement:%`)).catch(() => {});
  await db.delete(announcement);
  await db.delete(notification); await db.delete(idempotencyKey); await db.delete(apiToken);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(subscription); await db.delete(timeLog); await db.delete(workItemCollaborator);
  await db.delete(workItemRelation); await db.delete(memberPreference); await db.delete(notificationPreference);
  for (const u of [A, B]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
