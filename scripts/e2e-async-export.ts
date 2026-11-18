import "./_env.ts";   // 环境预设必须最先加载
/**
 * 异步全量导出自检（Round 25 长任务第 46 项，REST 12 节 /system/exports/:id）：
 * POST 入队 → 生成中 409 → worker 生成文件 → GET 下载带 schemaVersion；权限与不存在同形。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { existsSync } from "node:fs";
import { db, sql } from "../src/db/index.ts";
import { auditEntry, job, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as jobService from "../src/server/services/job.service.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { exportPackagePath } from "../src/server/services/full-export.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "export-admin";
const GUEST = "export-guest";
const PW = "export-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(job);
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
await mk(ADMIN, "导出管理员", ar!.id);
await mk(GUEST, "导出成员", mr!.id);

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
let jobId = "";
try {
  const H = await login(ADMIN);
  // ① POST 入队
  const created = await fetch(`${BASE}/api/v1/system/exports`, {
    method: "POST", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] },
  });
  const createdBody = await created.json() as { id: string; status: string };
  jobId = createdBody.id;
  ok("POST /system/exports 201 并返回任务 id", created.status === 201 && !!jobId && createdBody.status === "PENDING", JSON.stringify(createdBody));
  const row = (await db.select().from(job).where(eq(job.id, jobId)))[0];
  ok("落库 job kind=export.full / PENDING", row?.kind === "export.full" && row.status === "PENDING", JSON.stringify(row && { k: row.kind, s: row.status }));

  // ② 生成中下载 → 409
  const early = await fetch(`${BASE}/api/v1/system/exports/${jobId}`, { headers: { cookie: H.cookie } });
  ok("生成中 GET → 409", early.status === 409, String(early.status));

  // ③ worker 生成文件
  jobService.clearJobHandlers();
  registerBuiltinJobHandlers();
  const stats = await jobService.runJobWorkerOnce("export-e2e", 10);
  const after = (await db.select().from(job).where(eq(job.id, jobId)))[0]!;
  ok("worker 成功处理导出任务", stats.succeeded >= 1 && after.status === "SUCCEEDED", JSON.stringify({ stats, s: after.status }));
  ok("导出包文件真实落盘（0600 由代码设置）", existsSync(exportPackagePath(jobId)));

  // ④ 下载
  const dl = await fetch(`${BASE}/api/v1/system/exports/${jobId}`, { headers: { cookie: H.cookie } });
  const body = await dl.json() as { schemaVersion: string; mode: string; totalRows: number; data: Record<string, unknown>; excludedTables: Record<string, string> };
  ok("GET 下载 200 + disposition + schemaVersion", dl.status === 200
    && (dl.headers.get("content-disposition") ?? "").includes("feronavi-full-export-")
    && dl.headers.get("x-schema-version") === "1" && dl.headers.get("x-export-mode") === "async", String(dl.status));
  ok("包内容含 schemaVersion/mode/excludedTables/真实数据", body.schemaVersion === "1" && body.mode === "async"
    && typeof body.totalRows === "number" && !!body.data && !!body.excludedTables && !("member.passwordHash" in body.data), JSON.stringify({ sv: body.schemaVersion, mode: body.mode, rows: body.totalRows }));
  ok("敏感表材料不外泄（member 行无 password_hash）", !JSON.stringify(body.data.member ?? []).includes("password_hash"));

  // ⑤ 权限与不存在同形
  const G = await login(GUEST);
  ok("无权限 POST → 403", (await fetch(`${BASE}/api/v1/system/exports`, {
    method: "POST", headers: { cookie: G.cookie, "x-csrf-token": G["x-csrf-token"] },
  })).status === 403);
  ok("无权限 GET → 403", (await fetch(`${BASE}/api/v1/system/exports/${jobId}`, { headers: { cookie: G.cookie } })).status === 403);
  ok("不存在 id GET → 403（与不可见同形）", (await fetch(`${BASE}/api/v1/system/exports/00000000-0000-0000-0000-000000000000`, { headers: { cookie: H.cookie } })).status === 403);
} finally {
  await app.close();
  if (jobId) {
    const { rm } = await import("node:fs/promises");
    await rm(exportPackagePath(jobId), { force: true });
  }
  await db.delete(job);
  await db.delete(auditEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
