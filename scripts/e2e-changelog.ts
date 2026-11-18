import "./_env.ts";   // 环境预设必须最先加载
/** 更新日志（Round 67 对标）：release.notes 聚合/可见性/编辑权限自检 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, project, release, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as planningService from "../src/server/services/planning.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "cl-admin";
const GUEST = "cl-guest";
const PW = "cl-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));

const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "日志管理员", ar!.id);
const [guestRow] = await db.insert(member).values({ username: GUEST, email: `${GUEST}@x.test`, name: "日志成员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
const guestId = guestRow!.id;   // 无任何角色/项目成员关系 → 不可见任何项目
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `CL${SUFFIX}`, name: "更新日志项目" } as never);
const r1 = await planningService.createPlan(admin, proj.id, "release", { name: "v1.0.0", versionTag: "v1.0.0", releaseDate: "2026-10-01", notes: "首个版本\n支持项目与工作项" } as never);
const r2 = await planningService.createPlan(admin, proj.id, "release", { name: "v1.1.0", versionTag: "v1.1.0", releaseDate: "2026-10-20", notes: "新增问题追踪" } as never);
await planningService.createPlan(admin, proj.id, "release", { name: "无说明发布", versionTag: "v1.2.0" } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
try {
  const H = await login(ADMIN);
  const G = await login(GUEST);
  const cl = await (await fetch(`${BASE}/api/v1/changelog`, { headers: { cookie: H.cookie } })).json() as { items: { id: string; versionTag: string; notes: string; projectKey: string }[] };
  ok("changelog 只含 notes 非空的发布（2 条）", cl.items.length === 2, JSON.stringify(cl.items.map((x) => x.versionTag)));
  ok("按发布日期倒序（v1.1.0 在前）", cl.items[0]?.versionTag === "v1.1.0", JSON.stringify(cl.items.map((x) => [x.versionTag, x.notes])));
  ok("返回项目标识与说明正文", cl.items.every((x) => x.projectKey === `CL${SUFFIX}`) && cl.items.some((x) => x.notes.includes("新增问题追踪")));

  const filtered = await (await fetch(`${BASE}/api/v1/changelog?projectId=${proj.id}`, { headers: { cookie: H.cookie } })).json() as { items: unknown[] };
  ok("projectId 过滤生效", filtered.items.length === 2);
  const guest = await (await fetch(`${BASE}/api/v1/changelog`, { headers: { cookie: G.cookie } })).json() as { items: unknown[] };
  ok("不可见项目的成员看不到（0 条）", guest.items.length === 0, JSON.stringify(guest.items));

  const patch = await fetch(`${BASE}/api/v1/releases/${r1.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ notes: "首个版本（修订）\n含迁移说明" }),
  });
  ok("release:manage 更新说明 200", patch.status === 200, String(patch.status));
  const after = await (await fetch(`${BASE}/api/v1/changelog`, { headers: { cookie: H.cookie } })).json() as { items: { id: string; notes: string }[] };
  ok("更新后的说明出现在 changelog", after.items.find((x) => x.id === r1.id)?.notes.includes("修订") === true);

  const guestPatch = await fetch(`${BASE}/api/v1/releases/${r2.id}`, {
    method: "PATCH", headers: G, body: JSON.stringify({ notes: "越权修改" }),
  });
  ok("普通成员改发布说明 → 403（本次同时修复了只校验可见性的旧缺陷）", guestPatch.status === 403, String(guestPatch.status));
} finally {
  await app.close();
  await db.delete(release).where(eq(release.projectId, proj.id));
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  void guestId;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
