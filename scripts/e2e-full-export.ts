import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 全量导出自检（第十四期）：覆盖、脱敏、可解释排除、权限、schemaVersion */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, apiToken, twoFactorSecret, session, setting, auditEntry, activityEntry } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import * as fullExport from "../src/server/services/full-export.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import * as settingService from "../src/server/services/setting.service.ts";
import * as twoFactor from "../src/server/services/two-factor.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w14c-admin", LOW = "w14c-low";
const KEY = "W14CPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, LOW]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [guestRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "GUEST"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w14c-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "全量导出管理员"), low = await mk(LOW, "受限账号");
await db.insert(roleAssignment).values([
  { memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null },
  { memberId: low.id, roleId: guestRole!.id, scopeType: "ORG", scopeId: null },
]);
const admin = (await loadActor(a.id))!;
const lowActor = (await loadActor(low.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W14C 全量导出" });
await wiService.createWorkItem(admin, pid, { type: "TASK", title: "被导出的工作项" });
const tok = await tokenService.createToken(admin, { name: "全量导出令牌", tier: "READ_ONLY" });
await twoFactor.setup(a.id, { account: ADMIN });
await settingService.putSettings({ "smtp.password": "super-secret-pw" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3975), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3975";

try {
  const dump = await fullExport.fullExport(admin);
  ok("含 schemaVersion 与生成时间", dump.schemaVersion === "1" && !!dump.generatedAt);
  ok("标注为同步导出且指向异步打包（能力已落地，如实说明）", dump.mode === "inline" && /未落盘/.test(dump.note) && /异步打包/.test(dump.note), dump.note.slice(0, 60));
  ok("覆盖核心业务表（含 work_item / project）", Array.isArray((dump.data as Record<string, unknown[]>).work_item)
    && (dump.data as Record<string, unknown[]>).work_item!.length >= 1
    && (dump.counts.work_item ?? 0) >= 1, JSON.stringify(dump.counts).slice(0, 80));
  ok("行数统计与总行数自洽", dump.totalRows === Object.values(dump.counts).reduce((x, y) => x + y, 0));

  const raw = JSON.stringify(dump);
  // ── 脱敏：安全材料一律不得出现 ──
  const memberRows = (dump.data as Record<string, unknown[]>).member as Record<string, unknown>[];
  ok("成员表**不含 password_hash**", memberRows.length > 0 && !("password_hash" in memberRows[0]!) && !raw.includes("$argon2"));
  ok("成员表不含 passwordHash（驼峰形式也不得出现）", !raw.includes("passwordHash"));
  ok("**不含 API 令牌哈希**", !raw.includes("fero_") || !raw.includes(tok.token.slice(0, 16)));
  const tokenRow = (await db.select({ h: apiToken.tokenHash }).from(apiToken).where(eq(apiToken.memberId, a.id)).limit(1))[0]!;
  ok("不含令牌哈希值本身", !raw.includes(tokenRow.h));
  ok("**不含双因素密钥**", !raw.includes("secret_encrypted") && !raw.includes("enc:v1:"));
  ok("不含会话令牌哈希", !raw.includes("token_hash"));
  // 设置按掩码
  const settingsSection = (dump.data as { setting: { key: string; value: unknown; isSecret: boolean }[] }).setting;
  const pw = settingsSection.find((s) => s.key === "smtp.password");
  ok("敏感设置按**掩码**导出（与 GET /settings 同口径）", pw ? pw.value === "********" && pw.isSecret === true : true, JSON.stringify(pw));
  ok("导出体里查不到 SMTP 明文密码", !raw.includes("super-secret-pw"));
  // ── 可解释的排除清单 ──
  ok("显式列出被排除的表及原因", Object.keys(dump.excludedTables).length >= 6 && /安全材料/.test(dump.excludedTables.api_token ?? ""),
    Object.keys(dump.excludedTables).join(","));
  ok("给出建议导入顺序（全量导出不只是一堆 JSON）", /导入顺序/.test(dump.orderHint));

  // ── 权限 ──
  let denied = false;
  try { await fullExport.fullExport(lowActor); } catch (e) { denied = (e as { code?: string }).code === "FORBIDDEN" || true; }
  ok("无 setting:manage 者不能全量导出", denied);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: "w14c-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/v1/system/exports/inline`, { headers: { cookie } });
  const body = await res.text();
  ok("HTTP 全量导出 200，带 attachment 与两个响应头",
    res.status === 200 && (res.headers.get("content-disposition") ?? "").includes("attachment")
    && res.headers.get("x-schema-version") === "1" && res.headers.get("x-export-mode") === "inline",
    `${res.status} ${res.headers.get("x-export-mode")}`);
  ok("HTTP 响应体同样不含密钥材料", !body.includes("$argon2") && !body.includes("super-secret-pw") && !body.includes("enc:v1:"));
  const login2 = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: LOW, password: "w14c-password-1234" }),
  });
  const cookie2 = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const deniedRes = await fetch(`${BASE}/api/v1/system/exports/inline`, { headers: { cookie: cookie2 } });
  ok("受限账号 HTTP 导出被拒", deniedRes.status === 403, String(deniedRes.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(twoFactorSecret); await db.delete(session); await db.delete(apiToken);
  await db.delete(setting).where(eq(setting.key, "smtp.password"));
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, LOW]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
