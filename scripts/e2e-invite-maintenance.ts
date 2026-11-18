import "./_env.ts";   // 环境预设必须最先加载
/**
 * 邀请维护自检（Round 25 长任务第 50 项）：
 * ① 配了 SMTP → 邀请邮件入队（payload 含链接，可重试）；未配 → 不入队；
 * ② GET /members/:id/permissions（本人 / member:manage）；
 * ③ 邀请台账清理（已用 7 天 / 过期 30 天）与保留期 sweep 整合。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, invite, job, member, role, roleAssignment, setting } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { putSettings } from "../src/server/services/setting.service.ts";
import { pruneInvites, pruneHistoricalLogs } from "../src/server/services/retention.service.ts";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "imaint-admin";
const GUEST = "imaint-guest";
const PW = "imaint-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(invite); await db.delete(job);
await db.delete(setting).where(inArray(setting.key, ["smtp.host", "smtp.port", "smtp.from"]));
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "维护管理员", ar!.id);
const guestId = await mk(GUEST, "维护成员", mr!.id);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
try {
  const H = await login(ADMIN);
  // ① 未配 SMTP → 不入队，界面可复制
  const noMail = await (await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H, body: JSON.stringify({ email: `nomail-${Date.now()}@x.test` }),
  })).json() as { emailQueued: boolean };
  ok("未配 SMTP：emailQueued=false 且无 email 任务", noMail.emailQueued === false && (await db.select().from(job)).length === 0);

  // ② 配 SMTP → 邀请邮件入队（payload 含一次性链接）
  await putSettings({ "smtp.host": "smtp.invalid", "smtp.port": 2525, "smtp.from": "noreply@example.com" });
  const email = `withmail-${Date.now()}@x.test`;
  const withMail = await (await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H, body: JSON.stringify({ email }),
  })).json() as { emailQueued: boolean; token: string };
  const mailJobs = (await db.select().from(job)).filter((j) => j.kind === "email.send");
  const payload = mailJobs[0]?.payload as { to?: string; text?: string } | undefined;
  ok("配 SMTP：emailQueued=true 且入队 email.send", withMail.emailQueued === true && mailJobs.length === 1, JSON.stringify(withMail));
  ok("邮件 payload 含收件人与一次性链接", payload?.to === email && (payload?.text ?? "").includes(`/invite/${withMail.token}`), JSON.stringify(payload?.to));

  // ③ 权限集：本人 / member:manage
  const selfPerms = await (await fetch(`${BASE}/api/v1/members/${adminId}/permissions`, { headers: { cookie: H.cookie } })).json() as { permissions: string[]; assignments: unknown[] };
  ok("管理员查看自己的权限集（含 setting:manage 与 ORG 指派）", selfPerms.permissions.includes("setting:manage") && selfPerms.assignments.length === 1, JSON.stringify(selfPerms.permissions.slice(0, 5)));
  const guestPerms = await (await fetch(`${BASE}/api/v1/members/${guestId}/permissions`, { headers: { cookie: H.cookie } })).json() as { permissions: string[] };
  ok("管理员查看成员权限集（含 work_item:create）", guestPerms.permissions.includes("work_item:create"), JSON.stringify(guestPerms.permissions.slice(0, 5)));
  const G = await login(GUEST);
  const selfGuest = await fetch(`${BASE}/api/v1/members/${guestId}/permissions`, { headers: { cookie: G.cookie } });
  ok("成员查看自己的权限集 200", selfGuest.status === 200, String(selfGuest.status));
  ok("成员查看他人权限集 → 403", (await fetch(`${BASE}/api/v1/members/${adminId}/permissions`, { headers: { cookie: G.cookie } })).status === 403);

  // ④ 台账清理：已用超 7 天 / 过期超 30 天
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  await db.insert(invite).values([
    { email: "old-used@x.test", tokenHash: "h-old-used", expiresAt: daysAgo(20), usedAt: daysAgo(10) },
    { email: "old-expired@x.test", tokenHash: "h-old-exp", expiresAt: daysAgo(40) },
    { email: "fresh-pending@x.test", tokenHash: "h-fresh-p", expiresAt: new Date(now.getTime() + 86_400_000) },
    { email: "fresh-used@x.test", tokenHash: "h-fresh-u", expiresAt: new Date(now.getTime() + 86_400_000), usedAt: daysAgo(1) },
  ]);
  const removed = await pruneInvites({ now });
  const left = (await db.select().from(invite)).map((i) => i.email);
  ok("只清理已用超 7 天/过期超 30 天（2 条）", removed === 2 && left.includes("fresh-pending@x.test") && left.includes("fresh-used@x.test")
    && !left.includes("old-used@x.test") && !left.includes("old-expired@x.test"), JSON.stringify({ removed, left }));

  // ⑤ 与保留期 sweep 整合
  await db.insert(invite).values({ email: "sweep-old@x.test", tokenHash: "h-sweep", expiresAt: daysAgo(60) });
  const swept = await pruneHistoricalLogs({ now, auditDays: 0, activityDays: 0, exportHours: 0 });
  ok("pruneHistoricalLogs 返回真实清理条数", swept.invitesDeleted === 1, JSON.stringify({ invitesDeleted: swept.invitesDeleted }));
} finally {
  await app.close();
  await db.delete(invite); await db.delete(job);
  await db.delete(setting).where(inArray(setting.key, ["smtp.host", "smtp.port", "smtp.from"]));
  await db.delete(auditEntry); await db.delete(activityEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
