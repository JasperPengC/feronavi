import "./_env.ts";
/** IM 自建应用消息（Round 88）：真实 HTTP 请求形态打到**本地 mock 厂商端点**，验证 token/发送/错误/权限 */
import { createServer } from "node:http";
import { useLocalOutboundMock } from "../tests/support/local-outbound.ts";
import { buildApp } from "../src/server/app.ts";
import { deleteTestMember, ensureInitialized } from "./_test-helpers.ts";
await ensureInitialized();
import { db, sql } from "../src/db/index.ts";
import { activityEntry, auditEntry, imChannel, job, member, role, roleAssignment } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { notify } from "../src/server/services/notification.service.ts";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const ADMIN = "ima-admin";
const PW = "ima-pass-123456";
const STAMP = Date.now().toString(36).slice(-5);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };
for (const u of [ADMIN]) await deleteTestMember(u);
await db.delete(auditEntry); await db.delete(activityEntry); await db.delete(job); await db.delete(imChannel);

const calls: { method: string; url: string; body: unknown; auth?: string }[] = [];
let failNextSend = false;
let hangNextSend = false;
let hungRequests = 0;
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method ?? "", url: req.url ?? "", body, auth: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    if ((req.url ?? "").startsWith("/gettoken")) return res.end(JSON.stringify({ errcode: 0, access_token: "mock-token", expires_in: 7200 }));
    if ((req.url ?? "").includes("asyncsend_v2")) {
      if (hangNextSend) { hungRequests++; return; }
      return res.end(JSON.stringify(failNextSend ? { errcode: 400, errmsg: "mock send rejected" } : { errcode: 0, task_id: 1 }));
    }
    res.end(JSON.stringify({ errcode: 0 }));
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", () => r()));
const mockPort = (mock.address() as { port: number }).port;
process.env.IM_DINGTALK_API_BASE = "https://1.1.1.1";
const restoreFetch = useLocalOutboundMock("https://1.1.1.1", `http://127.0.0.1:${mockPort}`);

