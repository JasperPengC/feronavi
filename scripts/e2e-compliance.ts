import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** 合规留痕 · Skill · 研发活跃度自检（第十三期收口） */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, ragConsent, devActivityDaily, skill, aiProviderConfig, setting, auditEntry, activityEntry, workItem, milestone, iteration, release, module as moduleT } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as compliance from "../src/server/services/compliance.service.ts";
import * as ai from "../src/server/services/ai-config.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { eq, inArray } from "drizzle-orm";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const ADMIN = "w13e-admin", MEMBERU = "w13e-member", OTHER = "w13e-other";
const KEY = "W13EPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [ADMIN, MEMBERU, OTHER]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (u: string, n: string) => (await db.insert(member).values({ username: u, email: `${u}@x.test`, name: n, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w13e-password-1234") }).returning({ id: member.id }))[0]!;
const a = await mk(ADMIN, "合规管理员"), m = await mk(MEMBERU, "成员甲"), o = await mk(OTHER, "成员乙");
await db.insert(roleAssignment).values({ memberId: a.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a.id))!;
await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W13E 合规" });
await db.insert(roleAssignment).values([
  { memberId: m.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid },
  { memberId: o.id, roleId: memberRole!.id, scopeType: "PROJECT", scopeId: pid },
]);
const memberActor = (await loadActor(m.id))!;
const otherActor = (await loadActor(o.id))!;

await ensureInitialized();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3978), host: "127.0.0.1" });
const BASE = process.env.BASE ?? "http://127.0.0.1:3978";

