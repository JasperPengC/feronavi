import assert from "node:assert/strict";
import { createHash } from "node:crypto";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1), /^feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, apiToken, twoFactorSecret, ssoLoginState, idpConfig, invite } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { createSession, verifySession } = await import("../../src/server/auth/session.ts");
const { disableMember, enableMember, anonymizeMember } = await import("../../src/server/services/member.service.ts");
const { patchUser, deleteUser } = await import("../../src/server/services/scim.service.ts");
const { authenticateToken } = await import("../../src/server/services/token.service.ts");
const { verifyForLogin } = await import("../../src/server/services/two-factor.service.ts");
const { consumeState } = await import("../../src/server/services/sso.service.ts");
const { acceptInvite } = await import("../../src/server/services/invite.service.ts");
const { changeOwnPassword, resetPasswordWithToken, issueResetToken } = await import("../../src/server/services/password-reset.service.ts");
const { hashPassword, verifyPassword } = await import("../../src/server/auth/password.ts");
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${String(error)}`); }
}
let sequence = 0;
async function account() {
  const username = `identity-${++sequence}`;
  const [m] = await db.insert(member).values({ username, name: username, email: `${username}@example.test`, status: "ACTIVE", passwordHash: "!test" }).returning();
  const [r] = await db.select().from(role).where(eq(role.key, "MEMBER"));
  await db.insert(roleAssignment).values({ memberId: m!.id, roleId: r!.id, scopeType: "ORG", scopeId: null });
  const raw = `fero_${username}`;
  await db.insert(apiToken).values({ memberId: m!.id, name: "test", tokenHash: createHash("sha256").update(raw).digest("hex"), tokenPrefix: "fero_test", tier: "READ_ONLY", allowedIpCidrs: [], projectWhitelist: [] });
  const session = await createSession({ memberId: m!.id });
  assert.ok(await authenticateToken(raw, "127.0.0.1"));
  return { m: m!, raw, session };
}
try {
  for (const mode of ["admin", "scim-patch", "scim-delete"] as const) await check(`${mode} 停用后启用不恢复旧会话和 API Token`, async () => {
    const { m, raw, session } = await account();
    if (mode === "admin") await disableMember(m.id);
    else if (mode === "scim-patch") await patchUser(m.id, [{ op: "replace", path: "active", value: false }]);
    else await deleteUser(m.id);
    await enableMember(m.id);
    const observed = { session: await verifySession(session.token), token: await authenticateToken(raw, "127.0.0.1") };
    assert.deepEqual(observed, { session: null, token: null });
  });
  await check("注销成员撤销会话与 API Token", async () => {
    const { m, raw, session } = await account();
    await anonymizeMember(m.id);
    assert.equal(await verifySession(session.token), null);
    assert.equal(await authenticateToken(raw, "127.0.0.1"), null);
    const [token] = await db.select().from(apiToken).where(eq(apiToken.memberId, m.id));
    assert.ok(token!.revokedAt);
  });
  await check("同一 2FA 恢复码并发登录只成功一次", async () => {
    const { m } = await account();
    const code = "AABBCCDDEEFF";
    await db.insert(twoFactorSecret).values({ memberId: m.id, status: "ACTIVE", secretEncrypted: "unused", recoveryCodesHash: [createHash("sha256").update(code).digest("hex")] });
    const results = await Promise.all(Array.from({ length: 12 }, () => verifyForLogin(m.id, { recoveryCode: code })));
    assert.equal(results.filter(r => r.ok).length, 1);
  });
  await check("SSO state 并发消费只成功一次", async () => {
    const [idp] = await db.insert(idpConfig).values({ kind: "OIDC", issuer: "https://identity.example.test", clientId: "test", enabled: true }).returning();
    const state = "parallel-state";
    await db.insert(ssoLoginState).values({ state, idpConfigId: idp!.id, nonce: "nonce", codeVerifier: "verifier", redirectUri: "https://feronavi.example.test/callback", expiresAt: new Date(Date.now() + 60000) });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeState(state)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  });
  await check("同一邀请并发接受只创建一个成员，失败者得到业务错误", async () => {
    const { m } = await account(); const token = "identity-invite-token";
    await db.insert(invite).values({ email: "parallel-invite@example.test", tokenHash: createHash("sha256").update(token).digest("hex"), invitedByMemberId: m.id, expiresAt: new Date(Date.now() + 60000) });
    const results = await Promise.allSettled([1, 2].map(n => acceptInvite(token, { username: `invited-${n}`, name: "邀请成员", password: "a-long-invite-password" })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") assert.ok(["VALIDATION", "CONFLICT"].includes(result.reason.code), String(result.reason));
    assert.equal((await db.select().from(member).where(eq(member.email, "parallel-invite@example.test"))).length, 1);
  });
  await check("改密成功撤销旧会话，撤销失败时密码也回滚", async () => {
    const { m, session } = await account();
    const password = "original-long-password", next = "changed-long-password";
    await db.update(member).set({ passwordHash: await hashPassword(password) }).where(eq(member.id, m.id));
    await sql.unsafe(`CREATE FUNCTION reject_identity_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated revocation failure'; END $$`);
    await sql.unsafe("CREATE TRIGGER reject_identity_revocation BEFORE UPDATE ON session FOR EACH ROW EXECUTE FUNCTION reject_identity_revocation()");
    try {
      await assert.rejects(changeOwnPassword(m.id, password, next));
      const [after] = await db.select().from(member).where(eq(member.id, m.id));
      assert.equal(await verifyPassword(after!.passwordHash, password), true);
    } finally { await sql.unsafe("DROP TRIGGER reject_identity_revocation ON session"); }
    await changeOwnPassword(m.id, password, next);
    assert.equal(await verifySession(session.token), null);
  });
  await check("密码重置令牌并发只生效一次并撤销会话", async () => {
    const { m, session } = await account();
    const { token } = await issueResetToken({ memberId: m.id, issuedByMemberId: null });
    const results = await Promise.allSettled(["reset-long-password-one", "reset-long-password-two"].map(password => resetPasswordWithToken(token, password)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await verifySession(session.token), null);
  });
  assert.deepEqual(failures, []);
  console.log("identity security contracts passed");
} finally { await sql.end({ timeout: 2 }); }
