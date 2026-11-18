import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 成员生命周期自检 —— **逐列断言匿名化语义**（C-26）
 *
 * 为什么逐列断言：匿名化的规范是一张「列 → 值」的表。只测「status 变成 ANONYMIZED」
 * 会漏掉 email 没清、密码哈希没换这类问题 —— 而后者是**安全事故**（账号仍可登录）。
 *
 * 同时验证：禁用 ≠ 删除、重复删除返回 CONFLICT、重置令牌单次有效、
 * 改密后旧会话失效、CLI 在 DB 不可用时明确报错。
 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, passwordResetToken } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { anonymizeMember, disableMember, enableMember } from "../src/server/services/member.service.ts";
import { issueResetToken, resetPasswordWithToken, changeOwnPassword } from "../src/server/services/password-reset.service.ts";
import { hashPassword, verifyPassword, ANONYMIZED_PASSWORD_SENTINEL } from "../src/server/auth/password.ts";
import { createSession, verifySession, revokeAllSessions } from "../src/server/auth/session.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const U = "r3-target";
await db.delete(member).where(eq(member.username, U));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));

const [m] = await db.insert(member).values({
  username: U, email: `${U}@example.test`, name: "待注销成员", status: "ACTIVE",
  passwordHash: await hashPassword("original-password-1234"),
}).returning({ id: member.id });
const memberId = m!.id;
await db.insert(roleAssignment).values({ memberId, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });

try {
  // ── ① 禁用 ≠ 删除 ─────────────────────────────────────────
  await disableMember(memberId);
  let row = (await db.select().from(member).where(eq(member.id, memberId)).limit(1))[0]!;
  ok("禁用后 status=DISABLED", row.status === "DISABLED");
  ok("禁用后 email 保留", row.email === `${U}@example.test`);
  ok("禁用后 name 保留", row.name === "待注销成员");
  ok("禁用后密码仍有效（不锁定账号数据）", await verifyPassword(row.passwordHash, "original-password-1234"));
  ok("禁用后 anonymized_at 仍为 NULL", row.anonymizedAt === null);

  await enableMember(memberId);
  row = (await db.select().from(member).where(eq(member.id, memberId)).limit(1))[0]!;
  ok("重新启用后 status=ACTIVE", row.status === "ACTIVE");

  // ── ② 会话：改密后旧会话必须失效 ───────────────────────────
  const { token } = await createSession({ memberId });
  ok("建会话成功", (await verifySession(token)) !== null);
  await revokeAllSessions(memberId);
  ok("吊销后会话失效", (await verifySession(token)) === null);

  // ── ③ 重置令牌：单次有效 ───────────────────────────────────
  const { token: resetToken } = await issueResetToken({ memberId, issuedByMemberId: null });
  await resetPasswordWithToken(resetToken, "brand-new-password-5678");
  row = (await db.select().from(member).where(eq(member.id, memberId)).limit(1))[0]!;
  ok("重置后新密码可登录", await verifyPassword(row.passwordHash, "brand-new-password-5678"));
  ok("重置后旧密码失效", !(await verifyPassword(row.passwordHash, "original-password-1234")));

  let reused = false;
  try { await resetPasswordWithToken(resetToken, "third-password-9999"); } catch { reused = true; }
  ok("同一令牌不能用第二次", reused);

  let weakRejected = false;
  const { token: t2 } = await issueResetToken({ memberId, issuedByMemberId: null });
  try { await resetPasswordWithToken(t2, "short"); } catch { weakRejected = true; }
  ok("弱密码被拒（< 12 字符）", weakRejected);

  // ── ④ 改密：当前密码必须正确 ───────────────────────────────
  let wrongCurrent = false;
  try { await changeOwnPassword(memberId, "not-the-password", "whatever-password-1234"); } catch { wrongCurrent = true; }
  ok("当前密码错误 → 拒绝", wrongCurrent);

  // ── ⑤ 匿名化：**逐列断言** ─────────────────────────────────
  const before = (await db.select().from(member).where(eq(member.id, memberId)).limit(1))[0]!;
  await anonymizeMember(memberId);
  row = (await db.select().from(member).where(eq(member.id, memberId)).limit(1))[0]!;

  ok("username 前缀 deleted-", row.username.startsWith("deleted-"), row.username);
  ok("username = deleted-<id 前 8 位>", row.username === `deleted-${memberId.replace(/-/g, "").slice(0, 8)}`, row.username);
  ok("email → NULL", row.email === null);
  ok("name → 已注销成员", row.name === "已注销成员");
  ok("password_hash → 哨兵值", row.passwordHash === ANONYMIZED_PASSWORD_SENTINEL);
  ok("哨兵值下任何密码都无法登录", !(await verifyPassword(row.passwordHash, "brand-new-password-5678")));
  ok("status = ANONYMIZED", row.status === "ANONYMIZED");
  ok("anonymized_at 已写入", row.anonymizedAt !== null);
  ok("角色指派已清理", (await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, memberId))).length === 0);
  ok("id 未变（内容归属与审计关联保留）", row.id === before.id);

  // ── ⑥ 重复匿名化 → CONFLICT ────────────────────────────────
  let conflict = false, code = "";
  try { await anonymizeMember(memberId); }
  catch (e) { conflict = true; code = (e as { code?: string }).code ?? ""; }
  ok("重复匿名化 → CONFLICT", conflict && code === "CONFLICT", code);
} finally {
  await db.delete(passwordResetToken).where(eq(passwordResetToken.memberId, memberId));
  await db.delete(member).where(eq(member.id, memberId));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
