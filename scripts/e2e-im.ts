import "./_env.ts";   // 环境预设必须最先加载
/** IM 集成（Round 76）：配置加密/真实 webhook 发送/测试/通知扇出/类别过滤/权限 */
import { createServer } from "node:http";
import { useLocalOutboundMock } from "../tests/support/local-outbound.ts";
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();

import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, imChannel, job, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { notify } from "../src/server/services/notification.service.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "im-admin";
const GUEST = "im-guest";
const PW = "im-pass-123456";
const STAMP = Date.now().toString(36).slice(-5);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry); await db.delete(job);
await db.delete(imChannel);

// 本地模拟 IM webhook：记录请求体
const received: Record<string, unknown>[] = [];
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    try { received.push({ url: req.url, body: JSON.parse(raw) as Record<string, unknown> }); } catch { received.push({ url: req.url, body: raw }); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: 0, msg: "ok" }));
  });
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", () => resolve()));
const mockPort = (mock.address() as { port: number }).port;
const hookUrl = `https://1.1.1.1/hook/${STAMP}`;
const restoreFetch = useLocalOutboundMock("https://1.1.1.1", `http://127.0.0.1:${mockPort}`);

const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [mr] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER"));
const mk = async (username: string, name: string, roleId: string) => {
  const [row] = await db.insert(member).values({ username, email: `${username}@x.test`, name, status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: row!.id, roleId, scopeType: "ORG", scopeId: null });
  return row!.id;
};
const adminId = await mk(ADMIN, "IM 管理员", ar!.id);
await mk(GUEST, "IM 成员", mr!.id);
registerBuiltinJobHandlers();

const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async (username: string) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
let channelId: string;
try {
  const H = await login(ADMIN);
  const G = await login(GUEST);
  ok("非管理员读取 IM 配置 → 403", (await fetch(`${BASE}/api/v1/im/channels`, { headers: { cookie: G.cookie } })).status === 403);
  ok("非法 Webhook 地址 → 400", (await fetch(`${BASE}/api/v1/im/channels`, {
    method: "POST", headers: H, body: JSON.stringify({ provider: "FEISHU", name: `bad-${STAMP}`, webhookUrl: "ftp://x" }),
  })).status === 400);

  const created = await fetch(`${BASE}/api/v1/im/channels`, {
    method: "POST", headers: H,
    body: JSON.stringify({ provider: "FEISHU", name: `飞书群${STAMP}`, webhookUrl: hookUrl, events: ["MENTION", "ASSIGN"] }),
  });
  const createdBody = await created.json() as { channel: { id: string } };
  channelId = createdBody.channel.id;
  ok("创建 IM 渠道 201", created.status === 201);
  const listRaw = await (await fetch(`${BASE}/api/v1/im/channels`, { headers: { cookie: H.cookie } })).text();
  ok("列表不泄露 Webhook 明文/密钥", !listRaw.includes(hookUrl) && !listRaw.includes("appSecret") && listRaw.includes("hasWebhook"));
  ok("列表含类别与最近状态字段", listRaw.includes("MENTION") && listRaw.includes("lastTestOk"));

  const testRes = await fetch(`${BASE}/api/v1/im/channels/${channelId}/test`, { method: "POST", headers: H, body: JSON.stringify({}) });
  const testBody = await testRes.json() as { ok: boolean };
  ok("测试发送成功（真实 POST 到 webhook）", testRes.status === 200 && testBody.ok === true && received.length === 1);
  const firstBody = received[0]?.body as { msg_type?: string; content?: { text?: string } };
  ok("飞书协议消息体正确", firstBody.msg_type === "text" && String(firstBody.content?.text ?? "").includes("Feronavi IM 集成测试"), JSON.stringify(firstBody));

  // 通知扇出：MENTION 命中；ASSIGN 命中；TRANSITION 被类别过滤
  const title = `IM扇出${STAMP}`;
  await notify({ recipientId: adminId, actorId: adminId, category: "MENTION", type: "mention", title, body: "提及你", link: "/work-items/x" });
  await notify({ recipientId: adminId, actorId: adminId, category: "TRANSITION", type: "transition", title: `${title}-状态`, body: "状态变更", link: null });
  const jobs = await db.select().from(job).where(eq(job.kind, "im.send"));
  ok("通知扇出只按订阅类别入队（MENTION 1 条、TRANSITION 0 条）", jobs.length === 1, JSON.stringify(jobs.map((j) => j.payload)));
  const worker = await runJobWorkerOnce("im-e2e", 10);
  ok("im.send 任务执行成功", worker.succeeded >= 1 && received.length === 2, JSON.stringify(worker));
  const [chAfter] = await db.select().from(imChannel).where(eq(imChannel.id, channelId));
  ok("发送后记录 lastSendOk", chAfter?.lastSendOk === true);

  await fetch(`${BASE}/api/v1/im/channels/${channelId}`, { method: "PATCH", headers: H, body: JSON.stringify({ enabled: false }) });
  await notify({ recipientId: adminId, actorId: adminId, category: "MENTION", type: "mention", title: `${title}-停用`, body: "不应发送", link: null });
  const jobsAfterDisable = await db.select().from(job).where(eq(job.kind, "im.send"));
  ok("停用渠道后不再入队", jobsAfterDisable.length === 1, String(jobsAfterDisable.length));

  ok("删除渠道 200", (await fetch(`${BASE}/api/v1/im/channels/${channelId}`, { method: "DELETE", headers: { cookie: H.cookie, "x-csrf-token": H["x-csrf-token"] } })).status === 200);
} finally {
  restoreFetch();
  await app.close();
  mock.close();
  await db.delete(imChannel);
  await db.delete(job);
  await db.delete(auditEntry); await db.delete(activityEntry);
  for (const u of [ADMIN, GUEST]) await deleteTestMember(u);
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
