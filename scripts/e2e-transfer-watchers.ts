import "./_env.ts";   // 环境预设必须最先加载
/** 转派历史 + 关注者（Round 79）：真实转派、历史、权限、幂等关注 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, member, project, role, roleAssignment, subscription, workItem, workItemTransfer } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wiService from "../src/server/services/work-item.service.ts";
import { and, eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "tw-admin";
const DEV = "tw-dev";
const MEMBER = "tw-member";
const PW = "tw-pass-123456";
const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, DEV, MEMBER]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry); await db.delete(workItemTransfer); await db.delete(subscription);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "转派管理员", ar!.id);
const devId = await mk(DEV, "开发甲", ar!.id);
const memberId = await mk(MEMBER, "普通成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `TW${SUFFIX}`, name: "转派项目" } as never);
const wi = await wiService.createWorkItem(admin, proj.id, { type: "TASK", title: "转派验收任务" } as never);

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
const headersNoBody = (h: Awaited<ReturnType<typeof login>>) => ({ cookie: h.cookie, "x-csrf-token": h["x-csrf-token"] });
try {
  const H = await login(ADMIN);
  const M = await login(MEMBER);
  const cur = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}`, { headers: { cookie: H.cookie } })).json() as { version: number };
  const t1 = await fetch(`${BASE}/api/v1/work-items/${wi.id}/transfer`, {
    method: "POST", headers: H, body: JSON.stringify({ assigneeId: devId, version: cur.version, reason: "网络模块由甲负责" }),
  });
  ok("转派 200", t1.status === 200, String(t1.status));
  const tr1 = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}/transfers`, { headers: { cookie: H.cookie } })).json() as { transfers: { fromName: string | null; toName: string | null; actorName: string | null; reason: string | null }[] };
  ok("转派历史 1 条且 from/to/actor/reason 正确",
    tr1.transfers.length === 1 && tr1.transfers[0]!.toName === "开发甲" && tr1.transfers[0]!.actorName === "转派管理员" && tr1.transfers[0]!.reason === "网络模块由甲负责",
    JSON.stringify(tr1.transfers));

  // 普通 PATCH 改负责人也要落历史（reason 为空）
  const cur2 = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}`, { headers: { cookie: H.cookie } })).json() as { version: number };
  const patch = await fetch(`${BASE}/api/v1/work-items/${wi.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ version: cur2.version, assigneeId: memberId }),
  });
  ok("PATCH 改负责人 200", patch.status === 200, String(patch.status));
  const tr2 = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}/transfers`, { headers: { cookie: H.cookie } })).json() as { transfers: { reason: string | null }[] };
  ok("普通指派也写转派历史（2 条）", tr2.transfers.length === 2 && tr2.transfers[0]!.reason === null, JSON.stringify(tr2.transfers));

  const cur3 = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}`, { headers: { cookie: H.cookie } })).json() as { version: number };
  ok("重复转给同一人 → 400", (await fetch(`${BASE}/api/v1/work-items/${wi.id}/transfer`, {
    method: "POST", headers: H, body: JSON.stringify({ assigneeId: memberId, version: cur3.version }),
  })).status === 400);
  ok("无 work_item:assign 成员转派 → 403", (await fetch(`${BASE}/api/v1/work-items/${wi.id}/transfer`, {
    method: "POST", headers: M, body: JSON.stringify({ assigneeId: devId, version: cur3.version }),
  })).status === 403);

  // 关注：幂等 + 列表 + 双人 + 取消
  ok("关注 200", (await fetch(`${BASE}/api/v1/work-items/${wi.id}/follow`, { method: "PUT", headers: H, body: JSON.stringify({ channels: ["IN_APP"] }) })).status === 200);
  ok("重复关注仍 200（幂等）", (await fetch(`${BASE}/api/v1/work-items/${wi.id}/follow`, { method: "PUT", headers: H, body: JSON.stringify({ channels: ["IN_APP"] }) })).status === 200);
  await fetch(`${BASE}/api/v1/work-items/${wi.id}/follow`, { method: "PUT", headers: M, body: JSON.stringify({ channels: ["IN_APP", "EMAIL"] }) });
  const watchers = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}/watchers`, { headers: { cookie: H.cookie } })).json() as { watchers: { name: string; channels: string[] }[] };
  ok("关注者列表含两人且渠道正确", watchers.watchers.length === 2 && watchers.watchers.some((w) => w.name === "转派管理员" && w.channels.includes("IN_APP"))
    && watchers.watchers.some((w) => w.name === "普通成员" && w.channels.includes("EMAIL")), JSON.stringify(watchers.watchers));
  await fetch(`${BASE}/api/v1/work-items/${wi.id}/follow`, { method: "DELETE", headers: headersNoBody(H) });
  const after = await (await fetch(`${BASE}/api/v1/work-items/${wi.id}/watchers`, { headers: { cookie: H.cookie } })).json() as { watchers: unknown[] };
  ok("取消关注后剩 1 人", after.watchers.length === 1);
} finally {
  await app.close();
  await db.delete(workItemTransfer).where(eq(workItemTransfer.workItemId, wi.id));
  await db.delete(subscription).where(and(eq(subscription.targetType, "WORK_ITEM"), eq(subscription.targetId, wi.id)));
  await db.delete(workItem).where(eq(workItem.id, wi.id));
  await db.delete(project).where(eq(project.id, proj.id));
  await db.delete(auditEntry); await db.delete(activityEntry);
  for (const u of [ADMIN, DEV, MEMBER]) await deleteTestMember(u);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
