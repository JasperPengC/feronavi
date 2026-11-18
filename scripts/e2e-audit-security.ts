import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 安全审计自检（Round 25 长任务第 2 项）：
 * 登录成功/失败、登出、改密、令牌创建/吊销、成员启停、设置修改、2FA 启停 都要写 audit_entry（SECURITY）。
 *
 * 只做真实 HTTP + 真实库校验：不 mock 审计服务，直接查 audit_entry 行。
 */
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, auditEntry, apiToken, setting } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq, desc } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN_USER = "sec-auditor";
const TARGET_USER = "sec-target";
const ADMIN_PW = "sec-auditor-pass-1234";
const TARGET_PW = "sec-target-pass-1234";
const TOKEN_NAME = "audit-security-test-token";
const SETTING_KEY = "ai.enabled";   // 白名单内的键（设置端点拒绝任意键，这是设计）

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ── 准备两个账号（admin + 被禁用的目标） ──
for (const u of [ADMIN_USER, TARGET_USER]) await db.delete(member).where(eq(member.username, u));
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
if (!ar) throw new Error("种子未跑：找不到 ADMIN 角色");
const [admin] = await db.insert(member).values({
  username: ADMIN_USER, email: "sec-auditor@x.test", name: "安全审计员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(ADMIN_PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: admin!.id, roleId: ar.id, scopeType: "ORG", scopeId: null });
const [target] = await db.insert(member).values({
  username: TARGET_USER, email: "sec-target@x.test", name: "被操作成员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(TARGET_PW),
}).returning({ id: member.id });

// 设置键是白名单制：用 ai.enabled 做写入验证，并记录原值以便还原
const [prevSetting] = await db.select().from(setting).where(eq(setting.key, SETTING_KEY));

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });

