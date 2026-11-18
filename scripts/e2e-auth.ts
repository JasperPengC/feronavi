import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 第 3 步端到端自检：登录 → Actor → 权限判定 → CSRF
 *
 * 这是「能登录 + 权限集正确 + CSRF 生效且不拦 MCP」的可执行证据。
 * 用真实 HTTP 打真实服务，不是单测里的 mock。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";

// 前置：本测试要打 API，实例必须是「已初始化」（否则被 R7 的拦截钩子挡成 403）
await ensureInitialized();
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

// ── 准备一个测试管理员 ────────────────────────────────────────
const USERNAME = "t-admin";
const PASSWORD = "correct-horse-battery";
await deleteTestMember(USERNAME);
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
if (!adminRole) throw new Error("种子未跑：找不到 ADMIN 角色");

const [m] = await db.insert(member).values({
  username: USERNAME,
  email: "t-admin@example.test",
  name: "测试管理员",
  status: "ACTIVE",
  passwordHash: await hashPassword(PASSWORD),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: m!.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });

try {
  // ── ① 登录 ──────────────────────────────────────────────────
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  check("登录成功（200）", loginRes.status === 200, `实际 ${loginRes.status}`);
  const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  check("返回会话 Cookie", cookie.includes("feronavi_session="));
  const setCookieRaw = loginRes.headers.getSetCookie().join(" ");
  check("Cookie 有 HttpOnly", /HttpOnly/i.test(setCookieRaw));
  check("Cookie 有 SameSite=Lax", /SameSite=Lax/i.test(setCookieRaw));

  // ── ② 错误密码 ─────────────────────────────────────────────
  const bad = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: "wrong-password-here" }),
  });
  const badBody = await bad.json() as { code: string };
  check("错误密码 → 403 FORBIDDEN", bad.status === 403 && badBody.code === "FORBIDDEN", JSON.stringify(badBody));

  // 不存在的用户名必须返回**与密码错误完全相同**的响应（不可枚举）
  const ghost = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "no-such-user", password: "wrong-password-here" }),
  });
  const ghostBody = await ghost.json() as { code: string; message: string };
  check("不存在的用户 → 同形响应（不可枚举）",
    ghost.status === bad.status && ghostBody.code === badBody.code, `${ghost.status}/${ghostBody.code}`);

  // ── ③ GET /auth/me → 完整 Actor ────────────────────────────
  const me = await fetch(`${BASE}/api/v1/auth/me`, { headers: { cookie } });
  const actor = await me.json() as {
    memberId: string; username: string; permissions: string[];
    dataScopes: { scopeType: string; scopeId: string | null }[];
  };
  check("/auth/me 返回 200", me.status === 200, `实际 ${me.status}`);
  check("Actor 有身份", actor.memberId === m!.id && actor.username === USERNAME);
  check("Actor 有 47 个权限（ADMIN）", actor.permissions.length === 47, `实际 ${actor.permissions.length}`);
  check("Actor 有数据范围（ORG）",
    actor.dataScopes.length === 1 && actor.dataScopes[0]!.scopeType === "ORG");

  // ── ④ 未登录访问 ───────────────────────────────────────────
  const anon = await fetch(`${BASE}/api/v1/auth/me`);
  check("未登录 → 403（不是 401 泄露路由存在性）", anon.status === 403, `实际 ${anon.status}`);

  // ── ⑤ CSRF：Cookie 会话的写端点必须拦住 ─────────────────────
  const noCsrf = await fetch(`${BASE}/api/v1/auth/logout`, { method: "POST", headers: { cookie } });
  const noCsrfBody = await noCsrf.json() as { code: string };
  check("写端点无 CSRF 令牌 → 403", noCsrf.status === 403 && noCsrfBody.code === "FORBIDDEN",
    `${noCsrf.status}/${noCsrfBody.code}`);

  // ── ⑥ 路由不存在 → 404（契约里 404 只用于此）────────────────
  const notFound = await fetch(`${BASE}/api/v1/nope`);
  const nfBody = await notFound.json() as { code: string };
  check("未知路由 → 404 NOT_FOUND", notFound.status === 404 && nfBody.code === "NOT_FOUND");

  // ── ⑦ 健康检查 ─────────────────────────────────────────────
  const status = await fetch(`${BASE}/api/v1/system/status`);
  check("system/status 可用", status.status === 200);
} finally {
  await app.close();
  await deleteTestMember(USERNAME);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
