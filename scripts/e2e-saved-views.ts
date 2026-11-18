import "./_env.ts";   // 环境预设必须最先加载
/**
 * 保存视图完整端点自检（Round 25 长任务第 36 项，Spec V8 / REST 7b）：
 * GET/:id、PATCH 改名/pinned/筛选，owner 才能改；PROJECT_SHARED 对项目可见成员可读不可改。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, project, role, roleAssignment, savedView } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "sv-admin";
const GUEST = "sv-guest";
const PW = "sv-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(savedView);
await db.delete(auditEntry);
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
await mk(ADMIN, "视图管理员", ar!.id);
await mk(GUEST, "视图成员", mr!.id);
const admin = (await loadActor((await db.select({ id: member.id }).from(member).where(eq(member.username, ADMIN)))[0]!.id))!;
const guest = (await loadActor((await db.select({ id: member.id }).from(member).where(eq(member.username, GUEST)))[0]!.id))!;
const proj = await projectService.createProject(admin, { key: `SV${SUFFIX}`, name: "保存视图项目" } as never);

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
    "x-csrf-token": decodeURIComponent(csrfToken),
  };
};
try {
  const H = { ...(await login(ADMIN)), "content-type": "application/json" };
  const G = { ...(await login(GUEST)), "content-type": "application/json" };

  // ① 个人视图：创建 → 读 → 改 → 列表
  const personal = await planningService.createSavedView(admin, { name: "我的表格视图", viewType: "TABLE", filters: { prioF: "HIGH" } });
  const get1 = await fetch(`${BASE}/api/v1/saved-views/${personal!.id}`, { headers: { cookie: H.cookie } });
  ok("GET /:id 读自己的视图 200", get1.status === 200, String(get1.status));
  const patch1 = await fetch(`${BASE}/api/v1/saved-views/${personal!.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ name: "我的表格视图（改）", isPinned: true, filters: { prioF: "LOW" } }),
  });
  const patched = await patch1.json() as { name: string; isPinned: boolean; filters: { prioF?: string } };
  ok("PATCH 改名/pinned/筛选成功", patch1.status === 200 && patched.name === "我的表格视图（改）" && patched.isPinned === true && patched.filters.prioF === "LOW",
    JSON.stringify(patched));
  ok("个人列表包含该视图", (await planningService.listSavedViews(admin)).some((v) => v.id === personal!.id));

  // ② 共享视图：别人可读不可改/删
  const shared = await planningService.createSavedView(admin, { name: "项目高优先", viewType: "TABLE", scope: "PROJECT_SHARED", projectId: proj.id, filters: { prioF: "HIGH" } });
  const getShared = await fetch(`${BASE}/api/v1/saved-views/${shared!.id}`, { headers: { cookie: G.cookie } });
  ok("项目成员 GET 共享视图 200", getShared.status === 200, String(getShared.status));
  ok("项目成员列出了共享视图", (await planningService.listSavedViews(guest, proj.id)).some((v) => v.id === shared!.id));
  const patchShared = await fetch(`${BASE}/api/v1/saved-views/${shared!.id}`, {
    method: "PATCH", headers: G, body: JSON.stringify({ name: "想改别人的" }),
  });
  ok("非 owner 改共享视图 → 403", patchShared.status === 403, String(patchShared.status));
  ok("非 owner 删共享视图 → 403", (await fetch(`${BASE}/api/v1/saved-views/${shared!.id}`, {
    method: "DELETE", headers: { cookie: G.cookie, "x-csrf-token": G["x-csrf-token"] },
  })).status === 403);
  ok("非 owner 的个人列表看不到别人的共享视图", (await planningService.listSavedViews(guest)).length === 0);

  // ③ 校验
  ok("共享视图缺项目 → 400", await (async () => {
    try { await planningService.createSavedView(admin, { name: "x", viewType: "TABLE", scope: "PROJECT_SHARED" }); return false; }
    catch (e) { return (e as { code?: string }).code === "VALIDATION"; }
  })());
  ok("个人视图带项目 → 400", await (async () => {
    try { await planningService.createSavedView(admin, { name: "x", viewType: "TABLE", projectId: proj.id }); return false; }
    catch (e) { return (e as { code?: string }).code === "VALIDATION"; }
  })());
  ok("非法 viewType → 400", (await fetch(`${BASE}/api/v1/saved-views`, {
    method: "POST", headers: H, body: JSON.stringify({ name: "x", viewType: "MATRIX" }),
  })).status === 400);
  ok("GET 不存在的视图 → 403（与不可见同形）", (await fetch(`${BASE}/api/v1/saved-views/00000000-0000-0000-0000-000000000000`, { headers: { cookie: H.cookie } })).status === 403);

  // ③b 拖拽排序（Round 37 补列）：个人视图按 sortOrder 排；非 owner 拒绝
  const a1 = await planningService.createSavedView(admin, { name: "排序A", viewType: "TABLE" });
  const a2 = await planningService.createSavedView(admin, { name: "排序B", viewType: "TABLE" });
  const a3 = await planningService.createSavedView(admin, { name: "排序C", viewType: "TABLE" });
  const created = await planningService.listSavedViews(admin);
  const sortNames = created.filter((v) => v.name.startsWith("排序")).map((v) => v.name);
  ok("新建视图按创建顺序排列", sortNames.join(",") === "排序A,排序B,排序C", sortNames.join(","));
  const reorder = await fetch(`${BASE}/api/v1/saved-views/reorder`, {
    method: "POST", headers: H, body: JSON.stringify({ ids: [a3!.id, a1!.id, a2!.id] }),
  });
  const afterReorder = await planningService.listSavedViews(admin);
  const afterNames = afterReorder.filter((v) => v.name.startsWith("排序")).map((v) => v.name);
  ok("reorder 生效（C,A,B）", reorder.status === 200 && afterNames.join(",") === "排序C,排序A,排序B",
    afterNames.join(","));
  ok("非 owner reorder → 403", (await fetch(`${BASE}/api/v1/saved-views/reorder`, {
    method: "POST", headers: G, body: JSON.stringify({ ids: [a1!.id] }),
  })).status === 403);
  ok("重复 id reorder → 400", (await fetch(`${BASE}/api/v1/saved-views/reorder`, {
    method: "POST", headers: H, body: JSON.stringify({ ids: [a1!.id, a1!.id] }),
  })).status === 400);
  ok("不存在 id reorder → 403（与不可见同形）", (await fetch(`${BASE}/api/v1/saved-views/reorder`, {
    method: "POST", headers: H, body: JSON.stringify({ ids: ["00000000-0000-0000-0000-000000000000"] }),
  })).status === 403);
  for (const v of [a1, a2, a3]) await planningService.deleteSavedView(admin, v!.id);

  // ④ owner 删除
  await planningService.deleteSavedView(admin, personal!.id);
  await planningService.deleteSavedView(admin, shared!.id);
  ok("owner 删除后列表为空", (await planningService.listSavedViews(admin)).length === 0
    && (await planningService.listSavedViews(admin, proj.id)).length === 0);
} finally {
  await app.close();
  await db.delete(savedView);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