const [ar] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [row] = await db.insert(member).values({ username: ADMIN, email: `${ADMIN}@x.test`, name: "IM 应用管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword(PW) }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: row!.id, roleId: ar!.id, scopeType: "ORG", scopeId: null });
registerBuiltinJobHandlers();
const app = await buildApp({ logger: false });
await app.listen({ port: Number(process.env.PORT ?? 3999), host: "127.0.0.1" });
const login = async () => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ADMIN, password: PW }) });
  const { csrfToken } = await r.json() as { csrfToken: string };
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token": decodeURIComponent(csrfToken), "content-type": "application/json" };
};
let channelId: string;
try {
  const H = await login();
  const created = await fetch(`${BASE}/api/v1/im/channels`, {
    method: "POST", headers: H,
    body: JSON.stringify({ provider: "DINGTALK", name: `钉钉应用${STAMP}`, appKey: "mock-ak", appSecret: "mock-secret", agentId: "1001", recipients: "u1,u2" }),
  });
  const createdBody = await created.json() as { channel: { id: string; hasRecipients: boolean; hasWebhook: boolean } };
  channelId = createdBody.channel.id;
  ok("创建钉钉应用渠道（无 Webhook，有接收人）", created.status === 201 && createdBody.channel.hasRecipients && !createdBody.channel.hasWebhook, JSON.stringify(createdBody.channel).slice(0, 120));

  const tested = await fetch(`${BASE}/api/v1/im/channels/${channelId}/test`, { method: "POST", headers: H, body: JSON.stringify({ text: "应用消息测试" }) });
  const testBody = await tested.json() as { ok: boolean };
  const tokenCall = calls.find((c) => c.url.startsWith("/gettoken"));
  const sendCall = calls.find((c) => c.url.includes("asyncsend_v2"));
  ok("测试发送成功（mock token + 工作通知）", tested.status === 200 && testBody.ok === true);
  ok("token 请求携带 appkey/appsecret", !!tokenCall?.url.includes("appkey=mock-ak") && tokenCall.url.includes("appsecret=mock-secret"));
  const sendBody = sendCall?.body as { agent_id?: number; userid_list?: string; msg?: { text?: { content?: string } } } | undefined;
  ok("工作通知请求体正确（agent_id/userid_list/text）", sendBody?.agent_id === 1001 && sendBody?.userid_list === "u1,u2"
    && sendBody?.msg?.text?.content?.includes("应用消息测试"), JSON.stringify(sendBody));
  const [ch] = await db.select().from(imChannel).where(eq(imChannel.id, channelId));
  ok("测试成功后落库 lastTestOk", ch?.lastTestOk === true);

  // 通知扇出 → job → worker → 应用消息
  calls.length = 0;
  const title = `IM应用扇出${STAMP}`;
  const [adminRow] = await db.select({ id: member.id }).from(member).where(eq(member.username, ADMIN));
  await notify({ recipientId: adminRow!.id, actorId: adminRow!.id, category: "MENTION", type: "mention", title, body: "提及你", link: null });
  const jobs = await db.select().from(job).where(eq(job.kind, "im.send"));
  ok("通知扇出入队 im.send", jobs.length === 1, String(jobs.length));
  const worker = await runJobWorkerOnce("ima-e2e", 10);
  ok("worker 执行应用消息发送成功", worker.succeeded >= 1 && calls.some((c) => c.url.includes("asyncsend_v2")), JSON.stringify(worker));
  const [after] = await db.select().from(imChannel).where(eq(imChannel.id, channelId));
  ok("发送后记录 lastSendOk", after?.lastSendOk === true);

  // 厂商错误码 → 测试失败并记录原始错误
  failNextSend = true; calls.length = 0;
  const failRes = await fetch(`${BASE}/api/v1/im/channels/${channelId}/test`, { method: "POST", headers: H, body: JSON.stringify({}) });
  const failBody = await failRes.json() as { ok: boolean; error?: string };
  const [afterFail] = await db.select().from(imChannel).where(eq(imChannel.id, channelId));
  ok("厂商错误码 → 测试失败且错误落库", failRes.status === 200 && failBody.ok === false && (failBody.error ?? "").includes("400") && afterFail?.lastTestOk === false, JSON.stringify(failBody));
  failNextSend = false;

  hangNextSend = true;
  const timeoutStart = Date.now();
  const timedOut = await fetch(`${BASE}/api/v1/im/channels/${channelId}/test`, { method: "POST", headers: H, body: JSON.stringify({}), signal: AbortSignal.timeout(15_000) });
  const timedOutBody = await timedOut.json() as { ok: boolean };
  hangNextSend = false;
  ok("本地 IM 接收端不响应时12秒内返回失败", hungRequests === 1 && timedOut.status === 200 && timedOutBody.ok === false && Date.now() - timeoutStart >= 7_000 && Date.now() - timeoutStart < 12_000, `elapsedMs=${Date.now() - timeoutStart}`);

  // 缺少接收人的应用渠道 → 测试明确 400
  await fetch(`${BASE}/api/v1/im/channels`, {
    method: "POST", headers: H,
    body: JSON.stringify({ provider: "DINGTALK", name: `钉钉无接收人${STAMP}`, appKey: "ak", appSecret: "as", agentId: "1001" }),
  });
  const noRecip = await db.select().from(imChannel).where(eq(imChannel.name, `钉钉无接收人${STAMP}`));
  const bad = await fetch(`${BASE}/api/v1/im/channels/${noRecip[0]!.id}/test`, { method: "POST", headers: H, body: JSON.stringify({}) });
  ok("应用配置缺接收人 → 400 明确拒绝", bad.status === 400, String(bad.status));
  await db.delete(imChannel).where(eq(imChannel.id, noRecip[0]!.id));
} finally {
  restoreFetch();
  await app.close();
  mock.closeAllConnections();
  mock.close();
  await db.delete(imChannel);
  await db.delete(job);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await deleteTestMember(ADMIN);
  delete process.env.IM_DINGTALK_API_BASE;
  await sql.end();
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
