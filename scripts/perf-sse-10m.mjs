import "./_env.ts";
/** 持续读取每条 SSE，并以落库通知 ID 核对所有连接的实际送达。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";

const HOST = process.env.BASE;
const DURATION_MS = Number(process.env.PERF_DURATION_MS ?? 600_000);
const CONNECTIONS = Number(process.env.SSE_CONNECTIONS ?? 250);
const INTERVAL_MS = Number(process.env.SSE_SEND_INTERVAL_MS ?? 20_000);
const OUT = process.env.PERF_OUT ?? `.cache/performance/sse-${Date.now()}.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (path, options = {}) => fetch(`${HOST}/api/v1${path}`, { ...options, signal: AbortSignal.timeout(15_000) });
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const controllers = [], readers = [], samples = [], deliveries = [];
const events = new Map();
let closing = false, opened = 0, openFailed = 0, dropped = 0, eventsSeen = 0;
let sampler, report;
const serverPid = /^\d+$/u.test(process.env.FERONAVI_TEST_SERVER_PID ?? "") ? process.env.FERONAVI_TEST_SERVER_PID : "";
const rssMB = () => {
  if (!serverPid) return null;
  try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", serverPid], { encoding: "utf8" }).trim()) / 1024); }
  catch { return null; }
};
const pct = (values, p) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p / 100) - 1] * 10) / 10 : null;
};
async function login(username, password) {
  const res = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const body = await res.json();
  return { cookie, "content-type": "application/json", "x-csrf-token": decodeURIComponent(body.csrfToken) };
}
async function readLoop(res, index) {
  const reader = res.body.getReader();
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
        if (/^event: notification.new$/m.test(block)) {
          const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "null");
          if (data?.id) {
            eventsSeen++;
            const seen = events.get(data.id) ?? new Map();
            if (!seen.has(index)) seen.set(index, performance.now());
            events.set(data.id, seen);
          }
        }
      }
    }
  } catch { /* 断线在 finally 计数；仅主动关闭不计入失败。 */ }
  finally { if (!closing) dropped++; reader.releaseLock(); }
}
try {
  if (![DURATION_MS, CONNECTIONS, INTERVAL_MS].every(value => Number.isSafeInteger(value) && value > 0) || DURATION_MS <= INTERVAL_MS) {
    throw new Error("时长、连接数与间隔必须为正整数，持续时间必须大于发送间隔");
  }
  const headers = await login("demo", "demo-password-12345");
  const issuesResponse = await request("/issues?pageSize=1", { headers });
  if (!issuesResponse.ok) throw new Error(`读取工作项失败 ${issuesResponse.status}`);
  const workItemId = (await issuesResponse.json()).items?.[0]?.id;
  if (!workItemId) throw new Error("没有可见问题项");
  const username = `sse-${Date.now().toString(36)}`;
  const password = "sse-perf-pass-123456";
  const created = await request("/members", { method: "POST", headers, body: JSON.stringify({ username, name: "SSE 验收成员", email: `${username}@example.test`, password }) });
  if (!created.ok) throw new Error(`创建成员失败 ${created.status}`);
  await created.arrayBuffer();
  const initialHeaders = await login(username, password);
  const changed = await request("/auth/password/change", { method: "POST", headers: initialHeaders,
    body: JSON.stringify({ currentPassword: password, newPassword: `${password}-changed` }) });
  if (!changed.ok) throw new Error(`首次改密失败 ${changed.status}`);
  await changed.arrayBuffer();
  const senderHeaders = await login(username, `${password}-changed`);
  const rssBefore = rssMB(), openStart = performance.now();
  for (let index = 0; index < CONNECTIONS; index++) {
    const controller = new AbortController(); controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${HOST}/api/v1/events`, { headers, signal: controller.signal });
      if (!res.ok || !res.body) { openFailed++; controller.abort(); }
      else { opened++; readers.push(readLoop(res, index)); }
    } catch { openFailed++; }
    finally { clearTimeout(timer); }
  }
  const openMs = Math.round(performance.now() - openStart), rssAfterOpen = rssMB();
  console.log(`打开 ${opened}/${CONNECTIONS} 条 SSE，持续 ${DURATION_MS / 1000}s`);
  const startAt = Date.now(), stopAt = startAt + DURATION_MS;
  const sample = async () => {
    const row = { elapsedMs: Date.now() - startAt, rssMB: rssMB(), pgConnections: null };
    try { const [db] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database()`; row.pgConnections = db.n; }
    catch { /* 空值保留观测缺失。 */ }
    samples.push(row);
  };
  await sample(); sampler = setInterval(sample, 10_000);
  let nextSend = startAt + INTERVAL_MS;
  while (nextSend < stopAt) {
    await sleep(Math.max(0, nextSend - Date.now()));
    nextSend += INTERVAL_MS;
    const marker = `SSE-${username}-${deliveries.length}`;
    const start = performance.now();
    const delivery = { status: 0, deliveredConnections: 0, firstMs: null, allMs: null };
    try {
      const res = await request(`/work-items/${workItemId}/comments`, { method: "POST", headers: senderHeaders, body: JSON.stringify({ body: `@demo ${marker}` }) });
      delivery.status = res.status; await res.arrayBuffer();
      if (res.ok) {
        const [notification] = await sql`select n.id from notification n join member m on m.id=n.recipient_id where m.username='demo' and n.body=${`@demo ${marker}`} order by n.created_at desc limit 1`;
        if (notification) {
          const deadline = performance.now() + 5000;
          while ((events.get(notification.id)?.size ?? 0) < CONNECTIONS && performance.now() < deadline) await sleep(10);
          const seen = [...(events.get(notification.id)?.values() ?? [])];
          delivery.deliveredConnections = seen.length;
          if (seen.length) delivery.firstMs = Math.min(...seen) - start;
          if (seen.length === CONNECTIONS) delivery.allMs = Math.max(...seen) - start;
          events.delete(notification.id);
        }
      }
    } catch { /* status=0 或缺失送达将使验收失败。 */ }
    deliveries.push(delivery);
    console.log(`通知 ${deliveries.length}: HTTP ${delivery.status}, 送达 ${delivery.deliveredConnections}/${CONNECTIONS}, 全部耗时 ${Math.round(delivery.allMs ?? -1)}ms`);
  }
  await sleep(Math.max(0, stopAt - Date.now()));
  clearInterval(sampler); await sample();
  const actualMs = Date.now() - startAt, rssEnd = rssMB();
  const latencies = deliveries.flatMap((x) => x.allMs === null ? [] : [x.allMs]);
  const rss = samples.flatMap((x) => x.rssMB === null ? [] : [x.rssMB]);
  report = {
    schemaVersion: 2, kind: "sse-sustained", startedAt: new Date(startAt).toISOString(), requestedDurationMs: DURATION_MS, actualDurationMs: actualMs,
    connections: { requested: CONNECTIONS, opened, openFailed, dropped, openMs },
    notifications: { sends: deliveries.length, deliveredToAll: latencies.length, eventsSeen, p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99), deliveries },
    resources: { rssBeforeMB: rssBefore, rssAfterOpenMB: rssAfterOpen, rssEndMB: rssEnd, rssMaxMB: rss.length ? Math.max(...rss) : null,
      pgConnMax: Math.max(...samples.map((x) => x.pgConnections ?? 0)), samples },
    checks: { durationCompleted: actualMs >= DURATION_MS, connectionsAllOpened: opened === CONNECTIONS && openFailed === 0,
      noUnexpectedDisconnect: dropped === 0, everyNotificationDeliveredToAll: deliveries.length > 0 && latencies.length === deliveries.length,
      notificationP95Under1s: latencies.length > 0 && pct(latencies, 95) < 1000 },
    note: `单机隔离环境；${CONNECTIONS} 条 SSE 持续读取 ${Math.round(actualMs / 1000)}s；时延为请求发起到最慢连接收到对应通知，不含反向代理。`,
  };
} finally {
  closing = true; clearInterval(sampler);
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(readers);
  await sql.end();
  if (report) {
    mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks, notifications: { sends: report.notifications.sends, p95: report.notifications.p95 }, report: OUT }));
    if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
  }
  // 隔离runner统一删除本轮数据库，包括成员、评论和通知。
}
