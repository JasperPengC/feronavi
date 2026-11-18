import "./_env.ts";   // 环境预设必须最先加载
/**
 * 外部集成自检（Round 25 长任务第 19 项，规范 8.3 / REST 11 节）：
 * CRUD + SSRF 校验 + 令牌信封加密 + 权限 + 审计 + 项目范围 + sync_cursor 级联。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, integration, member, project, role, roleAssignment, syncCursor } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { decryptSecret } from "../src/server/services/crypto.service.ts";
import * as projectService from "../src/server/services/project.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "intg-admin";
const MEMBER = "intg-member";
const PW = "intg-pass-123456";
const TOKEN = "ghp_super_secret_value_123";
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
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
const adminId = await mk(ADMIN, "集成管理员", ar!.id);
await mk(MEMBER, "集成普通成员", mr!.id);
const admin = (await loadActor(adminId))!;
const proj = await projectService.createProject(admin, { key: `INTG${SUFFIX}`, name: "集成项目" } as never);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const body = await r.json() as { csrfToken: string };
  return {
    "x-csrf-token": decodeURIComponent(body.csrfToken),
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
  };
};
let globalId = "";
try {
  const H = { ...(await login(ADMIN)), "content-type": "application/json" };
  const post = (body: unknown) => fetch(`${BASE}/api/v1/integrations`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const patch = (id: string, body: unknown) => fetch(`${BASE}/api/v1/integrations/${id}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  const list = async (qs = "") => {
    const r = await fetch(`${BASE}/api/v1/integrations${qs}`, { headers: { cookie: H.cookie } });
    return { status: r.status, body: await r.json() as { integrations?: { id: string; kind: string; name: string; isActive: boolean; baseUrl: string; hasToken: boolean; projectId: string | null }[] } };
  };

  // ① 建全局集成
  const created = await post({ kind: "GITHUB", name: "GitHub 主集成", baseUrl: "https://api.github.com", token: TOKEN });
  const createdBody = await created.json() as { id: string; token?: string; tokenEncrypted?: string; hasToken?: boolean };
  globalId = createdBody.id;
  ok("创建集成 201 且不回显令牌", created.status === 201 && !createdBody.token && !createdBody.tokenEncrypted && createdBody.hasToken === true, `${created.status} ${JSON.stringify(createdBody)}`);
  const row = (await db.select().from(integration).where(eq(integration.id, globalId)))[0]!;
  ok("令牌信封加密落库（非明文、可解密回原文）", row.tokenEncrypted !== TOKEN && !row.tokenEncrypted.includes(TOKEN) && decryptSecret(row.tokenEncrypted) === TOKEN);

  // ② SSRF：回环 / 云元数据 / 私网 / 非 https
  for (const [label, baseUrl] of [
    ["回环", "https://127.0.0.1:8080/"],
    ["云元数据", "https://169.254.169.254/latest/meta-data"],
    ["私网", "https://10.0.0.5/api"],
    ["非 https", "http://example.com/api"],
  ]) {
    const r = await post({ kind: "GITLAB", name: `ssrf-${label}`, baseUrl, token: "t" });
    ok(`不安全 base_url 被拒（${label}）`, r.status === 400, String(r.status));
  }

  // ③ 重复 / 非法 kind
  ok("同范围同地址重复被拒", (await post({ kind: "GITHUB", name: "dup", baseUrl: "https://api.github.com", token: "t" })).status === 400);
  ok("非法 kind 被拒", (await post({ kind: "BITBUCKET", name: "bad", baseUrl: "https://bitbucket.org", token: "t" })).status === 400);

  // ④ 项目范围：列表过滤 / 项目内集成
  const scoped = await post({ kind: "GITEE", name: "Gitee 项目集成", baseUrl: "https://gitee.com", token: "gitee-token", projectId: proj.id });
  const scopedBody = await scoped.json() as { id: string };
  ok("创建项目范围集成 201", scoped.status === 201, String(scoped.status));
  const scopedList = await list(`?projectId=${proj.id}`);
  ok("按项目过滤只返回该项目集成", scopedList.status === 200 && scopedList.body.integrations?.length === 1 && scopedList.body.integrations[0]?.projectId === proj.id, JSON.stringify(scopedList.body.integrations?.map((x) => x.name)));
  ok("全局列表包含两条", (await list()).body.integrations?.length === 2);

  // ⑤ 权限：普通成员不可读/写
  const guestH = { ...(await login(MEMBER)), "content-type": "application/json" };
  ok("无 integration:manage 读 → 403", (await fetch(`${BASE}/api/v1/integrations`, { headers: { cookie: guestH.cookie } })).status === 403);
  ok("无 integration:manage 写 → 403", (await fetch(`${BASE}/api/v1/integrations`, { method: "POST", headers: guestH, body: JSON.stringify({ kind: "GITHUB", name: "x", baseUrl: "https://api.github.com", token: "t" }) })).status === 403);

  // ⑥ 更新：改名/停用/换令牌；不安全 URL 被拒且不落库
  const updated = await patch(globalId, { name: "GitHub 主集成（改）", isActive: false, token: "ghp_rotated_token_456" });
  ok("更新集成 200", updated.status === 200, String(updated.status));
  const updatedRow = (await db.select().from(integration).where(eq(integration.id, globalId)))[0]!;
  ok("更新生效且令牌已轮换加密", updatedRow.name === "GitHub 主集成（改）" && updatedRow.isActive === false && decryptSecret(updatedRow.tokenEncrypted) === "ghp_rotated_token_456");
  const unsafe = await patch(globalId, { baseUrl: "https://192.168.1.10/" });
  const afterUnsafe = (await db.select().from(integration).where(eq(integration.id, globalId)))[0]!;
  ok("更新为不安全地址被拒且库内不变", unsafe.status === 400 && afterUnsafe.baseUrl === "https://api.github.com",
    `${unsafe.status} ${afterUnsafe.baseUrl}`);

  // ⑧ sync_cursor 随集成删除级联
  await db.insert(syncCursor).values({ integrationId: scopedBody.id, entity: "merge_requests", cursor: "c1" });
  const del = await fetch(`${BASE}/api/v1/integrations/${scopedBody.id}`, {
    method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] },
  });
  ok("删除集成 200", del.status === 200, `${del.status} ${await del.clone().text()}`);
  ok("删除后行与游标均被清理", (await db.select().from(integration).where(eq(integration.id, scopedBody.id))).length === 0
    && (await db.select().from(syncCursor).where(eq(syncCursor.integrationId, scopedBody.id))).length === 0);
  const auditAfter = await db.select().from(auditEntry);
  const intgAudit = auditAfter.filter((a) => a.action.startsWith("integration."));
  ok("创建/更新/删除均有 SECURITY 审计",
    ["integration.created", "integration.updated", "integration.deleted"].every((a) => intgAudit.some((x) => x.action === a))
    && intgAudit.every((a) => a.severity === "SECURITY"),
    JSON.stringify(intgAudit.map((a) => a.action)));
} finally {
  await app.close();
  if (globalId) await db.delete(integration).where(eq(integration.id, globalId));
  await db.delete(syncCursor);
  await db.delete(auditEntry);
  await db.delete(project).where(eq(project.id, proj.id));
  for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