let tokenId: string | undefined;
try {
  // ① 登录成功
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PW }),
  });
  const loginBody = await login.json() as { csrfToken: string };
  ok("登录成功（200）", login.status === 200, `实际 ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf = loginBody.csrfToken;
  // ⚠️ 无 body 的 DELETE/POST 不能带 content-type: application/json（Fastify 会 400 空 JSON）
  const AUTH = { cookie, "x-csrf-token": decodeURIComponent(csrf) };
  const H = { ...AUTH, "content-type": "application/json" };

  // ② 登录失败
  const bad = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: "definitely-wrong" }),
  });
  ok("错误密码 → 403", bad.status === 403, `实际 ${bad.status}`);

  // ③ 建令牌 → 吊销
  const tk = await fetch(`${BASE}/api/v1/tokens`, {
    method: "POST", headers: H,
    body: JSON.stringify({ name: TOKEN_NAME, tier: "READ_ONLY" }),
  });
  const tkBody = await tk.json() as { row?: { id: string } };
  tokenId = tkBody.row?.id;
  ok("创建令牌（201）", tk.status === 201 && !!tokenId, `实际 ${tk.status}/${tokenId}`);
  const revoke = await fetch(`${BASE}/api/v1/tokens/${tokenId}`, { method: "DELETE", headers: AUTH });
  ok("吊销令牌（200）", revoke.status === 200, `实际 ${revoke.status}`);

  // ④ 禁用 / 启用成员
  const dis = await fetch(`${BASE}/api/v1/members/${target!.id}/disable`, { method: "POST", headers: AUTH });
  ok("禁用成员（200）", dis.status === 200, `实际 ${dis.status}`);
  const en = await fetch(`${BASE}/api/v1/members/${target!.id}/enable`, { method: "POST", headers: AUTH });
  ok("启用成员（200）", en.status === 200, `实际 ${en.status}`);

  // ⑤ 修改设置
  const st = await fetch(`${BASE}/api/v1/settings`, {
    method: "PUT", headers: H, body: JSON.stringify({ [SETTING_KEY]: false }),
  });
  ok("修改设置（200）", st.status === 200, `实际 ${st.status} ${(await st.text()).slice(0, 160)}`);

  // ⑥ 审计读取端点（登出前，否则会话失效会 403）
  const list = await fetch(`${BASE}/api/v1/audit-entries?pageSize=20`, { headers: { cookie } });
  ok("审计列表端点可读（200）", list.status === 200, `实际 ${list.status}`);

  // ── 审计列表筛选：级别 / 动作关键字 / 对象类型 / LIKE 转义 ──
  const auditList = async (qs: string) => {
    const r = await fetch(`${BASE}/api/v1/audit-entries?${qs}`, { headers: { cookie } });
    return { status: r.status, body: await r.json() as { items?: { action: string; severity: string; targetType: string }[]; total?: number } };
  };
  const sec = await auditList("pageSize=100&severity=SECURITY");
  ok("severity=SECURITY 只返回安全审计", sec.status === 200 && (sec.body.total ?? 0) > 0 && (sec.body.items ?? []).every((x) => x.severity === "SECURITY"),
    JSON.stringify({ total: sec.body.total }));
  const loginByAction = await auditList("pageSize=100&q=auth.login");
  ok("q=auth.login 命中登录成功/失败事件", (loginByAction.body.total ?? 0) >= 2 && (loginByAction.body.items ?? []).every((x) => x.action.includes("auth.login")),
    JSON.stringify({ total: loginByAction.body.total }));
  const byTarget = await auditList("pageSize=100&targetType=MEMBER");
  ok("targetType=MEMBER 过滤生效", (byTarget.body.total ?? 0) > 0 && (byTarget.body.items ?? []).every((x) => x.targetType === "MEMBER"));
  const fromPast = await auditList("pageSize=100&from=2000-01-01T00:00:00.000Z");
  ok("from 过滤生效（从 2000 年起 → 全部记录）", (fromPast.body.total ?? 0) > 0, JSON.stringify({ total: fromPast.body.total }));
  const toPast = await auditList("pageSize=100&to=2000-01-01T00:00:00.000Z");
  ok("to 过滤生效（截止 2000 年 → 0 条）", (toPast.body.total ?? -1) === 0, JSON.stringify({ total: toPast.body.total }));

  const wildcard = await auditList("pageSize=100&q=%25");
  ok("审计搜索的 LIKE 通配符被转义（q=% 不返回全部）", (wildcard.body.total ?? -1) === 0, JSON.stringify({ total: wildcard.body.total }));

  // ⑦ 登出
  const out = await fetch(`${BASE}/api/v1/auth/logout`, { method: "POST", headers: AUTH });
  ok("登出（200）", out.status === 200, `实际 ${out.status}`);

  // ── 库内校验 ──
  const rows = await db.select().from(auditEntry).orderBy(desc(auditEntry.createdAt));
  const byAction = (a: string) => rows.filter((r) => r.action === a);
  const loginRow = byAction("auth.login")[0];
  ok("登录成功有审计", !!loginRow);
  ok("登录审计是 SECURITY 级且绑定 actor",
    loginRow?.severity === "SECURITY" && loginRow?.actorId === admin!.id && loginRow?.actorSnapshot === ADMIN_USER,
    JSON.stringify({ s: loginRow?.severity, a: loginRow?.actorId, n: loginRow?.actorSnapshot }));
  ok("登录审计记录了 IP", !!loginRow?.ip && loginRow.ip.length > 0, String(loginRow?.ip));

  const failRow = byAction("auth.login_failed")[0];
  ok("登录失败有审计（无 actorId，快照=尝试用户名）",
    !!failRow && failRow.severity === "SECURITY" && failRow.actorId === null && failRow.actorSnapshot === ADMIN_USER,
    JSON.stringify({ a: failRow?.actorId, n: failRow?.actorSnapshot }));

  ok("令牌创建/吊销均有审计",
    byAction("token.created")[0]?.targetId === tokenId && byAction("token.revoked")[0]?.targetId === tokenId,
    JSON.stringify({ c: byAction("token.created")[0]?.targetId, r: byAction("token.revoked")[0]?.targetId }));
  ok("成员启停均有审计",
    byAction("member.disabled")[0]?.targetId === target!.id && byAction("member.enabled")[0]?.targetId === target!.id);
  ok("设置修改有审计（SECURITY，actor 正确）",
    byAction("settings.updated")[0]?.actorId === admin!.id && byAction("settings.updated")[0]?.severity === "SECURITY");
  ok("登出有审计（绑定 actor）", byAction("auth.logout")[0]?.actorId === admin!.id);

  // 不泄露敏感材料：审计 changes 里不得出现密码/令牌明文
  const dump = JSON.stringify(rows.map((r) => ({ c: r.changes, s: r.actorSnapshot })));
  ok("审计不包含密码/令牌明文",
    !/sec-auditor-pass|definitely-wrong|sec-target-pass|fero_/i.test(dump), dump.slice(0, 120));

} finally {
  await app.close();
  await db.delete(auditEntry);
  await db.delete(apiToken).where(eq(apiToken.name, TOKEN_NAME));
  if (prevSetting) {
    await db.update(setting).set({ value: prevSetting.value as object, isSecret: prevSetting.isSecret }).where(eq(setting.key, SETTING_KEY));
  } else {
    await db.delete(setting).where(eq(setting.key, SETTING_KEY));
  }
  for (const u of [ADMIN_USER, TARGET_USER]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
