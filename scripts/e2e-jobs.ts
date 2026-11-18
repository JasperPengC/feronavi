import "./_env.ts";   // 环境预设必须最先加载
/**
 * 通用任务队列自检（Round 25 长任务第 45 项，数据模型 8.6）：
 * 入队去重、SKIP LOCKED 取任务、成功/失败退避/死信、僵死回收、worker 轮询、未知 kind、
 * 运维状态 HTTP 暴露、密码找回入队（不发信）。
 */
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { auditEntry, job, member, role, roleAssignment, setting } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as jobService from "../src/server/services/job.service.ts";
import { putSettings } from "../src/server/services/setting.service.ts";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "job-admin";
const PW = "job-pass-123456";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

for (const u of [ADMIN]) await deleteTestMember(u);
await db.delete(job);
await db.delete(auditEntry);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: ADMIN, email: "job-admin@x.test", name: "任务管理员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async () => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN, password: PW }),
  });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
try {
  // ① 入队 + dedupe
  const j1 = await jobService.enqueue({ kind: "test.echo", payload: { n: 1 }, dedupeKey: "dedupe:one" });
  const j2 = await jobService.enqueue({ kind: "test.echo", payload: { n: 2 }, dedupeKey: "dedupe:one" });
  ok("活跃去重：同 dedupeKey 只保留一条", !!j1 && j2?.id === j1.id && (await db.select().from(job)).length === 1, String(j2?.id));

  // ② run_at 到期才可取
  const future = await jobService.enqueue({ kind: "test.echo", runAt: new Date(Date.now() + 3_600_000) });
  const claimed1 = await jobService.claimBatch("worker-1", 10);
  ok("只取到期任务，未来任务不被取走", claimed1.length === 1 && claimed1[0]!.id === j1!.id
    && (await db.select().from(job).where(eq(job.id, future!.id)))[0]?.status === "PENDING", JSON.stringify(claimed1.map((x) => x.id)));
  ok("取走即 RUNNING + attempts=1 + locked_by", claimed1[0]!.status === "RUNNING" && claimed1[0]!.attempts === 1 && claimed1[0]!.lockedBy === "worker-1");
  ok("另一个 worker 取不到同一任务", (await jobService.claimBatch("worker-2", 10)).length === 0);

  // ③ 成功
  await jobService.markSucceeded(j1!.id, claimed1[0]!);
  ok("markSucceeded → SUCCEEDED", (await db.select().from(job).where(eq(job.id, j1!.id)))[0]?.status === "SUCCEEDED");

  // ④ 失败退避 → 再失败到 DEAD
  const retry = await jobService.enqueue({ kind: "test.echo", maxAttempts: 2 });
  const [firstRetry] = await jobService.claimBatch("worker-1", 10);
  await jobService.markFailed(retry!.id, "第一次失败", firstRetry!);
  const afterFail = (await db.select().from(job).where(eq(job.id, retry!.id)))[0]!;
  ok("失败未超限 → PENDING + 推后 run_at + last_error", afterFail.status === "PENDING" && afterFail.lastError === "第一次失败"
    && afterFail.runAt.getTime() > Date.now() + 1_000, JSON.stringify({ s: afterFail.status, runAt: afterFail.runAt }));
  await db.update(job).set({ runAt: new Date(Date.now() - 1000) }).where(eq(job.id, retry!.id));
  const [secondRetry] = await jobService.claimBatch("worker-2", 10);
  await jobService.markFailed(retry!.id, "第二次失败", secondRetry!);
  const dead = (await db.select().from(job).where(eq(job.id, retry!.id)))[0]!;
  ok("超过 max_attempts → DEAD 且保留最后错误", dead.status === "DEAD" && dead.attempts === 2 && dead.lastError === "第二次失败", JSON.stringify(dead));

  // ⑤ 僵死回收
  const stalled = await jobService.enqueue({ kind: "test.echo" });
  await jobService.claimBatch("worker-dead", 10);
  await db.update(job).set({ lockedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(job.id, stalled!.id));
  const recovered = await jobService.recoverStalled();
  ok("RUNNING 超 10 分钟被回收为 PENDING", recovered >= 1
    && (await db.select().from(job).where(eq(job.id, stalled!.id)))[0]?.status === "PENDING", String(recovered));

  // ⑥ worker 轮询：先清空旧任务，注册成功/失败/未知处理器
  await db.delete(job);
  jobService.clearJobHandlers();
  jobService.registerJobHandler("test.ok", async () => {});
  jobService.registerJobHandler("test.boom", async () => { throw new Error("处理器失败"); });
  await jobService.enqueue({ kind: "test.ok" });
  await jobService.enqueue({ kind: "test.boom", maxAttempts: 2 });
  await jobService.enqueue({ kind: "test.unregistered" });
  const stats = await jobService.runJobWorkerOnce("worker-e2e", 10);
  ok("worker 一轮：成功 1 / 失败 2（含未知 kind）", stats.claimed === 3 && stats.succeeded === 1 && stats.failed === 1 && stats.unknown === 1, JSON.stringify(stats));
  const kinds = await db.select().from(job);
  ok("失败任务进入 PENDING（可重试）且未知 kind 记错误", kinds.some((j) => j.kind === "test.boom" && j.status === "PENDING" && (j.lastError ?? "").includes("处理器失败"))
    && kinds.some((j) => j.kind === "test.unregistered" && (j.lastError ?? "").includes("没有注册")), JSON.stringify(kinds.map((j) => ({ k: j.kind, s: j.status, e: j.lastError }))));

  // ⑦ 运维状态 HTTP 暴露任务计数
  const H = await login();
  const ops = await fetch(`${BASE}/api/v1/system/operations`, { headers: { cookie: H.cookie } });
  const opsBody = await ops.json() as { jobs?: Record<string, number>; schedulers?: { jobWorkerIntervalMs?: number } };
  ok("GET /system/operations 返回任务队列计数与 worker 间隔", ops.status === 200 && typeof opsBody.jobs?.PENDING === "number"
    && typeof opsBody.schedulers?.jobWorkerIntervalMs === "number", `${ops.status} ${JSON.stringify(opsBody).slice(0, 300)}`);

  // ⑧ 密码找回走队列（配置 SMTP 但 worker 不跑 → 只入队不发信）
  await putSettings({ "smtp.host": "smtp.invalid", "smtp.port": 2525, "smtp.from": "noreply@example.com" });
  const forgot = await fetch(`${BASE}/api/v1/auth/password/forgot`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: ADMIN }),
  });
  const forgotBody = await forgot.json() as { ok: boolean; enabled: boolean };
  const mailJobs = (await db.select().from(job)).filter((j) => j.kind === "email.send");
  ok("忘记密码入队 email.send（HTTP 200 且落库）", forgot.status === 200 && forgotBody.enabled === true
    && mailJobs.length === 1 && (mailJobs[0]!.payload as { to?: string }).to === "job-admin@x.test" && mailJobs[0]!.status === "PENDING",
    JSON.stringify(mailJobs.map((j) => ({ s: j.status, p: j.payload }))));
} finally {
  await app.close();
  await db.delete(job);
  await db.delete(setting).where(inArray(setting.key, ["smtp.host", "smtp.port", "smtp.from"]));
  await db.delete(auditEntry);
  for (const u of [ADMIN]) await deleteTestMember(u);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
