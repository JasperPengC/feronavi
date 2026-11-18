import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/**
 * 安装向导自检（R7）
 *
 * 重点验四件事：
 *   1 **未初始化时的拦截面**：页面 302 → /setup；API 返回 JSON 错误（不重定向）
 *   2 **原子性**：向导完成失败时不得留下「组织建了但管理员没建」的半初始化状态
 *   3 **完成后锁定**：/setup 页面转登录，向导写 API 仍返回 403
 *   4 **管理员能登录**且拿到 47 权限（向导产物真的可用）
 */
import { buildApp } from "../src/server/app.ts";
import { db, sql } from "../src/db/index.ts";
import { member, organization, roleAssignment, setting, setupState } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { deleteTestMember } from "./_test-helpers.ts";

/**
 * ⚠️⚠️ **破坏性套件护栏**（血的教训）：
 * 本套件测的是安装向导，会**清空实例状态**（`setup_state` / `organization` / 管理员标志位）。
 * 实测后果：在本地演示实例上跑一次全量回归，用户再打开应用就变成"实例尚未初始化"，
 * 而重新走向导又会因"用户名已被占用"失败 —— **实例彻底卡死**（产品侧已加数据事实判据自愈，
 * 但测试侧同样必须负责）。
 * 因此：实例已有数据时**必须显式授权**才允许清空。
 */
{
  const { db: _db } = await import("../src/db/index.ts");
  const { member: _m } = await import("../src/db/schema.ts");
  const rows = await _db.select({ id: _m.id }).from(_m).limit(1);
  const hasData = rows.length > 0;
  if (hasData && process.env.ALLOW_DESTRUCTIVE_SETUP_TEST !== "1") {
    console.log("  ⏭  跳过：本实例已有数据（破坏性套件需 ALLOW_DESTRUCTIVE_SETUP_TEST=1 才运行）");
    process.exit(0);
  }
}


let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const BASE = process.env.BASE ?? "http://127.0.0.1:3997";
const USER = "wizard-admin", PW = "wizard-password-1234";
const originalDataDir = process.env.DATA_DIR;
let testDataDir: string | undefined;

/** 把实例重置为「未初始化」（删掉向导产物） */
async function resetToUninitialized() {
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId,
    (await db.select({ id: member.id }).from(member).where(eq(member.username, USER)).limit(1))[0]?.id ?? "00000000-0000-0000-0000-000000000000"));
  await deleteTestMember(USER);
  await db.delete(setting).where(eq(setting.key, "org.defaultLocale"));
  await db.delete(setting).where(eq(setting.key, "org.defaultTimezone"));
  await db.delete(setting).where(eq(setting.key, "setup.completedAt"));
  await db.delete(setting).where(eq(setting.key, "storage.kind"));
  await db.delete(setupState);
  await db.delete(organization);
}

await resetToUninitialized();
const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3997), host: "127.0.0.1" });

