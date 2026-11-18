import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 双因素自检（第十四期）：RFC 6238 官方向量、激活闸门、恢复码一次性、关闭需密码 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, twoFactorSecret, session, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as tfa from "../src/server/services/two-factor.service.ts";
import * as totpLib from "../src/server/lib/totp.ts";
import * as authService from "../src/server/services/auth.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w14-2fa";
await db.delete(auditEntry); await db.delete(activityEntry);
await db.delete(member).where(eq(member.username, U));
await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({ username: U, email: "w14@x.test", name: "二因子用户", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14-password-1234") }).returning({ id: member.id });
await db.delete(twoFactorSecret).where(eq(twoFactorSecret.memberId, m!.id));

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3977), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3977";

try {
  // ── RFC 6238 附录 B 官方向量（SHA1 / 8 位；取后 6 位即 6 位实现）──
  const RFC = Buffer.from("12345678901234567890", "ascii");
  const vectors: [number, string][] = [
    [59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"],
    [1234567890, "89005924"], [2000000000, "69279037"],
  ];
  const allMatch = vectors.every(([t, expect8]) => totpLib.totp(RFC, t * 1000, 30, 8) === expect8);
  ok("**RFC 6238 官方向量全部匹配**（算法正确性对标标准，不是自测）", allMatch,
    vectors.map(([t, e]) => `${t}:${totpLib.totp(RFC, t * 1000, 30, 8)}≠${e}`).filter((x) => x.includes("≠")).join(","));
  ok("6 位输出 = 8 位后 6 位", totpLib.totp(RFC, 59_000, 30, 6) === "287082", totpLib.totp(RFC, 59_000, 30, 6));
  ok("Base32 往返一致（RFC 4648）", totpLib.base32Decode(totpLib.base32Encode(RFC)).equals(RFC));
  ok("官方种子 Base32 = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    totpLib.base32Encode(RFC) === "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", totpLib.base32Encode(RFC));

  // ── 注册与激活 ──
  const st0 = await tfa.state(m!.id);
  ok("初始未启用", st0.enabled === false && st0.pending === false);
  const setup = await tfa.setup(m!.id, { account: U });
  ok("setup 返回 otpauth 链接与恢复码", setup.otpauthUrl.startsWith("otpauth://totp/") && setup.recoveryCodes.length === 10);
  const row = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, m!.id)).limit(1))[0]!;
  ok("密钥信封加密入库（enc:v1:）", row.secretEncrypted.startsWith("enc:v1:"));
  ok("恢复码只存哈希（明文不出现在库里）",
    ((row.recoveryCodesHash ?? []) as string[]).every((h) => h.length === 64)
    && !JSON.stringify(row.recoveryCodesHash).includes(setup.recoveryCodes[0]!.replace(/-/g, "")));
  ok("状态为 PENDING（未激活）", row.status === "PENDING");
  // PENDING 期间登录**不受影响**（否则用户会被锁在门外）
  const preLogin = await authService.login({ username: U, password: "w14-password-1234" }, { ip: "127.0.0.1", userAgent: "test" });
  ok("PENDING 状态不拦截登录（避免把用户锁死）", !!preLogin.token);
  let wrongActivate = false;
  try { await tfa.activate(m!.id, "000000"); } catch (e) { wrongActivate = (e as { code?: string }).code === "VALIDATION"; }
  ok("错误动态码不能激活", wrongActivate);
  const secret = totpLib.base32Decode(setup.otpauthUrl.match(/secret=([A-Z2-7]+)/)![1]!);
  const activated = await tfa.activate(m!.id, totpLib.totp(secret));
  ok("正确动态码激活成功", activated.activated === true);

  // ── 登录闸门 ──
  let noCode = false, codeMsg = "";
  try { await authService.login({ username: U, password: "w14-password-1234" }, { ip: "127.0.0.1", userAgent: "test" }); }
  catch (e) { noCode = (e as { code?: string }).code === "FORBIDDEN"; codeMsg = (e as Error).message; }
  ok("**已启用后不给码 → 拒绝且不签发会话**（二因子真在闸门上）", noCode && /双因素/.test(codeMsg), codeMsg.slice(0, 40));
  const sessionsBefore = await sql<{ n: number }[]>`select count(*)::int as n from session where member_id = ${m!.id}`;
  let badCode = false;
  try { await authService.login({ username: U, password: "w14-password-1234", totpCode: "000000" }, { ip: "127.0.0.1", userAgent: "test" }); }
  catch (e) { badCode = (e as { code?: string }).code === "FORBIDDEN"; }
  ok("错误动态码 → 拒绝", badCode);
  const sessionsAfterBad = await sql<{ n: number }[]>`select count(*)::int as n from session where member_id = ${m!.id}`;
  ok("被拒的登录**没有新增会话**", sessionsAfterBad[0]!.n === sessionsBefore[0]!.n, `${sessionsBefore[0]!.n}→${sessionsAfterBad[0]!.n}`);
  const good = await authService.login({ username: U, password: "w14-password-1234", totpCode: totpLib.totp(secret) }, { ip: "127.0.0.1", userAgent: "test" });
  ok("正确动态码 → 签发会话", !!good.token);
  // 时钟窗（±1 步）容忍
  const past = await authService.login({ username: U, password: "w14-password-1234", totpCode: totpLib.totp(secret, Date.now() - 30_000) }, { ip: "127.0.0.1", userAgent: "test" });
  ok("上一步的码在容忍窗内可用（时钟漂移是现实）", !!past.token);
  const tooOld = await authService.login({ username: U, password: "w14-password-1234", totpCode: totpLib.totp(secret, Date.now() - 120_000) }, { ip: "127.0.0.1", userAgent: "test" })
    .then(() => true).catch(() => false);
  ok("过旧的码不可用（窗口不是无限大）", tooOld === false);

  // ── 恢复码：一次性 ──
  const rc = setup.recoveryCodes[0]!;
  const viaRc = await authService.login({ username: U, password: "w14-password-1234", recoveryCode: rc }, { ip: "127.0.0.1", userAgent: "test" });
  ok("恢复码可登录", !!viaRc.token);
  const reuse = await authService.login({ username: U, password: "w14-password-1234", recoveryCode: rc }, { ip: "127.0.0.1", userAgent: "test" })
    .then(() => true).catch(() => false);
  ok("**同一个恢复码不能二次使用**（用后作废）", reuse === false);
  const remaining = ((await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, m!.id)).limit(1))[0]!.recoveryCodesHash ?? []) as string[];
  ok("库内恢复码从 10 减为 9", remaining.length === 9, String(remaining.length));
  const regen = await tfa.regenerateRecoveryCodes(m!.id);
  ok("重新生成恢复码", regen.recoveryCodes.length === 10 && /旧恢复码已全部失效/.test(regen.note));
  const oldStillWorks = await authService.login({ username: U, password: "w14-password-1234", recoveryCode: setup.recoveryCodes[1]! }, { ip: "127.0.0.1", userAgent: "test" })
    .then(() => true).catch(() => false);
  ok("重新生成后旧恢复码失效", oldStillWorks === false);

  // ── 关闭需密码 ──
  let wrongPw = false;
  try { await tfa.disable(m!.id, "wrong-password"); } catch (e) { wrongPw = (e as { code?: string }).code === "FORBIDDEN"; }
  ok("关闭双因素需**重新验证密码**（密码错则拒绝）", wrongPw);
  ok("密码错时双因素仍然启用", (await tfa.state(m!.id)).enabled === true);
  await tfa.disable(m!.id, "w14-password-1234");
  ok("正确密码可关闭", (await tfa.state(m!.id)).enabled === false);
  const afterDisable = await authService.login({ username: U, password: "w14-password-1234" }, { ip: "127.0.0.1", userAgent: "test" });
  ok("关闭后登录不再要求动态码", !!afterDisable.token);

  // ── HTTP ──
  const login1 = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: "w14-password-1234" }),
  });
  const cookie = login1.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login1.json()) as { csrfToken: string }).csrfToken;
  const httpSetup = await fetch(`${BASE}/api/v1/auth/2fa/setup`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf }, body: "{}",
  });
  const setupBody = (await httpSetup.json()) as { otpauthUrl?: string; recoveryCodes?: string[] };
  ok("HTTP setup 200 且返回 otpauth", httpSetup.status === 200 && !!setupBody.otpauthUrl, String(httpSetup.status));
  const httpState = await fetch(`${BASE}/api/v1/auth/2fa`, { headers: { cookie } });
  ok("HTTP 状态查询显示 pending", ((await httpState.json()) as { pending: boolean }).pending === true);
  const anon = await fetch(`${BASE}/api/v1/auth/2fa`);
  ok("匿名访问状态端点被拒", anon.status === 403, String(anon.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(twoFactorSecret);
  await db.delete(session).where(eq(session.memberId, m!.id));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, m!.id));
  await db.delete(member).where(eq(member.username, U));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