try {
  await db.delete(ragConsent); await db.delete(skill); await db.delete(aiProviderConfig);
  await db.delete(setting).where(inArray(setting.key, ["ai.baseUrl", "ai.model", "ai.enabled"]));

  // ── RAG 同意：记录位，不是门禁 ──
  const prov = await ai.createProvider(admin, { provider: "OPENAI_COMPAT", baseUrl: "https://example.com/v1", model: "gpt", embeddingModel: "bge-m3-1024", apiKey: "sk-x" });
  const c1 = await compliance.recordConsent(memberActor, {
    providerConfigId: prov!.id, purposeTextSnapshot: "用于知识检索，文本将发送至第三方模型服务",
    crossBorder: true, crossBorderPath: "标准合同条款", piaRecord: { purpose: "知识检索", retention: "30 天" },
  });
  ok("同意记录写入（含文案快照与跨境路径）", !!c1!.id && c1!.crossBorderPath === "标准合同条款", c1!.crossBorderPath ?? "");
  ok("文案快照原样保留（举证用：文案改了也能证明当时同意了什么）", c1!.purposeTextSnapshot.includes("第三方模型服务"));
  const c2 = await compliance.recordConsent(otherActor, { providerConfigId: prov!.id, purposeTextSnapshot: "另一位成员的同意", crossBorder: false });
  ok("同意是**本人行为**：两条记录分属不同成员", c1!.memberId === m.id && c2!.memberId === o.id);
  const mine = await compliance.listConsents(memberActor);
  ok("本人只能看到自己的同意记录（数据可携带）", mine.length === 1 && mine[0]!.memberId === m.id, String(mine.length));
  const all = await compliance.listConsents(admin, { all: true });
  ok("管理员可查全部（ai:configure）", all.length === 2, String(all.length));
  let denied = false;
  try { await compliance.listConsents(memberActor, { all: true }); } catch { denied = true; }
  ok("普通成员查全部被拒", denied);
  let crossDenied = false;
  try { await compliance.revokeConsent(memberActor, c2!.id); } catch { crossDenied = true; }
  ok("不能撤他人的同意记录（撤自己的可以）", crossDenied);
  const revoked = await compliance.revokeConsent(memberActor, c1!.id);
  ok("撤回设置 revoked_at", revoked!.revokedAt !== null);
  // **不做门禁**：撤回后 embedding 调用不受影响（平台不阻断）
  const stillWorks = await ai.canStartIndexing(m.id);
  ok("**撤回同意不影响功能**（规范 A35：记录位不是门禁，平台不阻断）", stillWorks.ok === true);

  // ── Skill ──
  const sk = await compliance.createSkill(admin, { name: "sprint-planner", manifest: { tools: ["workitem.list", "plan.createIteration"] }, appliesTo: ">=1.60" });
  ok("建 Skill（含 manifest 与适用版本区间）", !!sk!.id && sk!.enabled === true);
  let dup = false;
  try { await compliance.createSkill(admin, { name: "sprint-planner" }); } catch (e) { dup = (e as { code?: string }).code === "VALIDATION"; }
  ok("同名 Skill → VALIDATION", dup);
  const disabled = await compliance.updateSkill(admin, sk!.id, { enabled: false });
  ok("停用 Skill", disabled!.enabled === false);
  ok("只列启用中的 Skill", (await compliance.listSkills(admin, { onlyEnabled: true })).length === 0);
  ok("全部列表仍可见（便于重新启用）", (await compliance.listSkills(admin)).length === 1);
  let skDenied = false;
  try { await compliance.listSkills(memberActor); } catch { skDenied = true; }
  ok("无 ai:configure 者看不到 Skill", skDenied);
  await compliance.deleteSkill(admin, sk!.id);
  ok("删 Skill", (await compliance.listSkills(admin)).length === 0);

  // ── 研发活跃度 ──
  await compliance.upsertDevActivity(m.id, "2026-11-01", { commits: 3, prs: 1 });
  await compliance.upsertDevActivity(m.id, "2026-11-01", { commits: 2, reviews: 1 });
  await compliance.upsertDevActivity(o.id, "2026-11-02", { commits: 1 });
  const day = await sql<{ commits: number; prs: number; reviews: number }[]>`
    select commits, prs, reviews from dev_activity_daily where member_id = ${m.id} and date = '2026-11-01'`;
  ok("同人同日累加（UNIQUE (member_id,date) + ON CONFLICT）", day[0]!.commits === 5 && day[0]!.prs === 1 && day[0]!.reviews === 1,
    JSON.stringify(day[0]));
  let badDate = false;
  try { await compliance.upsertDevActivity(m.id, "2026/11/01", { commits: 1 }); } catch (e) { badDate = (e as { code?: string }).code === "VALIDATION"; }
  ok("日期格式非法 → VALIDATION", badDate);
  const act = await compliance.projectDevActivity(admin, pid);
  ok("项目活跃度按成员聚合（两位成员）", act.members.length === 2, String(act.members.length));
  ok("按 commits 降序且含姓名", act.members[0]!.name === "成员甲" && act.members[0]!.commits === 5, JSON.stringify(act.members[0]));
  const windowed = await compliance.projectDevActivity(admin, pid, { from: "2026-11-01", to: "2026-11-01" });
  ok("时间窗过滤生效", windowed.members.length === 1 && windowed.members[0]!.commits === 3 + 2, JSON.stringify(windowed.members));
  let projDenied = false;
  const outsider = (await loadActor((await mk("w13e-outsider", "项目外")).id))!;
  try { await compliance.projectDevActivity(outsider, pid); } catch { projDenied = true; }
  ok("项目外成员读不到活跃度", projDenied);

  // ── HTTP ──
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: "w13e-password-1234" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const httpAct = await fetch(`${BASE}/api/v1/projects/${pid}/dev-activity`, { headers: { cookie } });
  const actBody = (await httpAct.json()) as { members: unknown[] };
  ok("HTTP 研发活跃度 200", httpAct.status === 200 && actBody.members.length === 2, String(httpAct.status));
  const httpSkill = await fetch(`${BASE}/api/v1/skills`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ name: "http-skill", manifest: { tools: ["whoami"] } }),
  });
  ok("HTTP 建 Skill 201", httpSkill.status === 201, String(httpSkill.status));
  const httpConsent = await fetch(`${BASE}/api/v1/ai/rag/consent`, { headers: { cookie } });
  ok("HTTP 同意记录可查", httpConsent.status === 200, String(httpConsent.status));
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await app.close();
  await db.delete(ragConsent); await db.delete(skill); await db.delete(devActivityDaily);
  await db.delete(aiProviderConfig);
  await db.delete(setting).where(inArray(setting.key, ["ai.baseUrl", "ai.model", "ai.enabled"]));
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(workItem).where(eq(workItem.projectId, pid));
  await db.delete(milestone); await db.delete(iteration); await db.delete(release); await db.delete(moduleT);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [ADMIN, MEMBERU, OTHER, "w13e-outsider"]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
