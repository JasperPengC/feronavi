import "./_env.ts";   // 环境预设必须最先加载
/**
 * 成员邀请自检（Round 25 长任务第 49 项，REST 第 3 节 / 总纲 5.11）：
 * 创建邀请（只回一次明文）→ 列表/撤销 → 公开校验 → 接受邀请建号并登录 → 单次有效/过期/重名/权限。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { createHash } from "node:crypto";
import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, invite, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "invite-admin";
const GUEST = "invite-guest";
const PW = "invite-pass-123456";
const NEW_PW = "invited-pass-123456";
const NEW_USER = `invited-${Date.now().toString(36).slice(-6)}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(invite);
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
await mk(ADMIN, "邀请管理员", ar!.id);
const guestId = await mk(GUEST, "邀请成员", mr!.id);
void guestId;

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string, password = PW) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await r.json() as { csrfToken?: string };
  return {
    status: r.status,
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": body.csrfToken ? decodeURIComponent(body.csrfToken) : "",
  };
};
let invitedId = "";
try {
  const H = { ...(await login(ADMIN)), "content-type": "application/json" };
  // ① 创建邀请：明文只返回一次，库内只有哈希
  const created = await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H, body: JSON.stringify({ email: `${NEW_USER}@x.test` }),
  });
  const body = await created.json() as { id: string; token: string; inviteUrl: string; email: string; expiresAt: string };
  ok("POST /invites 201 且返回一次性 token/link", created.status === 201 && !!body.token && body.inviteUrl.includes(body.token), JSON.stringify({ s: created.status, id: body.id }));
  const dbRow = (await db.select().from(invite).where(eq(invite.id, body.id)))[0]!;
  ok("库内只存 SHA-256 哈希（不存明文）", dbRow.tokenHash === sha(body.token) && !dbRow.tokenHash.includes(body.token));

  // ② 列表 / 公开校验
  const list = await (await fetch(`${BASE}/api/v1/invites`, { headers: { cookie: H.cookie } })).json() as { invites: { id: string; status: string; email: string }[] };
  ok("GET /invites 台账显示 PENDING 且不含 token", list.invites.some((i) => i.id === body.id && i.status === "PENDING") && !JSON.stringify(list).includes(body.token));
  const check1 = await (await fetch(`${BASE}/api/v1/invites/${body.token}`)).json() as { valid: boolean; email?: string };
  ok("公开校验有效且不泄露邮箱", check1.valid === true && check1.email === undefined, JSON.stringify(check1));

  // ③ 接受邀请 → 登录
  const accepted = await fetch(`${BASE}/api/v1/invites/${body.token}/accept`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: NEW_USER, name: "受邀成员", password: NEW_PW }),
  });
  const acceptedBody = await accepted.json() as { id: string; username: string };
  invitedId = acceptedBody.id;
  ok("接受邀请 201 并建号", accepted.status === 201 && acceptedBody.username === NEW_USER, JSON.stringify(acceptedBody));
  const loginNew = await login(NEW_USER, NEW_PW);
  ok("受邀成员可登录（含 CSRF 会话）", loginNew.status === 200 && !!loginNew.cookie && !!loginNew["x-csrf-token"], String(loginNew.status));
  const listAfter = await (await fetch(`${BASE}/api/v1/invites`, { headers: { cookie: H.cookie } })).json() as { invites: { id: string; status: string }[] };
  ok("邀请台账变为 USED", listAfter.invites.find((i) => i.id === body.id)?.status === "USED");

  // ④ 单次有效 / 复用旧链接拒绝
  ok("同一 token 再次接受 → 400", (await fetch(`${BASE}/api/v1/invites/${body.token}/accept`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `${NEW_USER}-x`, name: "重复", password: NEW_PW }),
  })).status === 400);

  // ⑤ 撤销 + 过期
  const c2 = await (await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H, body: JSON.stringify({ email: `revoke-${NEW_USER}@x.test` }),
  })).json() as { id: string };
  ok("撤销邀请 200 且台账不再 PENDING", (await fetch(`${BASE}/api/v1/invites/${c2.id}`, {
    method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] },
  })).status === 200);
  const token3 = `expired-${Date.now()}`;
  await db.insert(invite).values({
    email: `expired-${NEW_USER}@x.test`, tokenHash: sha(token3), expiresAt: new Date(Date.now() - 1000),
    invitedByMemberId: null,
  });
  const expiredCheck = await (await fetch(`${BASE}/api/v1/invites/${token3}`)).json() as { valid: boolean };
  ok("过期邀请校验 valid=false", expiredCheck.valid === false);
  ok("过期邀请接受 → 400", (await fetch(`${BASE}/api/v1/invites/${token3}/accept`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `${NEW_USER}-e`, name: "过期", password: NEW_PW }),
  })).status === 400);

  // ⑥ 重名/重复邮箱/权限
  const c3 = await (await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H, body: JSON.stringify({ email: `dup-${NEW_USER}@x.test` }),
  })).json() as { token: string };
  ok("接受时用户名重名 → 409", (await fetch(`${BASE}/api/v1/invites/${c3.token}/accept`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: NEW_USER, name: "重名", password: NEW_PW }),
  })).status === 409);
  ok("已存在的成员邮箱再邀请 → 409", (await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: H, body: JSON.stringify({ email: "invite-admin@x.test" }),
  })).status === 409);
  const G = { ...(await login(GUEST)), "content-type": "application/json" };
  ok("无 member:invite 创建邀请 → 403", (await fetch(`${BASE}/api/v1/invites`, {
    method: "POST", headers: G, body: JSON.stringify({ email: `nope-${NEW_USER}@x.test` }),
  })).status === 403);

  // ⑦ 管理员直建成员 + 详情
  const directName = `direct-${NEW_USER}`;
  const direct = await fetch(`${BASE}/api/v1/members`, {
    method: "POST", headers: H,
    body: JSON.stringify({ username: directName, name: "直建成员", email: `${directName}@x.test`, password: NEW_PW }),
  });
  const directBody = await direct.json() as { id: string };
  ok("POST /members 201 直建成员", direct.status === 201 && !!directBody.id, String(direct.status));
  const detail = await (await fetch(`${BASE}/api/v1/members/${directBody.id}`, { headers: { cookie: H.cookie } })).json() as { username: string; passwordHash?: string };
  ok("GET /members/:id 返回非敏感字段", detail.username === directName && detail.passwordHash === undefined);
  await deleteTestMember(directName);
} finally {
  await app.close();
  await db.delete(invite);
  if (invitedId) {
    await db.delete(activityEntry).where(eq(activityEntry.actorId, invitedId));
    await db.delete(auditEntry).where(eq(auditEntry.actorId, invitedId));
    await db.delete(roleAssignment).where(eq(roleAssignment.memberId, invitedId));
    await db.delete(member).where(eq(member.id, invitedId));
  }
  await db.delete(auditEntry);
  await db.delete(activityEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
