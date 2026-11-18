import "./_env.ts";   // 环境预设必须最先加载
/**
 * Webhook 退避重试调度自检（Round 25 长任务第 24 项）
 *
 * 背景：retryDue() 与退避表早已实现，但**没有调度者** —— 失败投递永远停在 RETRYING。
 * 本套件验证调度器：到期记录被重试、成功后状态/尝试数/响应码正确、停止后不再投递、
 * 达到上限进死信、未到期记录不被提前投递。
 */
import { ensureInitialized, deleteTestMember } from "./_test-helpers.ts";
await ensureInitialized();
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, webhookDelivery, webhookEndpoint } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as wh from "../src/server/services/webhook.service.ts";
import { startWebhookRetryScheduler } from "../src/server/services/webhook-retry.ts";
import { eq } from "drizzle-orm";

const USER = "whsched-admin";
const PW = "whsched-pass-123456";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

await deleteTestMember(USER);
const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [adminRow] = await db.insert(member).values({
  username: USER, email: "whsched@x.test", name: "重试调度员", status: "ACTIVE",
  timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW),
}).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(adminRow!.id))!;
const created = await wh.createEndpoint(admin, { name: "重试调度端点", url: "https://example.com/hook", events: ["work_item.created"] });
const endpointId = created.endpoint.id;

const insertRetrying = async (attempts: number, nextRetryAt: Date | null) => {
  const [row] = await db.insert(webhookDelivery).values({
    endpointId, event: "work_item.created", payload: { n: attempts } as object,
    status: "RETRYING", attempts, responseCode: 500, error: "boom", nextRetryAt,
  }).returning({ id: webhookDelivery.id });
  return row!.id;
};
let fetchCalls = 0;
const fakeOk = (async () => { fetchCalls++; return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
const fakeFail = (async () => { fetchCalls++; throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;

try {
  // ① 到期记录被重试成功
  const dueId = await insertRetrying(1, new Date(Date.now() - 60_000));
  const h1 = startWebhookRetryScheduler({ intervalMs: 60, deps: { fetchImpl: fakeOk } });
  let row = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, dueId)))[0]!;
  for (let i = 0; i < 60 && row.status !== "SUCCEEDED"; i++) {
    await sleep(50);
    row = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, dueId)))[0]!;
  }
  ok("到期失败投递被调度重试并成功", row.status === "SUCCEEDED" && row.attempts === 2 && row.responseCode === 200 && row.nextRetryAt === null,
    JSON.stringify({ status: row.status, attempts: row.attempts, code: row.responseCode }));
  h1.stop();
  const callsAtStop = fetchCalls;
  await sleep(250);
  ok("停止调度后不再投递", fetchCalls === callsAtStop, `${callsAtStop} → ${fetchCalls}`);

  // ② 未到期记录不被提前投递
  const futureId = await insertRetrying(0, new Date(Date.now() + 3_600_000));
  const h2 = startWebhookRetryScheduler({ intervalMs: 60, deps: { fetchImpl: fakeOk } });
  await sleep(250);
  const future = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, futureId)))[0]!;
  ok("未到期记录不被提前重试", future.status === "RETRYING" && future.attempts === 0, JSON.stringify({ status: future.status, attempts: future.attempts }));
  h2.stop();

  // ③ 达到上限推进死信
  const lastId = await insertRetrying(wh.MAX_ATTEMPTS - 1, new Date(Date.now() - 60_000));
  const h3 = startWebhookRetryScheduler({ intervalMs: 60, deps: { fetchImpl: fakeFail } });
  let last = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, lastId)))[0]!;
  for (let i = 0; i < 60 && last.status !== "DEAD"; i++) {
    await sleep(50);
    last = (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, lastId)))[0]!;
  }
  ok("达到重试上限进入死信", last.status === "DEAD" && last.attempts === wh.MAX_ATTEMPTS && last.finishedAt !== null,
    JSON.stringify({ status: last.status, attempts: last.attempts }));
  h3.stop();
  ok("调度器确实发起了请求", fetchCalls >= 2, String(fetchCalls));
} finally {
  await db.delete(webhookDelivery).where(eq(webhookDelivery.endpointId, endpointId));
  await db.delete(webhookEndpoint).where(eq(webhookEndpoint.id, endpointId));
  await deleteTestMember(USER);
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
