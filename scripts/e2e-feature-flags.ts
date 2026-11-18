import "./_env.ts";   // 环境预设必须最先加载
/**
 * 功能开关自检（Round 25 长任务第 23 项，规范 8.3 / REST 11 节）：
 * GET 列表 / PUT upsert、key 校验、setting:manage 权限、SECURITY 审计、读取辅助。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, featureFlag, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as flagService from "../src/server/services/feature-flag.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "flag-admin";
const MEMBER = "flag-member";
const PW = "flag-pass-123456";
const KEY = `ui.e2e.flag${Date.now().toString(36).slice(-4)}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
await db.delete(featureFlag);
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
await mk(ADMIN, "开关管理员", ar!.id);
await mk(MEMBER, "开关普通成员", mr!.id);

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const body = await r.json() as { csrfToken: string };
  return {
    cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": decodeURIComponent(body.csrfToken),
  };
};
try {
  const H = { ...(await login(ADMIN)), "content-type": "application/json" };
  const list = async (headers: Record<string, string>) => {
    const r = await fetch(`${BASE}/api/v1/feature-flags`, { headers });
    return { status: r.status, body: await r.json() as { flags?: { key: string; enabled: boolean; config: unknown }[] } };
  };
  const put = (key: string, body: unknown) => fetch(`${BASE}/api/v1/feature-flags/${encodeURIComponent(key)}`, {
    method: "PUT", headers: H, body: JSON.stringify(body),
  });

  ok("初始列表为空", (await list(H)).body.flags?.length === 0);
  const created = await put(KEY, { enabled: true, config: { rollout: 10 } });
  const createdBody = await created.json() as { key: string; enabled: boolean; config: { rollout?: number } };
  ok("新建开关 200 且 enabled/config 正确", created.status === 200 && createdBody.enabled === true && createdBody.config.rollout === 10, JSON.stringify(createdBody));
  ok("列表能读到开关", (await list(H)).body.flags?.some((f) => f.key === KEY));
  ok("读取辅助 isFeatureEnabled = true", (await flagService.isFeatureEnabled(KEY)) === true);

  const updated = await put(KEY, { enabled: false });
  const updatedBody = await updated.json() as { enabled: boolean; config: { rollout?: number } };
  ok("更新为停用且保留 config", updated.status === 200 && updatedBody.enabled === false && updatedBody.config.rollout === 10, JSON.stringify(updatedBody));
  ok("读取辅助 isFeatureEnabled = false", (await flagService.isFeatureEnabled(KEY)) === false);
  ok("未配置的开关读取为 false", (await flagService.isFeatureEnabled("ui.e2e.missing")) === false);

  ok("非法 key（含空格/大写）→ 400", (await put("Bad Key!", { enabled: true })).status === 400);
  ok("过短 key → 400", (await put("a", { enabled: true })).status === 400);
  ok("body 缺 enabled → 400", (await put(KEY, {})).status === 400);

  const guestH = { ...(await login(MEMBER)), "content-type": "application/json" };
  ok("无 setting:manage 读 → 403", (await list(guestH)).status === 403);
  ok("无 setting:manage 写 → 403", (await fetch(`${BASE}/api/v1/feature-flags/${encodeURIComponent(KEY)}`, {
    method: "PUT", headers: guestH, body: JSON.stringify({ enabled: true }),
  })).status === 403);

  const audits = await db.select().from(auditEntry).where(eq(auditEntry.action, "feature_flag.updated"));
  ok("两次写入均落 SECURITY 审计且记录开关 key",
    audits.length === 2 && audits.every((a) => a.severity === "SECURITY"
      && (a.changes as { flagKey?: string } | null)?.flagKey === KEY),
    JSON.stringify(audits.map((a) => ({ severity: a.severity, changes: a.changes }))));
} finally {
  await app.close();
  await db.delete(featureFlag);
  await db.delete(auditEntry);
  for (const u of [ADMIN, MEMBER]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
