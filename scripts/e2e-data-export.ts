import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 个人数据导出自检（第十四期）：只导本人、不含安全材料、不含他人内容、可解释边界 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, comment, todo, timeLog, idea, apiToken, twoFactorSecret, session, ragConsent, aiProviderConfig, auditEntry, activityEntry, setting } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as commentService from "../src/server/services/comment.service.ts";
import * as exportService from "../src/server/services/data-export.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, inArray } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const A = "w14b-alice", B = "w14b-bob";
const KEY = "W14BPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [A, B]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const mk = async (u: string, n: string, email: string) => (await db.insert(member).values({
  username: u, email, name: n, status: "ACTIVE", timezone: "Asia/Shanghai",
  passwordHash: await hashPassword("w14b-password-1234"),
}).returning({ id: member.id }))[0]!;
const alice = await mk(A, "爱丽丝", "alice-private@x.test");
const bob = await mk(B, "鲍勃", "bob@x.test");
await db.insert(roleAssignment).values([{ memberId: alice.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null }]);
const aliceActor = (await loadActor(alice.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(aliceActor, { key: KEY, name: "W14B 导出" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3976), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3976";

try {
  // ── 造数据：爱丽丝与鲍勃各有内容 ──
  const wi = await wiService.createWorkItem(aliceActor, pid, { type: "TASK", title: "爱丽丝的任务" });
  await commentService.createComment(aliceActor, { targetType: "WORK_ITEM", targetId: wi.id, body: "爱丽丝的评论正文" });
  await commentService.createComment((await loadActor(bob.id))! as never, { targetType: "WORK_ITEM", targetId: wi.id, body: "鲍勃的评论正文" }).catch(() => {});
  await db.insert(todo).values({ memberId: alice.id, title: "爱丽丝的待办" }).catch(() => {});
  await db.insert(timeLog).values({ memberId: alice.id, workItemId: wi.id, minutes: 30, loggedDate: "2026-11-01" });
  await db.insert(idea).values({ projectId: pid, title: "爱丽丝的想法", submittedByMemberId: alice.id });
  const tok = await tokenService.createToken(aliceActor, { name: "导出测试令牌", tier: "READ_ONLY" });
  // 双因素：让导出里有"是否启用"但不含密钥
  const setupRes = await (await import("../src/server/services/two-factor.service.ts")).setup(alice.id, { account: A });

  // ── 导出 ──
  const data = await exportService.exportMemberData(alice.id);
  ok("导出含 schemaVersion 与生成时间", data.schemaVersion === "1" && !!data.generatedAt, data.schemaVersion);
  ok("主体是本人", data.subject.memberId === alice.id && data.subject.username === A);
  ok("含个人资料（用户名/邮箱/时区）", data.sections.profile.username === A && data.sections.profile.timezone === "Asia/Shanghai");

  // **安全材料一律不得出现** —— 这是本期的核心断言
  const raw = JSON.stringify(data);
  ok("**不含密码哈希**", !raw.includes("$argon2") && !("passwordHash" in (data.sections.profile as object)));
  ok("**不含 API 令牌明文**（本次创建的 fero_ 令牌不在导出里）", !raw.includes(tok.token.slice(0, 20)));
  const tokenRow = (await db.select({ h: apiToken.tokenHash }).from(apiToken).where(eq(apiToken.memberId, alice.id)).limit(1))[0]!;
  ok("**不含 API 令牌哈希**", !raw.includes(tokenRow.h));
  const tfRow = (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, alice.id)).limit(1))[0]!;
  ok("**不含双因素密钥与恢复码哈希**", !raw.includes(tfRow.secretEncrypted) && !raw.includes((tfRow.recoveryCodesHash as string[])[0]!));
  ok("**不含会话令牌哈希**", !raw.includes("token_hash") && !raw.includes("tokenHash"));
  ok("双因素只导出状态（是否启用）", (data.sections.twoFactor as { status: string }[])[0]!.status === "PENDING");

  // **他人内容不得出现**
  ok("**不含他人的评论正文**", !raw.includes("鲍勃的评论正文"), "泄露了他人评论");
  ok("含本人评论正文", raw.includes("爱丽丝的评论正文"));
  ok("**不含他人的邮箱**", !raw.includes("bob@x.test"));
  ok("导出张数统计与内容一致", data.counts.comments === 1 && data.counts.workItems === 1, JSON.stringify(data.counts));

  // 边界可解释
  ok("明确列出未导出项及原因（可携带权的边界必须可解释）",
    Array.isArray(data.excludes) && data.excludes.length === 3 && data.excludes[0]!.includes("密码哈希"), JSON.stringify(data.excludes).slice(0, 60));

  // ── HTTP：仅本人、附件头、schemaVersion ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: A, password: "w14b-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/v1/me/data-export`, { headers: { cookie } });
  const body = await res.text();
  ok("HTTP 导出 200，带 attachment 与 x-schema-version",
    res.status === 200
    && (res.headers.get("content-disposition") ?? "").includes("attachment")
    && res.headers.get("x-schema-version") === "1",
    `${res.status} ${res.headers.get("content-disposition")}`);
  ok("HTTP 响应体不含密码哈希与令牌明文", !body.includes("$argon2") && !body.includes(tok.token.slice(0, 20)));
  // 换账号导出得到的是**自己的**数据
  const login2 = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: B, password: "w14b-password-1234" }),
  });
  const cookie2 = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res2 = await fetch(`${BASE}/api/v1/me/data-export`, { headers: { cookie: cookie2 } });
  const body2 = (await res2.json()) as { subject: { username: string } };
  ok("另一个账号导出的是自己的数据（接口无 memberId 参数）", body2.subject.username === B, body2.subject.username);
  const anon = await fetch(`${BASE}/api/v1/me/data-export`);
  ok("匿名访问被拒", anon.status === 403, String(anon.status));
  void setupRes; void bob;
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(twoFactorSecret);
  await db.delete(ragConsent); await db.delete(aiProviderConfig);
  await db.delete(session);
  await db.delete(apiToken);
  await db.delete(idea); await db.delete(timeLog); await db.delete(todo);
  await db.delete(comment); await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [A, B]) await db.delete(member).where(eq(member.username, u));
  await db.delete(setting).where(inArray(setting.key, ["ai.enabled"]));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
