import "./_env.ts";   // 环境预设必须最先加载
/**
 * 项目配置变更的活动记录自检（Round 25 长任务第 14 项）：
 * 项目更新/归档/取消归档/状态流转 + 自定义字段增改归档，都要写项目活动。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, customFieldDef, member, project, projectStatusDef, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as fieldService from "../src/server/services/custom-field.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const USER = "pfa-admin";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
const KEY = `PFA${SUFFIX}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(USER);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: USER, email: "pfa@x.test", name: "项目配置员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword("pfa-pass-12345"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: KEY, name: "配置活动项目" } as never);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
let fieldId = "";
try {
  // ① 自定义字段：创建 → 改名 → 归档（服务层）
  const f = await fieldService.createDef(admin, proj.id, { key: `sev_${SUFFIX.toLowerCase()}`, name: "严重程度", type: "TEXT" });
  fieldId = f.id;
  await fieldService.updateDef(admin, fieldId, { name: "严重程度（改）" });
  await fieldService.archiveDef(admin, fieldId);

  // ② 项目更新 / 归档 / 取消归档 / 状态流转（HTTP 路由层）
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: "pfa-pass-12345" }),
  });
  const { csrfToken } = await login.json() as { csrfToken: string };
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const H = { cookie, "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
  const AUTH = { cookie, "x-csrf-token": decodeURIComponent(csrfToken) };

  const patch = await fetch(`${BASE}/api/v1/projects/${proj.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ name: "配置活动项目（改）" }) });
  ok("项目更新 200", patch.status === 200, String(patch.status));
  const arch = await fetch(`${BASE}/api/v1/projects/${proj.id}/archive`, { method: "POST", headers: AUTH });
  ok("项目归档 200", arch.status === 200, String(arch.status));
  const unarch = await fetch(`${BASE}/api/v1/projects/${proj.id}/unarchive`, { method: "POST", headers: AUTH });
  ok("项目取消归档 200", unarch.status === 200, String(unarch.status));
  const [inProgress] = await db.select({ key: projectStatusDef.key }).from(projectStatusDef)
    .where(eq(projectStatusDef.category, "IN_PROGRESS")).limit(1);
  const st = await fetch(`${BASE}/api/v1/projects/${proj.id}/status`, { method: "POST", headers: H, body: JSON.stringify({ statusKey: inProgress!.key }) });
  ok("项目状态流转 200", st.status === 200, `${st.status}`);

  // ── 库内校验 ──
  const acts = await db.select().from(activityEntry).where(eq(activityEntry.projectId, proj.id));
  const byAction = (a: string) => acts.filter((x) => x.action === a);
  const sums = acts.map((a) => a.summary);
  ok("自定义字段 创建/更新/归档 写活动",
    byAction("field.created").length === 1 && byAction("field.updated").length === 1 && byAction("field.archived").length === 1
    && sums.some((s) => s.includes("创建了自定义字段") && s.includes("严重程度"))
    && sums.some((s) => s.includes("更新了自定义字段") && s.includes("严重程度（改）"))
    && sums.some((s) => s.includes("归档了自定义字段")));
  ok("项目 更新/归档/取消归档/状态 写活动",
    byAction("project.updated").length === 1 && byAction("project.archived").length === 1
    && byAction("project.unarchived").length === 1 && byAction("project.status_changed").length === 1
    && sums.some((s) => s.includes("更新了项目"))
    && sums.some((s) => s.includes("归档了项目"))
    && sums.some((s) => s.includes("状态改为")));
  ok("活动均归属该项目", acts.every((a) => a.projectId === proj.id));

  // ── HTTP 活动端点类别筛选 ──
  const fieldApi = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity?pageSize=100&category=field`, { headers: { cookie } });
  const fieldBody = await fieldApi.json() as { total?: number };
  const projectApi = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity?pageSize=100&category=project`, { headers: { cookie } });
  const projectBody = await projectApi.json() as { total?: number };
  ok("category=field 返回 3 条", (fieldBody.total ?? 0) === 3, String(fieldBody.total));
  ok("category=project 返回 ≥5 条（含创建）", (projectBody.total ?? 0) >= 5, String(projectBody.total));
} finally {
  await app.close();
  await db.delete(activityEntry).where(eq(activityEntry.projectId, proj.id));
  await db.delete(auditEntry);
  if (fieldId) await db.delete(customFieldDef).where(eq(customFieldDef.id, fieldId));
  await db.delete(project).where(eq(project.id, proj.id));
  await deleteTestMember(USER);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
