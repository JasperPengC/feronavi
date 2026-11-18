import "./_env.ts";   // 环境预设必须最先加载
/**
 * 项目模板自检（Round 25 长任务第 42 项，数据模型 2.4 / REST 第 3 节）：
 * 模板 CRUD、payload 校验、内置模板只读/不可删、从模板建项目（初始集套用）、权限。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, iteration, member, milestone, project, projectTemplate, role, roleAssignment, workItem } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as tplService from "../src/server/services/project-template.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "tpl-admin";
const GUEST = "tpl-guest";
const PW = "tpl-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(projectTemplate);
await db.delete(auditEntry); await db.delete(activityEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "模板管理员", ar!.id);
await mk(GUEST, "模板成员", mr!.id);
const admin = (await loadActor(adminId))!;

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return {
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json",
  };
};
let projectId = "";
try {
  // ① 建模板（payload 含三类初始集）
  const created = await tplService.createTemplate(admin, {
    name: "标准交付模板", payload: {
      milestones: [{ name: "启动", dueDate: "2026-12-01" }],
      iterations: [{ name: "迭代一", startDate: "2026-12-01", endDate: "2026-12-14" }],
      workItems: [
        { title: "需求梳理", type: "REQUIREMENT", priority: "HIGH" },
        { title: "环境准备", type: "TASK" },
      ],
    },
  });
  ok("创建模板成功", !!created!.id && (created!.payload as { milestones?: unknown[] }).milestones?.length === 1);

  // ② 列表 / 详情 / 更新 / 非法 payload
  const H = await login(ADMIN);
  ok("GET 列表包含模板", (await (await fetch(`${BASE}/api/v1/project-templates`, { headers: { cookie: H.cookie } })).json() as { templates: unknown[] }).templates.length === 1);
  ok("GET 详情可读", (await fetch(`${BASE}/api/v1/project-templates/${created!.id}`, { headers: { cookie: H.cookie } })).status === 200);
  const patched = await tplService.updateTemplate(admin, created!.id, { name: "标准交付模板（改）" });
  ok("更新模板名称", patched!.name === "标准交付模板（改）");
  ok("非法 payload → 400", (await fetch(`${BASE}/api/v1/project-templates`, {
    method: "POST", headers: H, body: JSON.stringify({ name: "坏模板", payload: { workItems: [{ title: "x", type: "NOPE" }] } }),
  })).status === 400);

  // ③ 内置模板只读/不可删
  const [builtin] = await db.insert(projectTemplate).values({ name: "内置模板", isBuiltin: true, payload: {} as object }).returning({ id: projectTemplate.id });
  ok("内置模板 PATCH → 403", (await fetch(`${BASE}/api/v1/project-templates/${builtin!.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ name: "改内置" }) })).status === 403);
  ok("内置模板 DELETE → 403", (await fetch(`${BASE}/api/v1/project-templates/${builtin!.id}`, { method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] } })).status === 403);

  // ④ 从模板建项目
  const fromTpl = await fetch(`${BASE}/api/v1/projects/from-template`, {
    method: "POST", headers: H,
    body: JSON.stringify({ key: `TPL${SUFFIX}`, name: "模板项目", templateId: created!.id }),
  });
  const fromBody = await fromTpl.json() as { project: { id: string }; applied: { milestones: number; iterations: number; workItems: number }; failures: unknown[] };
  projectId = fromBody.project?.id ?? "";
  ok("从模板建项目 201 且初始集套用（1/1/2）",
    fromTpl.status === 201 && fromBody.applied.milestones === 1 && fromBody.applied.iterations === 1 && fromBody.applied.workItems === 2 && fromBody.failures.length === 0,
    JSON.stringify(fromBody.applied));
  const [msRows, itRows, wiRows] = await Promise.all([
    db.select({ id: milestone.id }).from(milestone).where(eq(milestone.projectId, projectId)),
    db.select({ id: iteration.id }).from(iteration).where(eq(iteration.projectId, projectId)),
    db.select({ id: workItem.id }).from(workItem).where(eq(workItem.projectId, projectId)),
  ]);
  ok("库内确有里程碑/迭代/工作项", msRows.length === 1 && itRows.length === 1 && wiRows.length === 2,
    JSON.stringify({ ms: msRows.length, it: itRows.length, wi: wiRows.length }));

  ok("未知模板 id → 403", (await fetch(`${BASE}/api/v1/projects/from-template`, {
    method: "POST", headers: H,
    body: JSON.stringify({ key: `TPX${SUFFIX}`, name: "x", templateId: "00000000-0000-0000-0000-000000000000" }),
  })).status === 403);
  ok("重复 KEY 建项目 → 409", (await fetch(`${BASE}/api/v1/projects/from-template`, {
    method: "POST", headers: H,
    body: JSON.stringify({ key: `TPL${SUFFIX}`, name: "重复", templateId: created!.id }),
  })).status === 409);

  // ⑤ 权限
  const G = await login(GUEST);
  ok("无 project:create 者列模板 → 403", (await fetch(`${BASE}/api/v1/project-templates`, { headers: { cookie: G.cookie } })).status === 403);
  ok("无 project:create 者从模板建项目 → 403", (await fetch(`${BASE}/api/v1/projects/from-template`, {
    method: "POST", headers: G, body: JSON.stringify({ key: `TPG${SUFFIX}`, name: "x" }),
  })).status === 403);

  // ⑥ 删除自建模板
  await tplService.deleteTemplate(admin, created!.id);
  ok("删除自建模板成功", (await tplService.listTemplates(admin)).length === 1);
} finally {
  await app.close();
  await db.delete(workItem).where(eq(workItem.projectId, projectId || "00000000-0000-0000-0000-000000000000"));
  await db.delete(milestone).where(eq(milestone.projectId, projectId || "00000000-0000-0000-0000-000000000000"));
  await db.delete(iteration).where(eq(iteration.projectId, projectId || "00000000-0000-0000-0000-000000000000"));
  if (projectId) await db.delete(project).where(eq(project.id, projectId));
  await db.delete(project).where(eq(project.key, `TPX${SUFFIX}`));
  await db.delete(projectTemplate);
  await db.delete(activityEntry); await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
