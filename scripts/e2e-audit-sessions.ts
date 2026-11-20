import "./_env.ts";   // 环境预设必须最先加载
/**
 * 会话/账号类安全审计自检（Round 25 长任务第 15 项）：
 * 退出全部会话、撤销单个会话、登录锁定、密码重置、2FA 恢复码重生成、成员匿名化
 * 都必须写 SECURITY 审计。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as totpLib from "../src/server/lib/totp.ts";
import * as tfa from "../src/server/services/two-factor.service.ts";
import { eq } from "drizzle-orm";
import { startIsolatedRedis } from "../tests/support/isolated-special.ts";

const cache = await startIsolatedRedis(process.env.FERONAVI_TEST_DIRECTORY!);
process.env.REDIS_URL = cache.url;

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "ses-admin";
const RESET_USER = "ses-reset";
const ANON_USER = "ses-anon";
const TFA_USER = "ses-tfa";
const LOCK_USER = "ses-lock";
const PW = "ses-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, RESET_USER, ANON_USER, TFA_USER, LOCK_USER]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string, hash = PW) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(hash),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "会话管理员", ar!.id);
const resetId = await mk(RESET_USER, "重置目标", mr!.id);
const anonId = await mk(ANON_USER, "匿名化目标", mr!.id);
const tfaId = await mk(TFA_USER, "二因子用户", mr!.id);
await mk(LOCK_USER, "锁定目标", mr!.id);
await loadActor(adminId);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const loginHttp = (username: string, password: string, extra: Record<string, unknown> = {}) =>
  fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password, ...extra }),
  });

try {
  // ① 登录 → 退出全部会话
  const l1 = await loginHttp(ADMIN, PW);
  const l1Body = await l1.json() as { csrfToken: string };
  const c1 = { cookie: l1.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(l1Body.csrfToken) };
  const lo = await fetch(`${BASE}/api/v1/auth/logout-all`, { method: "POST", headers: c1 });
  ok("退出全部会话 200", lo.status === 200, String(lo.status));

  // ② 登录 → 撤销单个会话
  const l2 = await loginHttp(ADMIN, PW);
  const l2Body = await l2.json() as { csrfToken: string };
  const cookie2 = l2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const H2 = { cookie: cookie2, "x-csrf-token": decodeURIComponent(l2Body.csrfToken) };
  const sessionsRes = await fetch(`${BASE}/api/v1/auth/sessions`, { headers: { cookie: cookie2 } });
  const sessions = await sessionsRes.json() as { id: string }[];
  const targetSession = sessions[0];
  const del = await fetch(`${BASE}/api/v1/auth/sessions/${targetSession!.id}`, { method: "DELETE", headers: H2 });
  ok("撤销单个会话 200", del.status === 200, String(del.status));

  // 刚才撤销的可能就是当前会话 → 重新登录拿一个可用会话做后续步骤
  const l2b = await loginHttp(ADMIN, PW);
  const l2bBody = await l2b.json() as { csrfToken: string };
  const H2b = {
    cookie: l2b.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(l2bBody.csrfToken),
  };

  // ③ 密码重置（管理员发链接 → 公开重置）
  const issue = await fetch(`${BASE}/api/v1/members/${resetId}/reset-link`, { method: "POST", headers: H2b });
  const issued = await issue.json() as { token?: string };
  const reset = await fetch(`${BASE}/api/v1/auth/password/reset`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: issued.token, newPassword: "ses-new-pass-9999" }),
  });
  ok("密码重置 200", reset.status === 200, String(reset.status));
  const relogin = await loginHttp(RESET_USER, "ses-new-pass-9999");
  ok("重置后新密码可登录", relogin.status === 200, String(relogin.status));

  // ④ 2FA 恢复码重生成（先真实启用 2FA，再用带 TOTP 的登录拿会话）
  const setup = await tfa.setup(tfaId, { account: TFA_USER });
  const secret = totpLib.base32Decode(setup.otpauthUrl.match(/secret=([A-Z2-7]+)/)![1]!);
  await tfa.activate(tfaId, totpLib.totp(secret));
  const l3 = await loginHttp(TFA_USER, PW, { totpCode: totpLib.totp(secret) });
  const l3Body = await l3.json() as { csrfToken: string };
  ok("二因子用户登录 200", l3.status === 200, String(l3.status));
  const H3 = { cookie: l3.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(l3Body.csrfToken ?? "") };
  const regen = await fetch(`${BASE}/api/v1/auth/2fa/recovery-codes`, { method: "POST", headers: H3 });
  ok("重生成恢复码 200", regen.status === 200, String(regen.status));

  // ⑤ 成员匿名化（管理员）
  const anon = await fetch(`${BASE}/api/v1/members/${anonId}`, { method: "DELETE", headers: H2b });
  ok("成员匿名化 200", anon.status === 200, String(anon.status));

  // ⑥ 登录锁定（放最后：会按 IP 维度计数，避免影响前面的登录）
  let blocked = false;
  for (let i = 0; i < 12; i++) {
    const r = await loginHttp(LOCK_USER, "wrong-password-here");
    if (r.status === 429) { blocked = true; break; }
  }
  ok("连续失败后触发锁定（429）", blocked);

  // ── 库内校验 ──
  const rows = await db.select().from(auditEntry);
  const has = (a: string) => rows.filter((x) => x.action === a);
  ok("退出全部会话有审计", has("auth.logout_all").length === 1);
  ok("撤销会话有审计", has("auth.session_revoked").length >= 1);
  ok("密码重置有审计（actor 为空，快照=用户名）", has("auth.password_reset")[0]?.targetId === resetId && has("auth.password_reset")[0]?.actorSnapshot === RESET_USER);
  ok("2FA 恢复码重生成有审计", has("auth.2fa_recovery_regenerated").length === 1);
  ok("成员匿名化有审计", has("member.anonymized")[0]?.targetId === anonId);
  ok("登录锁定有审计", has("auth.login_blocked").length >= 1 && has("auth.login_blocked")[0]?.actorSnapshot === LOCK_USER);
  ok("新增审计均为 SECURITY 级", ["auth.logout_all", "auth.session_revoked", "auth.password_reset", "auth.2fa_recovery_regenerated", "member.anonymized", "auth.login_blocked"]
    .every((a) => has(a).every((x) => x.severity === "SECURITY")));

  // 释放锁定计数，避免影响后续登录
  const { getRedisClient } = await import("../src/server/auth/cache.ts");
  try { await getRedisClient().del(`feronavi:loginfail:acct:${LOCK_USER.toLowerCase()}`, "feronavi:loginfail:ip:127.0.0.1"); } catch { /* 可丢 */ }
} finally {
  await app.close();
  await db.delete(auditEntry);
  for (const u of [ADMIN, RESET_USER, ANON_USER, TFA_USER, LOCK_USER]) await deleteTestMember(u);
  await sql.end();
  await cache.stop();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
