import "./_env.ts";   // 环境预设必须最先加载
/**
 * 项目活动日期筛选 + CSV 导出自检（Round 25 长任务第 22 项）：
 * 与列表同一筛选口径、BOM/CSV 转义、from/to 边界、非法日期 400、无权限 403。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, project, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "aexp-admin";
const GUEST = "aexp-guest";
const PW = "aexp-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
const DAY = 86_400_000;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(activityEntry);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "aexp-admin@x.test", name: "活动导出员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const [guestRow] = await db.insert(member).values({
  username: GUEST, email: "aexp-guest@x.test", name: "活动外人", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: guestRow!.id, roleId: mr!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const proj = await projectService.createProject(admin, { key: `AEXP${SUFFIX}`, name: "活动导出项目" } as never);

// 受控活动行：一条近期的转义样本，一条 40 天前的旧行
const today = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const oldDay = ymd(new Date(today.getTime() - 40 * DAY));
await db.insert(activityEntry).values([
  {
    projectId: proj.id, actorId: adminRow!.id, targetType: "PAGE", action: "wiki.created",
    summary: '验收,活动"引号"\n换行', createdAt: today,
  },
  {
    projectId: proj.id, actorId: adminRow!.id, targetType: "PAGE", action: "wiki.updated",
    summary: "旧活动（40 天前）", createdAt: new Date(today.getTime() - 40 * DAY),
  },
]);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};
try {
  const cookie = await login(ADMIN);
  const getCsv = async (qs = "") => {
    const r = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity/export${qs}`, { headers: { cookie } });
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
    return { status: r.status, type: r.headers.get("content-type") ?? "", disp: r.headers.get("content-disposition") ?? "", bytes: buf, text };
  };
  const getList = async (qs = "") => {
    const r = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity?pageSize=100${qs}`, { headers: { cookie } });
    return { status: r.status, body: await r.json() as { total?: number; items?: { action: string; summary: string }[] } };
  };

  const all = await getCsv();
  ok("导出 200 + CSV 类型 + 附件名", all.status === 200 && all.type.includes("text/csv")
    && /attachment; filename="activity-\d{8}\.csv"/.test(all.disp), `${all.status} ${all.type} ${all.disp}`);
  ok("含 BOM 且表头正确", all.bytes[0] === 0xef && all.bytes[1] === 0xbb && all.bytes[2] === 0xbf
    && all.text.includes("time,action,actorId,targetType,targetId,summary"));
  ok("包含近期与 40 天前两条活动", all.text.includes("wiki.created") && all.text.includes("wiki.updated"));
  ok("逗号/引号/换行正确转义", all.text.includes('"验收,活动""引号""') && all.text.includes("换行"));

  const fromToday = await getCsv(`?from=${ymd(today)}`);
  ok("from=今天 排除 40 天前旧行", fromToday.text.includes("wiki.created") && !fromToday.text.includes("wiki.updated"));
  const toOld = await getCsv(`?to=${oldDay}`);
  ok("to=旧日期 只返回旧行", toOld.text.includes("wiki.updated") && !toOld.text.includes("wiki.created"));
  const category = await getCsv("?category=wiki");
  ok("category=wiki 过滤生效且包含两条", category.text.includes("wiki.created") && category.text.includes("wiki.updated"));
  const keyword = await getCsv("?q=%E5%BC%95%E5%8F%B7");   // 引号
  ok("q=引号 关键字过滤生效", keyword.text.includes("wiki.created") && !keyword.text.includes("wiki.updated"));

  const list = await getList(`&from=${ymd(today)}`);
  ok("列表端点同样支持 from 过滤", list.status === 200 && (list.body.items ?? []).every((x) => x.action !== "wiki.updated"), JSON.stringify(list.body.total));
  const badDate = await getCsv("?from=not-a-date");
  ok("非法日期 → 400", badDate.status === 400, String(badDate.status));

  const guestCookie = await login(GUEST);
  const guestExport = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity/export`, { headers: { cookie: guestCookie } });
  const guestList = await fetch(`${BASE}/api/v1/projects/${proj.id}/activity?pageSize=10`, { headers: { cookie: guestCookie } });
  // 本项目所有内置角色都有 activity:read，且 ORG 作用域成员可见项目 → 导出的权限口径必须与列表**一致**：
  // 不额外放宽、也不额外收紧（不是"导出让更多人看到"）
  ok("导出与列表同权限口径（ORG 成员一致可见）",
    guestExport.status === guestList.status && guestList.status === 200,
    `export=${guestExport.status} list=${guestList.status}`);
} finally {
  await app.close();
  await db.delete(activityEntry);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
