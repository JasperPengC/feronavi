import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 项目 CRUD 与工作流模板复制自检（R4）
 *
 * 重点不是「能建出项目」，而是**模板真的被完整复制了**：
 * 规范要求 workflow → workflow_state → workflow_transition 三层都复制，
 * 且 key 与 category 原样保留。少复制任何一层，项目都能建出来，
 * 但要等到用户去拖看板时才会发现"没有迁移边"。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";

// 前置：本测试要打 API，实例必须是「已初始化」（否则被 R7 的拦截钩子挡成 403）
await ensureInitialized();
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, workflow, workflowState, workflowTransition } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3998";
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const U = "r4-admin", PW = "r4-test-password-123";
await deleteTestMember(U);
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [m] = await db.insert(member).values({
  username: U, email: `${U}@example.test`, name: "R4 管理员", status: "ACTIVE",
  passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3998), host: "127.0.0.1" });
const KEY = "R4PROJ";

try {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: PW }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  // 双提交令牌：登录响应里给出，前端放进 X-CSRF-Token 头
  const loginBody = await login.json() as { csrfToken?: string };
  const csrfToken = loginBody.csrfToken ?? "";
  const H = { "content-type": "application/json", cookie, "x-csrf-token": csrfToken };

  // ── ① 建项目 ──────────────────────────────────────────────
  const create = await fetch(`${BASE}/api/v1/projects`, {
    method: "POST", headers: H, body: JSON.stringify({ key: KEY, name: "R4 测试项目" }),
  });
  const createText = await create.text();
  ok("建项目 → 201", create.status === 201, `实际 ${create.status} ${createText}`);
  const created = JSON.parse(createText) as { id: string; key: string };

  // ── ② 模板复制：三层都要有 ────────────────────────────────
  const wfs = await db.select().from(workflow).where(eq(workflow.projectId, created.id));
  ok("复制出 3 套工作流", wfs.length === 3, `实际 ${wfs.length}`);
  ok("副本 is_builtin=false（模板只读，副本可改）", wfs.every((w) => !w.isBuiltin));
  ok("副本 project_id 指向新项目", wfs.every((w) => w.projectId === created.id));

  const tpl = await db.select().from(workflow).where(eq(workflow.isBuiltin, true));
  const tplStates = await db.select().from(workflowState).where(inArray(workflowState.workflowId, tpl.map((t) => t.id)));
  const copyIds = wfs.map((w) => w.id);
  const copyStates = await db.select().from(workflowState).where(inArray(workflowState.workflowId, copyIds));
  ok("状态数一致（22 个）", copyStates.length === tplStates.length && copyStates.length === 22,
    `模板 ${tplStates.length} / 副本 ${copyStates.length}`);

  const tplEdges = await db.select().from(workflowTransition).where(inArray(workflowTransition.workflowId, tpl.map((t) => t.id)));
  const copyEdges = await db.select().from(workflowTransition).where(inArray(workflowTransition.workflowId, copyIds));
  ok("迁移边数一致（40 条）", copyEdges.length === tplEdges.length && copyEdges.length === 40,
    `模板 ${tplEdges.length} / 副本 ${copyEdges.length}`);

  // key 与 category 必须原样保留（MCP meta.workflow 与前端枚举依赖）
  // 不同工作流可以有同名状态（如需求与缺陷的 VERIFIED），按类型和 key 对照。
  const tplTypes = new Map(tpl.map(w => [w.id, w.appliesToType]));
  const copyTypes = new Map(wfs.map(w => [w.id, w.appliesToType]));
  const tplCats = new Map(tplStates.map(s => [`${tplTypes.get(s.workflowId)}:${s.key}`, s.category]));
  const copyKey = (s: typeof copyStates[number]) => `${copyTypes.get(s.workflowId)}:${s.key}`;
  ok("各工作流状态 key 原样保留", copyStates.every(s => tplCats.has(copyKey(s))));
  ok("各工作流 category 照抄（终态判定依赖它）", copyStates.every(s => tplCats.get(copyKey(s)) === s.category));

  // 终态数量必须一致，否则看板/完成时间会算错
  const tplTerm = tplStates.filter((s) => s.category === "TERMINAL").length;
  const copyTerm = copyStates.filter((s) => s.category === "TERMINAL").length;
  ok("终态数一致（8 个）", copyTerm === tplTerm && copyTerm === 8, `模板 ${tplTerm} / 副本 ${copyTerm}`);

  // ── ③ 创建者自动入组（规范缺口补丁）──────────────────────
  const list = await fetch(`${BASE}/api/v1/projects`, { headers: { cookie } });
  const listBody = await list.json() as { items: { key: string }[]; total: number };
  ok("创建者能在列表里看到自己的项目", listBody.items.some((i) => i.key === KEY), JSON.stringify(listBody.items.map((i) => i.key)));

  // ── ④ key 不可改（A45）──────────────────────────────────
  const patch = await fetch(`${BASE}/api/v1/projects/${created.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ key: "CHANGED" }),
  });
  ok("尝试改 key → 400 VALIDATION（不是静默忽略）", patch.status === 400, `实际 ${patch.status}`);
  const patchBody = await patch.json() as { code: string };
  ok("错误码为 VALIDATION", patchBody.code === "VALIDATION", patchBody.code);

  // 正常改名应成功
  const rename = await fetch(`${BASE}/api/v1/projects/${created.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ name: "改名后" }),
  });
  ok("改名 → 200", rename.status === 200, `实际 ${rename.status}`);

  // ── ⑤ key 重复 → CONFLICT ───────────────────────────────
  const dup = await fetch(`${BASE}/api/v1/projects`, {
    method: "POST", headers: H, body: JSON.stringify({ key: KEY, name: "重复" }),
  });
  ok("key 重复 → 409 CONFLICT", dup.status === 409, `实际 ${dup.status}`);

  // ── ⑥ key 格式非法 → VALIDATION ─────────────────────────
  const bad = await fetch(`${BASE}/api/v1/projects`, {
    method: "POST", headers: H, body: JSON.stringify({ key: "lower", name: "x" }),
  });
  ok("key 小写 → 400 VALIDATION", bad.status === 400, `实际 ${bad.status}`);

  // ── ⑦ 状态流转（按 category 推导）──────────────────────
  const toActive = await fetch(`${BASE}/api/v1/projects/${created.id}/status`, {
    method: "POST", headers: H, body: JSON.stringify({ statusKey: "ACTIVE" }),
  });
  ok("PLANNED → ACTIVE 允许", toActive.status === 200, `实际 ${toActive.status}`);
  const toComplete = await fetch(`${BASE}/api/v1/projects/${created.id}/status`, {
    method: "POST", headers: H, body: JSON.stringify({ statusKey: "COMPLETED" }),
  });
  ok("ACTIVE → COMPLETED 允许", toComplete.status === 200, `实际 ${toComplete.status}`);
  const backToPlanned = await fetch(`${BASE}/api/v1/projects/${created.id}/status`, {
    method: "POST", headers: H, body: JSON.stringify({ statusKey: "PLANNED" }),
  });
  ok("TERMINAL → NOT_STARTED 拒绝（只能回进行中）", backToPlanned.status === 400, `实际 ${backToPlanned.status}`);

  // ── ⑧ 归档 ───────────────────────────────────────────────
  const arch = await fetch(`${BASE}/api/v1/projects/${created.id}/archive`, { method: "POST", headers: { cookie, "x-csrf-token": csrfToken } });
  ok("归档 → 200", arch.status === 200, `实际 ${arch.status} ${await arch.text()}`);
  const afterArch = await fetch(`${BASE}/api/v1/projects`, { headers: { cookie } });
  const afterBody = await afterArch.json() as { items: { key: string }[] };
  ok("归档后默认不出现在列表", !afterBody.items.some((i) => i.key === KEY));
} finally {
  await app.close();
  await db.delete(project).where(eq(project.key, KEY));
  await db.delete(project).where(eq(project.key, "CHANGED"));
  await deleteTestMember(U);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
