import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 全量导出自检（第十四期）：覆盖、脱敏、可解释排除、权限、schemaVersion */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, apiToken, twoFactorSecret, session, setting, auditEntry, activityEntry, aiProviderConfig, job } from "../src/db/schema.ts";
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
import * as jobService from "../src/server/services/job.service.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { encryptSecret } from "../src/server/services/crypto.service.ts";

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
await settingService.putSettings({ "smtp.password": "super-secret-pw", "smtp.host": "mail.export.test", "ai.apiKey": "full-export-ai-key" });
// 即使秘密标志损坏，也必须延续设置接口按键名掩码的边界。
await db.update(setting).set({ isSecret: false }).where(eq(setting.key, "smtp.password"));
const providerSecret = encryptSecret("full-export-provider-secret");
const [provider] = await db.insert(aiProviderConfig).values({ provider: "OPENAI_COMPAT", baseUrl: "https://export.test", model: "test", embeddingModel: "test", apiKeyEncrypted: providerSecret }).returning();
const seededCredentials = [
  tok.token,
  (await db.select().from(apiToken).where(eq(apiToken.memberId, a.id)))[0]!.tokenHash,
  (await db.select().from(member).where(eq(member.id, a.id)))[0]!.passwordHash!,
  (await db.select().from(twoFactorSecret).where(eq(twoFactorSecret.memberId, a.id)))[0]!.secretEncrypted,
  (await db.select().from(setting).where(eq(setting.key, "smtp.password")))[0]!.value as string,
  (await db.select().from(setting).where(eq(setting.key, "ai.apiKey")))[0]!.value as string,
  providerSecret, "super-secret-pw", "full-export-provider-secret", "full-export-ai-key",
];

const checkCompliance = (label: string, payload: unknown) => {
  const dump = payload as { data: Record<string, Record<string, unknown>[]> };
  const raw = JSON.stringify(dump);
  ok(`${label} 实际 seed 凭据均未出现`, seededCredentials.every((credential) => credential.length > 0 && !raw.includes(credential)));
  ok(`${label} registry 新增业务表可导出`, Array.isArray(dump.data.department));
  ok(`${label} 排除索引/临时/安全表`, ["page_chunk", "index_job", "idempotency_key", "session", "api_token", "two_factor_secret"].every((table) => !(table in dump.data)));
  const providerRow = dump.data.ai_provider_config.find((row: Record<string, unknown>) => row.id === provider!.id);
  ok(`${label} AI 配置保留业务字段并剔除秘密列`, !!providerRow && !("api_key_encrypted" in providerRow));
  const settings = dump.data.setting as { key: string; value: unknown; isSecret: boolean }[];
  const pw = settings.find((row) => row.key === "smtp.password");
  const aiKey = settings.find((row) => row.key === "ai.apiKey");
  const host = settings.find((row) => row.key === "smtp.host");
  ok(`${label} 设置兼容掩码形状且秘密占位确实存在`, !!pw && pw.value === "********" && pw.isSecret === true && Object.keys(pw).sort().join(",") === "isSecret,key,value");
  ok(`${label} registry 过滤的秘密设置仍有掩码占位`, !!aiKey && aiKey.value === "********" && aiKey.isSecret === true);
  ok(`${label} 非秘密设置兼容原值`, !!host && host.value === "mail.export.test" && host.isSecret === false);
  ok(`${label} 成员不含密码哈希列`, dump.data.member.length > 0 && dump.data.member.every((row: Record<string, unknown>) => !("password_hash" in row) && !("passwordHash" in row)));
};

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3975), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3975";

