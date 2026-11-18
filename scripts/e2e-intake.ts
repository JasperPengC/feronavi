import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** Intake 自检（第十一期）：匿名提交、令牌只存哈希、限流、转想法、删表单保护 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workItem, idea, ideaVote, intakeForm, intakeSubmission, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as intakeService from "../src/server/services/intake.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w11b-admin", G = "w11b-outsider";
const KEY = "W11BPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w11b@x.test", name: "收集管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w11b-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "w11bg@x.test", name: "无权者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w11b-password-1234") }).returning({ id: member.id });
const outsider = (await loadActor(g!.id))!;

await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W11B 收集项目" });

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3988), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3988";

const SCHEMA = [
  { key: "title", label: "需求标题", type: "TEXT", required: true },
  { key: "detail", label: "详细说明", type: "TEXTAREA" },
  { key: "urgency", label: "紧急程度", type: "SELECT", required: true, options: ["低", "中", "高"] },
];

try {
  // ── 建表单：明文令牌只出现一次 ──
  const created = await intakeService.createForm(admin, pid, { name: "外部需求收集", schema: SCHEMA });
  const token = created.submitToken;
  ok("建表单返回明文令牌（intk_ 前缀）", token.startsWith("intk_"), token.slice(0, 10));
  const row = (await db.select().from(intakeForm).where(eq(intakeForm.id, created.form.id)).limit(1))[0]!;
  ok("库里只存哈希、查不到明文", row.submitTokenHash.length === 64 && !row.submitTokenHash.includes(token));
  ok("返回体不含哈希", !JSON.stringify(created.form).includes(row.submitTokenHash));
  const listed = await intakeService.listForms(admin, pid);
  ok("列表接口不泄露哈希", !JSON.stringify(listed).includes(row.submitTokenHash));

  // ── 字段校验 ──
  const bad = async (label: string, schema: unknown) => {
    let hit = false, code = "";
    try { await intakeService.createForm(admin, pid, { name: "x", schema }); } catch (e) { hit = true; code = (e as { code?: string }).code ?? ""; }
    ok(label, hit && code === "VALIDATION", code);
  };
  await bad("空字段定义 → VALIDATION", []);
  await bad("key 非法 → VALIDATION", [{ key: "1bad", label: "x" }]);
  await bad("key 重复 → VALIDATION", [{ key: "a", label: "A" }, { key: "a", label: "B" }]);
  await bad("SELECT 无选项 → VALIDATION", [{ key: "s", label: "S", type: "SELECT" }]);

  // ── 匿名提交（真 HTTP，无 cookie）──
  const post = (body: unknown, tok = token) => fetch(`${BASE}/api/v1/intake/${tok}/submissions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const okRes = await post({ title: "希望支持深色导出", detail: "导出 PDF 想深色", urgency: "中" });
  ok("匿名提交成功（201）", okRes.status === 201, String(okRes.status));
  const okBody = (await okRes.json()) as { ok: boolean; id: string };
  ok("返回提交 ID", okBody.ok === true && !!okBody.id);

  const missing = await post({ title: "缺必填" });          // urgency 是必填但没给
  ok("缺必填字段 → 400", missing.status === 400, String(missing.status));
  const badOpt = await post({ title: "x", urgency: "不存在" });
  ok("SELECT 取值不在选项 → 400", badOpt.status === 400, String(badOpt.status));
  // ⚠️ 本项目约定：NOT_FOUND 与"不可见"统一映射为 403，避免用状态码探测资源是否存在
  const badTok = await post({ title: "x", urgency: "低" }, "intk_notarealtoken");
  const noTok = await fetch(`${BASE}/api/v1/intake/intk_x/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const badTokBody = await badTok.text();
  const noTokBody = await noTok.text();
  ok("无效令牌与不存在的入口同形（403 + 同文案，不泄露存在性）",
    badTok.status === 403 && noTok.status === 403 && badTokBody === noTokBody, `${badTok.status}/${noTok.status} ${badTokBody.slice(0, 60)}`);

  // 未知字段被丢弃（不把表单当 KV 用）
  const withExtra = await post({ title: "带额外字段", urgency: "低", evil: "x".repeat(50) });
  const extra = (await db.select().from(intakeSubmission).where(eq(intakeSubmission.id, ((await withExtra.json()) as { id: string }).id)).limit(1))[0]!;
  ok("未知字段被丢弃", !("evil" in (extra.payload as object)), JSON.stringify(extra.payload));

  // 停用后不可提交
  await intakeService.updateForm(admin, created.form.id, { isActive: false });
  ok("停用后匿名提交被拒（同形 403）", (await post({ title: "x", urgency: "低" })).status === 403);
  await intakeService.updateForm(admin, created.form.id, { isActive: true });

  // ── 限流（公开写入必须挡刷）──
  let last = 0;
  for (let i = 0; i < 14; i++) last = (await post({ title: `刷 ${i}`, urgency: "低" })).status;
  ok("超过每分钟上限后被限流（429）", last === 429, String(last));

  // ── 提交列表与转想法 ──
  const subs = await intakeService.listSubmissions(admin, pid, { status: "PENDING" });
  ok("提交列表可读且带表单名", subs.items.length >= 2 && !!subs.items[0]!.formName, String(subs.items.length));
  const target = subs.items.find((x) => (x.payload as Record<string, string>).title === "希望支持深色导出")!;
  const conv = await intakeService.convertSubmission(admin, target.id);
  ok("转想法成功", !!conv.idea && !conv.alreadyConverted);
  ok("想法标题取首字段、正文保留其余字段",
    conv.idea!.title === "希望支持深色导出" && /紧急程度：中/.test(conv.idea!.description ?? ""),
    JSON.stringify(conv.idea!.description));
  ok("提交状态置 CONVERTED",
    (await db.select().from(intakeSubmission).where(eq(intakeSubmission.id, target.id)).limit(1))[0]!.status === "CONVERTED");
  const conv2 = await intakeService.convertSubmission(admin, target.id);
  ok("重复转是幂等的", conv2.alreadyConverted === true && conv2.idea!.id === conv.idea!.id);
  await intakeService.rejectSubmission(admin, subs.items.find((x) => x.id !== target.id)!.id);
  ok("驳回置 REJECTED", (await intakeService.listSubmissions(admin, pid, { status: "REJECTED" })).items.length === 1);

  // ── 删表单保护（有提交记录必须拒绝）──
  let delRejected = false, code = "";
  try { await intakeService.deleteForm(admin, created.form.id); } catch (e) { delRejected = true; code = (e as { code?: string }).code ?? ""; }
  ok("有提交记录时删表单 → CONFLICT（并提示可停用）", delRejected && code === "CONFLICT", code);

  // ── 权限 ──
  let denied = false;
  try { await intakeService.listForms(outsider, pid); } catch { denied = true; }
  ok("无 idea:manage 者看不到表单", denied);
  let deniedSubmit = false;
  try { await intakeService.createForm(outsider, pid, { name: "x", schema: SCHEMA }); } catch { deniedSubmit = true; }
  ok("无 idea:manage 者不能建表单", deniedSubmit);

  // ── 活动与审计：收集表单/匿名提交/转化/驳回都必须可追责 ──
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, pid));
  const ofAct = (a: string) => acts.filter((x) => x.action === a);
  ok("表单创建/更新写活动", ofAct("intake.form_created").length === 1 && ofAct("intake.form_updated").length >= 1,
    JSON.stringify(acts.map((x) => x.action)));
  ok("匿名提交写活动且 actor 为空（外部来源）",
    ofAct("intake.submitted").length >= 2 && ofAct("intake.submitted").every((x) => x.actorId === null),
    `${ofAct("intake.submitted").length} 条`);
  ok("提交活动摘要只报表单名，不含提交正文（防 PII）",
    ofAct("intake.submitted").every((x) => x.summary.includes("收到一条外部提交") && !x.summary.includes("深色导出")));
  ok("转化与驳回写活动（actor 为管理员）",
    ofAct("intake.converted").length === 1 && ofAct("intake.rejected").length === 1
    && ofAct("intake.converted")[0]!.actorId === a!.id,
    JSON.stringify({ conv: ofAct("intake.converted").length, rej: ofAct("intake.rejected").length }));
  const intkAudit = (await db.select().from(auditEntry)).filter((x) => x.action.startsWith("intake."));
  ok("收集类动作写 BUSINESS 审计", intkAudit.length >= 4 && intkAudit.every((x) => x.severity === "BUSINESS"), String(intkAudit.length));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(intakeSubmission);
  await db.delete(intakeForm);
  await db.delete(ideaVote);
  await db.delete(idea);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
