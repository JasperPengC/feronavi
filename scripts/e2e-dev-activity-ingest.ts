import "./_env.ts";   // 环境预设必须最先加载
/**
 * 研发活跃度写入入口自检（Round 25 长任务第 9 项）
 *
 * 背景：`dev_activity_daily` 只有聚合读取，没有任何写入入口（integration 表未落地），
 * 页面上永远「暂无数据」。本轮加 `POST /api/v1/dev-activity`（integration:manage，批量 upsert，
 * 整批事务，写安全审计）。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, devActivityDaily, member, project, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { and, eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN_USER = "ing-admin";
const TARGET_USER = "ing-target";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
const KEY = `ING${SUFFIX}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(ADMIN_USER);
await deleteTestMember(TARGET_USER);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN_USER, email: "ing-admin@x.test", name: "集成管理员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword("ing-admin-pass-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const [targetRow] = await db.insert(member).values({
  username: TARGET_USER, email: "ing-target@x.test", name: "集成目标成员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword("ing-target-pass-1234"),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: targetRow!.id, roleId: mr!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: KEY, name: "集成活跃度项目" } as never);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });

try {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: "ing-admin-pass-1234" }),
  });
  const { csrfToken } = await login.json() as { csrfToken: string };
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const H = { cookie, "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
  const post = (rows: unknown[]) => fetch(`${BASE}/api/v1/dev-activity`, {
    method: "POST", headers: H, body: JSON.stringify({ rows }),
  });

  // ① 批量写入（username 寻址）
  const first = await post([
    { username: TARGET_USER, date: "2026-10-01", commits: 3, prs: 1, reviews: 2 },
    { username: TARGET_USER, date: "2026-10-02", commits: 2 },
  ]);
  const firstBody = await first.json() as { accepted?: number; members?: number };
  ok("批量写入 201 且接受 2 行", first.status === 201 && firstBody.accepted === 2, `${first.status} ${JSON.stringify(firstBody)}`);

  // ② 同 (member,date) 累加
  const second = await post([{ username: TARGET_USER, date: "2026-10-01", commits: 1 }]);
  ok("重复日期再写入 → 201（累加语义）", second.status === 201);

  // ③ 聚合读取（项目维度）
  const get = await fetch(`${BASE}/api/v1/projects/${proj.id}/dev-activity`, { headers: { cookie } });
  const body = await get.json() as { members?: { username: string; commits: number; prs: number; reviews: number; days: number }[]; note?: string };
  const row = (body.members ?? []).find((m) => m.username === TARGET_USER);
  ok("项目研发活跃度读到累加后的真实数据",
    get.status === 200 && row?.commits === 6 && row?.prs === 1 && row?.reviews === 2 && row?.days === 2,
    JSON.stringify(row));
  ok("说明文案指向写入入口", (body.note ?? "").includes("POST /api/v1/dev-activity"), String(body.note));

  // ④ 校验
  const badDate = await post([{ username: TARGET_USER, date: "2026-13-99" }]);
  ok("非法日期 → 400", badDate.status === 400, String(badDate.status));
  const badMember = await post([{ username: "no-such-member", date: "2026-10-03" }]);
  ok("未知成员 → 400", badMember.status === 400, String(badMember.status));
  const empty = await post([]);
  ok("空 rows → 400", empty.status === 400, String(empty.status));

  // ⑤ 权限：普通成员（无 integration:manage）403
  const login2 = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TARGET_USER, password: "ing-target-pass-1234" }),
  });
  const csrf2 = (await login2.json() as { csrfToken: string }).csrfToken;
  const cookie2 = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const denied = await fetch(`${BASE}/api/v1/dev-activity`, {
    method: "POST", headers: { cookie: cookie2, "x-csrf-token": decodeURIComponent(csrf2), "content-type": "application/json" },
    body: JSON.stringify({ rows: [{ username: TARGET_USER, date: "2026-10-04", commits: 1 }] }),
  });
  ok("无 integration:manage → 403", denied.status === 403, String(denied.status));

  // ⑥ 审计
  const audit = await db.select().from(auditEntry).where(and(eq(auditEntry.action, "dev_activity.ingested"), eq(auditEntry.actorId, adminRow!.id)));
  ok("写入动作产生安全审计", audit.length >= 2 && audit.every((a) => a.severity === "SECURITY"), String(audit.length));
} finally {
  await app.close();
  await db.delete(devActivityDaily).where(eq(devActivityDaily.memberId, targetRow!.id));
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(auditEntry);
  await deleteTestMember(ADMIN_USER);
  await deleteTestMember(TARGET_USER);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
