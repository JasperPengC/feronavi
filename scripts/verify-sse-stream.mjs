import "./_env.ts";
/** 隔离 HTTP 回归：双账号通知隔离、超过 100 条快速消费，以及断开后的在线状态清理。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";

const BASE = process.env.BASE;
const OUT = process.env.PERF_OUT ?? `.cache/performance/sse-stream-${Date.now()}.json`;
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const streams = [];
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (path, options = {}) => fetch(`${BASE}/api/v1${path}`, { ...options, signal: AbortSignal.timeout(15_000) });
const check = (name, condition, detail) => {
  checks.push({ name, pass: Boolean(condition), detail });
  assert.ok(condition, name);
};
async function api(path, headers, body) {
  const response = await request(path, { headers, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function login(username, password) {
  const response = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.ok(response.ok, `登录失败: HTTP ${response.status}`);
  const body = await response.json();
  return { cookie: response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; "),
    "content-type": "application/json", "x-csrf-token": decodeURIComponent(body.csrfToken) };
}
async function until(predicate, message) {
  const deadline = performance.now() + 5_000;
  while (!(await predicate())) {
    assert.ok(performance.now() < deadline, message);
    await sleep(10);
  }
}
async function openStream(headers) {
  const controller = new AbortController();
  const stream = { controller, events: [], closing: false, ended: false, error: null, task: null };
  streams.push(stream);
  const timer = setTimeout(() => controller.abort(), 5_000);
  let response;
  try { response = await fetch(`${BASE}/api/v1/events`, { headers, signal: controller.signal }); }
  finally { clearTimeout(timer); }
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/u);
  const reader = response.body.getReader();
  stream.task = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          if (event) stream.events.push({ event, data: JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "null") });
        }
      }
    } catch (error) { if (!stream.closing) stream.error = error.message; }
    finally { stream.ended = true; reader.releaseLock(); }
  })();
  return stream;
}
async function closeStream(stream) {
  stream.closing = true;
  stream.controller.abort();
  await stream.task;
}
const has = (stream, event, id) => stream.events.some((item) => item.event === event && item.data?.id === id);

const startedAt = new Date().toISOString();
let notifications = 0;
try {
  const adminHeaders = await login("demo", "demo-password-12345");
  const workItemId = (await api("/issues?pageSize=1", adminHeaders)).items?.[0]?.id;
  assert.ok(workItemId, "缺少可评论的演示工作项");
  const username = `stream-${Date.now().toString(36)}`;
  const password = "sse-stream-pass-123456";
  const member = await api("/members", adminHeaders, { username, name: "SSE 隔离回归", email: `${username}@example.test`, password });
  const initialHeaders = await login(username, password);
  await api("/auth/password/change", initialHeaders, { currentPassword: password, newPassword: `${password}-changed` });
  const senderHeaders = await login(username, `${password}-changed`);
  const [adminMember] = await sql`select id from member where username='demo'`;
  const adminStream = await openStream(adminHeaders);
  const senderStream = await openStream(senderHeaders);

  async function mention(headers, recipient, receiver, excluded, index) {
    const body = `@${recipient} SSE stream ${username}-${index}`;
    const comment = await api(`/work-items/${workItemId}/comments`, headers, { body });
    const [notification] = await sql`select n.id from notification n join member m on m.id=n.recipient_id where m.username=${recipient} and n.body=${body} order by n.created_at desc limit 1`;
    assert.ok(notification, "评论必须实际生成收件人的通知");
    // 评论广播在通知之后发布；两条连接都收到它，便可以核对前面的通知是否被隔离。
    await until(() => has(receiver, "notification.new", notification.id)
      && has(receiver, "comment.created", comment.id) && has(excluded, "comment.created", comment.id), "通知或广播未按 ID 送达两个持续读取的连接");
    assert.equal(has(excluded, "notification.new", notification.id), false, "定向通知泄漏给其他成员");
    notifications++;
  }

  for (let index = 0; index < 120; index++) await mention(senderHeaders, "demo", adminStream, senderStream, index);
  await mention(adminHeaders, username, senderStream, adminStream, "reverse");
  check("双向定向通知只送达收件人", notifications === 121, { notifications });
  const broadcasts = [adminStream, senderStream].map((stream) => stream.events.filter((item) => item.event === "comment.created").length);
  check("两个快速消费者各收到超过 100 条真实广播", broadcasts.every((count) => count === 121), { broadcasts });
  check("持续消费无 dropped 或意外断线", [adminStream, senderStream].every((stream) => !stream.ended && !stream.error && !stream.events.some((item) => item.event === "dropped")));

  await closeStream(senderStream);
  await until(async () => !(await api("/presence", adminHeaders)).online.some((item) => item.memberId === member.id), "断开连接后成员仍残留在线");
  check("断开连接移除在线状态且其他连接仍正常", !adminStream.ended);
  const reconnected = await openStream(senderHeaders);
  await mention(senderHeaders, "demo", adminStream, reconnected, "reconnected");
  check("重连后继续正确传输与隔离", notifications === 122);
  await closeStream(reconnected);
  await closeStream(adminStream);
  await until(async () => !(await api("/presence", adminHeaders)).online.some((item) => [member.id, adminMember.id].includes(item.memberId)), "所有 SSE 关闭后仍有残留在线成员");
  check("所有连接关闭后在线状态清空", true);
} catch (error) {
  checks.push({ name: "专项执行无错误", pass: false, detail: error.message });
  process.exitCode = 1;
} finally {
  await Promise.allSettled(streams.map(closeStream));
  await sql.end();
  const report = { schemaVersion: 1, kind: "sse-stream-regression", startedAt, finishedAt: new Date().toISOString(), notifications, checks,
    note: "真实 HTTP 与独立数据库；慢消费者的缓冲边界由真实 Node Writable 专项覆盖。长期连接容量另由 600 秒 SSE 持续测试验收。" };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks, report: OUT }, null, 2));
}
