import "./_env.ts";   // 环境预设必须最先加载
/**
 * 组织信息自检（Round 25 长任务第 51 项，REST 第 3 节 GET/PATCH /organization）：
 * 读取、管理员改名/Logo/默认值、IANA 时区与语言校验、权限、审计；结束时恢复原值。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { getOrganization } from "../src/server/services/organization.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "org-admin";
const GUEST = "org-guest";
const PW = "org-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const GUEST_ROLE = (await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER")))[0]!;
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({
    username, email: `${username}@x.test`, name, status: "ACTIVE",
    timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
await mk(ADMIN, "组织管理员", ar!.id);
await mk(GUEST, "组织成员", GUEST_ROLE.id);

const original = await getOrganization();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
try {
  const H = await login(ADMIN);
  const read = await (await fetch(`${BASE}/api/v1/organization`)).json() as { name: string; defaultLocale: string; defaultTimezone: string; storageKind: string };
  ok("GET /organization 返回名称/默认值/存储类型", read.name === original.name && !!read.defaultLocale && !!read.defaultTimezone && !!read.storageKind, JSON.stringify(read));

  const newName = `组织验收 ${Date.now().toString(36).slice(-5)}`;
  const patched = await fetch(`${BASE}/api/v1/organization`, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ name: newName, logoUrl: "https://example.com/logo.svg", defaultLocale: "en-US", defaultTimezone: "America/New_York" }),
  });
  const patchedBody = await patched.json() as { name: string; defaultLocale: string; defaultTimezone: string; logoUrl: string };
  ok("管理员 PATCH 200 并返回新值", patched.status === 200 && patchedBody.name === newName
    && patchedBody.defaultLocale === "en-US" && patchedBody.defaultTimezone === "America/New_York" && patchedBody.logoUrl.includes("logo.svg"), JSON.stringify(patchedBody));
  const reread = await (await fetch(`${BASE}/api/v1/organization`)).json() as { name: string; defaultLocale: string };
  ok("GET 反映持久化后的新值", reread.name === newName && reread.defaultLocale === "en-US", JSON.stringify(reread));

  ok("非法时区 → 400", (await fetch(`${BASE}/api/v1/organization`, {
    method: "PATCH", headers: H, body: JSON.stringify({ defaultTimezone: "Not/AZone" }),
  })).status === 400);
  ok("非法 Logo URL → 400", (await fetch(`${BASE}/api/v1/organization`, {
    method: "PATCH", headers: H, body: JSON.stringify({ logoUrl: "not-a-url" }),
  })).status === 400);
  ok("非法语言 → 400", (await fetch(`${BASE}/api/v1/organization`, {
    method: "PATCH", headers: H, body: JSON.stringify({ defaultLocale: "fr-FR" }),
  })).status === 400);

  const G = await login(GUEST);
  ok("无 org:manage 修改 → 403", (await fetch(`${BASE}/api/v1/organization`, {
    method: "PATCH", headers: G, body: JSON.stringify({ name: "越权改名" }),
  })).status === 403);

  const audits = await db.select().from(auditEntry).where(eq(auditEntry.action, "organization.updated"));
  ok("写 SECURITY 审计 organization.updated", audits.length === 1 && audits[0]!.severity === "SECURITY", String(audits.length));
} finally {
  await app.close();
  // 恢复原值（清理审计）
  const { updateOrganization } = await import("../src/server/services/organization.service.ts");
  const { loadActor } = await import("../src/server/auth/actor-loader.ts");
  const adminRow = (await db.select({ id: member.id }).from(member).where(eq(member.username, ADMIN)))[0];
  if (adminRow) {
    await updateOrganization((await loadActor(adminRow.id))!, {
      name: original.name, logoUrl: original.logoUrl, defaultLocale: original.defaultLocale, defaultTimezone: original.defaultTimezone,
    });
  }
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
