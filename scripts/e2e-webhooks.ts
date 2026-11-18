import "./_env.ts";   // 环境预设必须最先加载（服务模块在导入时即读环境变量）
/** Webhook 出站自检（第十一期）：SSRF 防护、签名、死信队列、重放 */
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, project, webhookEndpoint, webhookDelivery, auditEntry, activityEntry, notification, subscription, timeLog, workItemCollaborator, workItemRelation, memberPreference } from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as wh from "../src/server/services/webhook.service.ts";
import * as urlSafety from "../src/server/lib/url-safety.ts";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { startLocalHttpResponder } from "../tests/support/local-outbound.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const U = "w11c-admin", G = "w11c-outsider";
const KEY = "W11CPROJ";
await db.delete(auditEntry); await db.delete(activityEntry);
for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN"));
const [a] = await db.insert(member).values({ username: U, email: "w11c@x.test", name: "集成管理员", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w11c-password-1234") }).returning({ id: member.id });
await db.insert(roleAssignment).values({ memberId: a!.id, roleId: adminRole!.id, scopeType: "ORG", scopeId: null });
const admin = (await loadActor(a!.id))!;
const [g] = await db.insert(member).values({ username: G, email: "w11cg@x.test", name: "无权者", status: "ACTIVE", timezone: "Asia/Shanghai", passwordHash: await hashPassword("w11c-password-1234") }).returning({ id: member.id });
const outsider = (await loadActor(g!.id))!;

await db.delete(project).where(eq(project.key, KEY));
const { id: pid } = await projectService.createProject(admin, { key: KEY, name: "W11C 集成项目" });
let transport: Awaited<ReturnType<typeof startLocalHttpResponder>> | undefined;

try {
  // ── SSRF 防护（纯函数级，不依赖网络）──
  const rejects = async (label: string, url: string, opts?: urlSafety.UrlCheckOptions) => {
    let hit = false, code = "";
    try { await urlSafety.assertSafeOutboundUrl(url, { skipDns: true, ...opts }); } catch (e) { hit = true; code = (e as { code?: string }).code ?? ""; }
    ok(label, hit && code === "VALIDATION", code);
  };
  await rejects("拒绝 http（默认）", "http://example.com/hook");
  await rejects("拒绝非 http(s) 协议", "ftp://example.com/hook");
  await rejects("拒绝回环地址", "http://127.0.0.1/hook");
  await rejects("拒绝 10/8 私网", "https://10.1.2.3/hook");
  await rejects("拒绝 172.16/12 私网", "https://172.20.0.5/hook");
  await rejects("拒绝 192.168/16 私网", "https://192.168.1.10/hook");
  await rejects("拒绝 link-local", "https://169.254.1.1/hook");
  await rejects("拒绝云元数据地址", "https://169.254.169.254/latest/meta-data/");
  await rejects("拒绝 IPv6 回环", "https://[::1]/hook");
  await rejects("拒绝 ULA 地址", "https://[fd00::1]/hook");
  ok("允许公网 https 且返回解析地址", (await urlSafety.assertSafeOutboundUrl("https://example.com/hook")).addresses.length > 0);
  ok("显式允许 http 时可通过（自托管开关）",
    (await urlSafety.assertSafeOutboundUrl("http://example.com/hook", { allowHttp: true, skipDns: true })).url.protocol === "http:");
  ok("isBlockedAddress 判定与规范一致",
    urlSafety.isBlockedAddress("100.64.0.1") && urlSafety.isBlockedAddress("224.0.0.1") && !urlSafety.isBlockedAddress("1.1.1.1"));

  // ── 端点 CRUD ──
  const created = await wh.createEndpoint(admin, { name: "示例端点", url: "https://example.com/hook", events: ["work_item.created"], projectId: pid });
  ok("建端点返回明文签名密钥（whsec_ 前缀）", created.secret.startsWith("whsec_"));
  const row = (await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, created.endpoint.id)).limit(1))[0]!;
  ok("密钥加密入库（enc:v1: 前缀）、查不到明文", row.secretEncrypted.startsWith("enc:v1:") && !row.secretEncrypted.includes(created.secret));
  ok("列表不泄露密钥", !JSON.stringify(await wh.listEndpoints(admin, pid)).includes(row.secretEncrypted));
  let badEvent = false;
  try { await wh.createEndpoint(admin, { name: "x", url: "https://example.com/h", events: ["nope"] }); } catch (e) { badEvent = (e as { code?: string }).code === "VALIDATION"; }
  ok("非法事件名 → VALIDATION", badEvent);
  let emptyEvents = false;
  try { await wh.createEndpoint(admin, { name: "x", url: "https://example.com/h", events: [] }); } catch (e) { emptyEvents = (e as { code?: string }).code === "VALIDATION"; }
  ok("空事件列表 → VALIDATION", emptyEvents);
  let ssrfBlocked = false;
  try { await wh.createEndpoint(admin, { name: "x", url: "https://169.254.169.254/steal", events: ["work_item.created"] }); } catch (e) { ssrfBlocked = (e as { code?: string }).code === "VALIDATION"; }
  ok("建端点时被 SSRF 拦截", ssrfBlocked);
  let denied = false;
  try { await wh.listEndpoints(outsider, pid); } catch { denied = true; }
  ok("无 integration:manage 者看不到端点", denied);

  // ── 本地 TCP/HTTP 接收端校验真实传输字节，不连接厂商 ──
  let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
  let deliveryStatus = 200;
  const receiver: typeof fetch = async (input, init) => {
    seen = {
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: String(init?.body ?? ""),
    };
    if (deliveryStatus === 0) return new Promise<Response>(() => {});
    return new Response(deliveryStatus === 200 ? "ok" : "rejected", { status: deliveryStatus });
  };
  transport = await startLocalHttpResponder("https://example.com", receiver);
  const fakeOk: typeof fetch = (input, init) => { deliveryStatus = 200; return transport!.fetchImpl(input, init); };
  const r1 = await wh.deliver("work_item.created", { id: "wi1" }, pid, { fetchImpl: fakeOk, now: () => 1700000000000 });
  ok("订阅端点数正确（全局端点也会收到）", r1.endpoints >= 1, String(r1.endpoints));
  ok("投递成功", r1.results[0]?.ok === true, JSON.stringify(r1.results[0]));
  ok("请求带事件与投递 ID 头", seen!.headers["x-feronavi-event"] === "work_item.created" && !!seen!.headers["x-feronavi-delivery"]);
  // 签名可被接收端用同一密钥验证（这是接收方唯一的信任依据）
  const ts = seen!.headers["x-feronavi-timestamp"]!;
  const expect = `sha256=${createHmac("sha256", created.secret).update(`${ts}.${seen!.body}`).digest("hex")}`;
  ok("HMAC 签名可被接收端验证", seen!.headers["x-feronavi-signature"] === expect, seen!.headers["x-feronavi-signature"]?.slice(0, 20));
  ok("签名内容含时间戳（防重放）", expect !== `sha256=${createHmac("sha256", created.secret).update(seen!.body).digest("hex")}`);

  // ── 未订阅的事件不投递 ──
  const before = (await wh.listDeliveries(admin, created.endpoint.id)).length;
  await wh.deliver("idea.created", { id: "i1" }, pid, { fetchImpl: fakeOk });
  ok("未订阅的事件不产生投递", (await wh.listDeliveries(admin, created.endpoint.id)).length === before);

  // ── 失败进死信队列 + 退避 + 上限 ──
  const fakeFail: typeof fetch = (input, init) => { deliveryStatus = 500; return transport!.fetchImpl(input, init); };
  const d = await wh.deliver("work_item.created", { id: "wi2" }, pid, { fetchImpl: fakeFail });
  const dId = (await wh.listDeliveries(admin, created.endpoint.id))[0]!.id;
  ok("失败首投：状态 RETRYING、记录了响应码", d.results[0]?.ok === false, JSON.stringify(d.results[0]).slice(0, 80));
  for (let i = 0; i < wh.MAX_ATTEMPTS; i++) await wh.attemptDelivery(dId, { fetchImpl: fakeFail });
  const deadRow = (await wh.listDeliveries(admin, created.endpoint.id)).find((x) => x.id === dId)!;
  ok(`达到上限 ${wh.MAX_ATTEMPTS} 次后进死信（DEAD）`, deadRow.status === "DEAD" && deadRow.attempts >= wh.MAX_ATTEMPTS, `${deadRow.status}/${deadRow.attempts}`);
  ok("死信不再安排重试", deadRow.nextRetryAt === null);

  // ── 人工重放（死信队列唯一出口）──
  const replay = await wh.replayDelivery(admin, dId, { fetchImpl: fakeOk });
  ok("重放成功后状态回到 SUCCEEDED", replay.ok === true && (await wh.listDeliveries(admin, created.endpoint.id)).find((x) => x.id === dId)!.status === "SUCCEEDED");

  // ── 停用端点后不再投递 ──
  await wh.updateEndpoint(admin, created.endpoint.id, { isActive: false });
  const off = await wh.deliver("work_item.created", { id: "wi3" }, pid, { fetchImpl: fakeOk });
  ok("停用端点后不再投递", off.endpoints === 0);
  await wh.updateEndpoint(admin, created.endpoint.id, { isActive: true });

  // ── 到期重试扫描 ──
  const fakeFail2: typeof fetch = (input, init) => { deliveryStatus = 503; return transport!.fetchImpl(input, init); };
  await wh.deliver("work_item.created", { id: "wi4" }, pid, { fetchImpl: fakeFail2 });
  await sql`update webhook_delivery set next_retry_at = now() - interval '1 minute' where status = 'RETRYING'`;
  const due = await wh.retryDue(20, { fetchImpl: fakeFail2 });
  ok("到期重试扫描能取到 RETRYING 记录", due.length >= 1, String(due.length));
  deliveryStatus = 0;
  const timeoutStart = Date.now();
  const timedOut = await wh.deliver("work_item.created", { id: "wi-timeout" }, pid, { fetchImpl: transport.fetchImpl });
  const timeoutRow = (await wh.listDeliveries(admin, created.endpoint.id)).find(row => (row.payload as { id?: string }).id === "wi-timeout");
  ok("本地 Webhook 无响应在20秒内进入重试", timedOut.results[0]?.ok === false && timeoutRow?.status === "RETRYING" && timeoutRow.nextRetryAt !== null && Date.now() - timeoutStart >= 14_000 && Date.now() - timeoutStart < 20_000, `elapsedMs=${Date.now() - timeoutStart}`);
  ok("成功/失败/重放经过本地真实 HTTP 传输", transport.requests >= 6);
} catch (e) {
  fail++; console.log(`  FAIL 链路异常: ${(e as Error).message}\n${(e as Error).stack?.split("\n")[1] ?? ""}`);
} finally {
  await transport?.close();
  await db.delete(webhookDelivery);
  await db.delete(webhookEndpoint);
  await db.delete(auditEntry); await db.delete(activityEntry);
  await db.delete(notification); await db.delete(subscription);
  await db.delete(timeLog); await db.delete(workItemCollaborator); await db.delete(workItemRelation);
  await db.delete(memberPreference);
  await db.delete(project).where(eq(project.key, KEY));
  for (const u of [U, G]) await db.delete(member).where(eq(member.username, u));
  await sql.end();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