try {
  const dump = await fullExport.fullExport(admin);
  checkCompliance("inline service", dump);
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
  ok("**不含 API 令牌**", !raw.includes(tok.token));
  const tokenRow = (await db.select({ h: apiToken.tokenHash }).from(apiToken).where(eq(apiToken.memberId, a.id)).limit(1))[0]!;
  ok("不含令牌哈希值本身", !raw.includes(tokenRow.h));
  ok("**不含双因素密钥**", !raw.includes("secret_encrypted") && !raw.includes("enc:v1:"));
  ok("不含会话令牌哈希", !raw.includes("token_hash"));
  // 设置按掩码
  const settingsSection = (dump.data as { setting: { key: string; value: unknown; isSecret: boolean }[] }).setting;
  const pw = settingsSection.find((s) => s.key === "smtp.password");
  ok("敏感设置按**掩码**导出（与 GET /settings 同口径）", !!pw && pw.value === "********" && pw.isSecret === true, JSON.stringify(pw));
  ok("导出体里查不到 SMTP 明文密码", !raw.includes("super-secret-pw"));
  // ── 可解释的排除清单 ──
  ok("显式列出被排除的表及原因", Object.keys(dump.excludedTables).length >= 6 && /安全材料/.test(dump.excludedTables.api_token ?? ""),
    Object.keys(dump.excludedTables).join(","));
  ok("兼容 orderHint 字段明确指向系统迁移入口", /\/system\/backups/.test(dump.orderHint));

  // ── 权限 ──
  let denied = false;
  try { await fullExport.fullExport(lowActor); } catch (e) { denied = (e as { code?: string }).code === "FORBIDDEN"; }
  ok("无 setting:manage 者不能全量导出", denied);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: "w14c-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { csrfToken } = await login.json() as { csrfToken: string };
  ok("管理员实际登录成功", login.status === 200 && !!cookie && !!csrfToken);
  const res = await fetch(`${BASE}/api/v1/system/exports/inline`, { headers: { cookie } });
  const body = await res.text();
  checkCompliance("inline HTTP", JSON.parse(body));
  ok("HTTP 全量导出 200，带 attachment 与两个响应头",
    res.status === 200 && (res.headers.get("content-disposition") ?? "").includes("attachment")
    && res.headers.get("x-schema-version") === "1" && res.headers.get("x-export-mode") === "inline",
    `${res.status} ${res.headers.get("x-export-mode")}`);
  ok("HTTP 响应体同样不含密钥材料", !body.includes("$argon2") && !body.includes("super-secret-pw") && !body.includes("enc:v1:"));
  const created = await fetch(`${BASE}/api/v1/system/exports`, { method: "POST", headers: { cookie, "x-csrf-token": decodeURIComponent(csrfToken) } });
  const createdBody = await created.json() as { id: string };
  ok("异步合规导出成功入队", created.status === 201 && !!createdBody.id);
  jobService.clearJobHandlers();
  registerBuiltinJobHandlers();
  await jobService.runJobWorkerOnce("full-export-compliance", 10);
  const downloaded = await fetch(`${BASE}/api/v1/system/exports/${createdBody.id}`, { headers: { cookie } });
  ok("异步下载成功且保留兼容响应头", downloaded.status === 200 && downloaded.headers.get("x-export-mode") === "async" && downloaded.headers.get("x-schema-version") === "1");
  checkCompliance("async HTTP", await downloaded.json());
  const login2 = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: LOW, password: "w14c-password-1234" }),
  });
  const cookie2 = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const deniedRes = await fetch(`${BASE}/api/v1/system/exports/inline`, { headers: { cookie: cookie2 } });
  const deniedBody = await deniedRes.json() as { code: string };
  ok("受限账号 HTTP 导出真实 FORBIDDEN", deniedRes.status === 403 && deniedBody.code === "FORBIDDEN", JSON.stringify(deniedBody));
  const deniedAsync = await fetch(`${BASE}/api/v1/system/exports/${createdBody.id}`, { headers: { cookie: cookie2 } });
  const deniedAsyncBody = await deniedAsync.json() as { code: string };
  ok("受限账号异步下载真实 FORBIDDEN", deniedAsync.status === 403 && deniedAsyncBody.code === "FORBIDDEN");
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(job);
  await db.delete(aiProviderConfig).where(eq(aiProviderConfig.id, provider!.id));
  await db.delete(twoFactorSecret); await db.delete(session); await db.delete(apiToken);
  for (const key of ["smtp.password", "smtp.host", "ai.apiKey"]) await db.delete(setting).where(eq(setting.key, key));
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, LOW]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