try {
  // ── ① 未初始化：拦截面 ────────────────────────────────────
  const rootPage = await fetch(`${BASE}/`, { redirect: "manual" });
  ok("未初始化时页面请求 → 302", rootPage.status === 302, `实际 ${rootPage.status}`);
  ok("302 指向 /setup", rootPage.headers.get("location") === "/setup", String(rootPage.headers.get("location")));

  const apiCall = await fetch(`${BASE}/api/v1/projects`);
  const apiBody = await apiCall.json() as { code: string };
  ok("未初始化时 API 返回 JSON 错误（不重定向）", apiCall.status === 403 && apiBody.code === "FORBIDDEN",
    `${apiCall.status} ${JSON.stringify(apiBody)}`);

  const state0 = await (await fetch(`${BASE}/api/v1/setup/state`)).json() as { initialized: boolean };
  ok("state 报告未初始化", state0.initialized === false);

  // ── ② 环境自检 ────────────────────────────────────────────
  // 先验**失败路径**：指向一个不存在的目录，自检必须如实报 ok=false 且给出可读原因
  process.env.DATA_DIR = "/nonexistent-dir-for-test";
  const preBad = await (await fetch(`${BASE}/api/v1/setup/precheck`)).json() as {
    items: { key: string; ok: boolean; message: string }[]; ok: boolean;
  };
  ok("自检返回 4 项", preBad.items.length === 4, `实际 ${preBad.items.length}`);
  const dataDirBad = preBad.items.find((i) => i.key === "dataDir")!;
  ok("数据目录不可写 → ok=false（如实报告）", dataDirBad.ok === false);
  ok("失败项有可读中文原因", /不可写/.test(dataDirBad.message), dataDirBad.message);
  ok("任一项失败时整体 ok=false", preBad.ok === false);

  // 再验**通过路径**：指向可写目录，四项应全过
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  testDataDir = await mkdtemp(join(tmpdir(), "feronavi-test-"));
  process.env.DATA_DIR = testDataDir;
  const pre = await (await fetch(`${BASE}/api/v1/setup/precheck`)).json() as { items: { key: string; ok: boolean }[]; ok: boolean };
  ok("数据目录可写时四项全过", pre.ok === true, JSON.stringify(pre.items.filter((i) => !i.ok)));
  ok("自检含数据库项", pre.items.some((i) => i.key === "database" && i.ok));
  ok("自检含 IANA 时区项", pre.items.some((i) => i.key === "timezone" && i.ok));

  // ── ③ 完成向导的校验：弱密码应被拒 ────────────────────────
  const weak = await fetch(`${BASE}/api/v1/setup/complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admin: { username: USER, email: "w@example.test", password: "short", name: "向导管理员" },
      org: { name: "测试组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" },
    }),
  });
  ok("弱密码 → 400 VALIDATION", weak.status === 400, `实际 ${weak.status}`);

  // ── ④ 原子性：**必须让失败发生在组织写入之后** ──────────────
  // ⚠️ 前面那个弱密码用例测不出原子性 —— 它在任何写库之前就被拒了，
  //    组织压根没写过，「回滚」无从谈起（实测踩到）。
  //    这里用 email 唯一索引制造「事务中途失败」：应用层只查用户名查重、不查邮箱，
  //    所以会走到事务里、在组织已插入之后、在成员插入时失败。
  await db.insert(member).values({
    username: "occupied-email", email: "w@example.test", name: "占位",
    status: "ACTIVE", passwordHash: "!",
  });
  const midwayFail = await fetch(`${BASE}/api/v1/setup/complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admin: { username: USER, email: "w@example.test", password: PW, name: "向导管理员" },
      org: { name: "测试组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" },
    }),
  });
  ok("邮箱冲突导致向导失败（非 201）", midwayFail.status !== 201, `实际 ${midwayFail.status}`);
  const midwayOrg = await db.select().from(organization);
  ok("事务中途失败 → 组织行被回滚（原子性）", midwayOrg.length === 0, `实际 ${midwayOrg.length} 行`);
  const midwayMember = await db.select().from(member).where(eq(member.username, USER));
  ok("事务中途失败 → 管理员未被创建", midwayMember.length === 0);
  await db.delete(member).where(eq(member.username, "occupied-email"));

  // ── ⑤ 正常完成 ────────────────────────────────────────────
  const done = await fetch(`${BASE}/api/v1/setup/complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admin: { username: USER, email: "w@example.test", password: PW, name: "向导管理员" },
      org: { name: "测试组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" },
      integrations: { storage: { kind: "local" } },
    }),
  });
  ok("完整向导 → 201", done.status === 201, `实际 ${done.status} ${await done.text()}`);

  const org = await db.select().from(organization);
  ok("组织恰好一行", org.length === 1, `实际 ${org.length}`);
  ok("组织时区为 IANA 标识", org[0]?.defaultTimezone === "Asia/Shanghai", org[0]?.defaultTimezone);

  const adminRow = (await db.select().from(member).where(eq(member.username, USER)).limit(1))[0];
  ok("管理员已创建", adminRow !== undefined);
  ok("管理员标记为初始管理员（首次登录强制改密）", adminRow?.isInitialAdmin === true);

  const ra = await db.select().from(roleAssignment).where(eq(roleAssignment.memberId, adminRow!.id));
  ok("管理员已授 ADMIN（组织级）", ra.length === 1 && ra[0]?.scopeType === "ORG", JSON.stringify(ra.map((r) => r.scopeType)));

  const st = await db.select().from(setupState);
  ok("setup_state 已落标记（恰好一行）", st.length === 1 && st[0]?.initializedAt != null);

  // ── ⑥ 完成后锁定 ──────────────────────────────────────────
  const setupPage = await fetch(`${BASE}/setup`, { redirect: "manual" });
  ok("完成后 /setup → 302 /login", setupPage.status === 302 && setupPage.headers.get("location") === "/login",
    `实际 ${setupPage.status} ${setupPage.headers.get("location")}`);
  const setupApi = await fetch(`${BASE}/api/v1/setup/state`);
  // ⚠️ /setup/state 是**刻意的例外**（D5）：前端靠它决定跳向导还是跳登录，故永远可访问。
  //    其余向导端点（complete / step）在完成后仍必须被拦。
  ok("完成后 /setup/state 仍可访问（前端路由依据）", setupApi.status === 200, `实际 ${setupApi.status}`);
  const stateBody = await setupApi.json() as { initialized: boolean };
  ok("且如实报告已初始化", stateBody.initialized === true, JSON.stringify(stateBody));
  const stepAfter = await fetch(`${BASE}/api/v1/setup/step`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: 2 }),
  });
  ok("完成后 /setup/step → 403（其余向导端点仍拦）", stepAfter.status === 403, `实际 ${stepAfter.status}`);
  const rerun = await fetch(`${BASE}/api/v1/setup/complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admin: { username: "second", email: "s@example.test", password: PW, name: "第二个" },
      org: { name: "改名", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" },
    }),
  });
  ok("重复完成向导 → 403（不能改掉管理员）", rerun.status === 403, `实际 ${rerun.status}`);
  ok("组织名未被重复提交改动", (await db.select().from(organization))[0]?.name === "测试组织");

  // ── ⑦ 向导产物可用：管理员能登录并拿到 47 权限 ────────────
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PW }),
  });
  ok("向导创建的管理员能登录", login.status === 200, `实际 ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/auth/me`, { headers: { cookie } })).json() as {
    permissions: string[]; mustChangePassword: boolean;
  };
  ok("登录后拿到 47 个权限", me.permissions.length === 47, String(me.permissions.length));
  ok("标记必须改密（初始管理员）", me.mustChangePassword === true);

  // ── ⑧ 敏感设置不回显 ──────────────────────────────────────
  await db.insert(setting).values({ key: "smtp.password", value: "top-secret" as unknown as object, isSecret: true });
  const pub = await (await fetch(`${BASE}/api/v1/organization`)).json() as Record<string, unknown>;
  ok("敏感键（smtp.password）不出现在公开设置里", !("smtp.password" in pub), JSON.stringify(Object.keys(pub)));
} finally {
  await app.close();
  await resetToUninitialized();
  await db.delete(setting).where(eq(setting.key, "smtp.password"));
  await sql.end();
  if (testDataDir) {
    const { rm } = await import("node:fs/promises");
    await rm(testDataDir, { recursive: true, force: true });
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
