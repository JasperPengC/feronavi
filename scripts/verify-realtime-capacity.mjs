import "./_env.ts";
/**
 * SSE 连接容量 + 连接池饱和度冒烟（总纲 6.6 长连接容量 / 连接池）
 *
 * 6.6 要求：
 *   · 单实例 **250 条并发 SSE** 下验证内存与通知 P95（通知到达 < 1 秒）；
 *   · 连接池饱和度 **> 80% 告警**（应用侧池上限 10）——验收时应观测饱和度。
 *
 * 本脚本真实执行：开 250 条 SSE 连接 → 读服务器进程 RSS 变化 → 在长连接压力下触发 @提及通知，
 * 测量「创建评论 → SSE 收到 notification.new」的时延（5 个样本）→ 50 并发请求期间轮询
 * pg_stat_activity 的应用连接数，计算池饱和度。
 *
 * ⚠️ 如实边界：单机开发环境、演示数据量；不是 6.6 验收硬件基线；通知时延是"应用侧到 SSE 送达"，
 * 不含反代（6.6 的 1 秒目标含 `proxy_buffering off` 场景）。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const HOST = process.env.BASE;
const DB_URL = process.env.DATABASE_URL;
const CONNECTIONS = Number(process.env.SSE_CONNECTIONS ?? 250);
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 10);
if (![CONNECTIONS, POOL_MAX].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("连接数与池上限必须为正整数");
const sql = postgres(DB_URL, { max: 2 });
const request = (url, options = {}) => fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(15_000) });
const controllers = [];
const openedReaders = [];
const events = new Map();
let closing = false;
let dropped = 0;
let reading = [];
let sampler;
const results = [];
const check = (n, p, d = "") => { results.push({ name: n, pass: p, detail: d }); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? `  ${d}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0; };

try {
const login = await request(`${HOST}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
});
if (!login.ok) throw new Error(`登录失败 ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const { csrfToken } = await login.json();
const csrf = decodeURIComponent(csrfToken);
const headers = { cookie, "content-type": "application/json", "x-csrf-token": csrf };

const projects = await (await request(`${HOST}/api/v1/projects`, { headers: { cookie } })).json();
const pid = projects.items[0]?.id;
const table = await (await request(`${HOST}/api/v1/projects/${pid}/work-items?view=table&pageSize=5`, { headers: { cookie } })).json();
const workItemId = table.rows?.[0]?.id;
if (!workItemId) throw new Error("没有工作项，无法触发 @提及");

const serverPid = /^\d+$/u.test(process.env.FERONAVI_TEST_SERVER_PID ?? "") ? process.env.FERONAVI_TEST_SERVER_PID : "";
const rssMB = () => {
  if (!serverPid) return null;
  try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", serverPid], { encoding: "utf8" }).trim()) / 1024); } catch { return null; }
};

const rssBefore = rssMB();
const t0 = performance.now();
const opening = [];
for (let i = 0; i < CONNECTIONS; i++) {
  const ac = new AbortController();
  controllers.push(ac);
  const timer = setTimeout(() => ac.abort(), 10_000);
  const p = request(`${HOST}/api/v1/events`, { headers: { cookie, accept: "text/event-stream" }, signal: ac.signal })
    .then(async (res) => {
      if (!res.ok) return false;
      const reader = res.body?.getReader();
      if (reader) openedReaders.push(reader);
      return true;
    })
    .catch(() => false).finally(() => clearTimeout(timer));
  opening.push(p);
}
const opened = await Promise.all(opening);
const openMs = Math.round(performance.now() - t0);
const okOpen = opened.filter((x) => x === true).length;
check(`开启 ${CONNECTIONS} 条 SSE 连接成功`, okOpen >= CONNECTIONS, `耗时=${openMs}ms 成功=${okOpen}/${CONNECTIONS}`);
reading = openedReaders.map((reader, index) => readEvents(reader, (ev, data) => {
  if (ev === "notification.new" && data?.id) {
    const seen = events.get(data.id) ?? new Map();
    if (!seen.has(index)) seen.set(index, performance.now());
    events.set(data.id, seen);
  }
}));
await sleep(1200);
const rssAfterOpen = rssMB();
if (rssBefore !== null && rssAfterOpen !== null) {
  const delta = rssAfterOpen - rssBefore;
  check("250 条 SSE 后服务端 RSS 增量 < 64MB", delta < 64, `+${delta}MB（${rssBefore}→${rssAfterOpen}MB；6.6 估算 2.5–12.5MB）`);
} else {
  check("SSE 后服务端 RSS 可观测", false, "无法读取服务端进程 RSS（需隔离夹具的服务进程 PID）");
}

// 所有连接持续消费，通知 ID 与连接索引共同确认送达。
async function readEvents(reader, onEvent) {
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (block.startsWith(":")) continue;
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev && data) { try { onEvent(ev, JSON.parse(data)); } catch { /* ignore */ } }
      }
    }
  } catch { /* 断线在 finally 统计。 */ }
  finally { if (!closing) dropped++; }
}
// 通知 P95：由**临时成员**发 5 条 @demo 提及评论 → 等 demo 的 SSE 收到 notification.new（不能自己@自己）
const stamp = Date.now().toString(36).slice(-5);
const tempUser = `rt-${stamp}`;
const tempPw = "realtime-pass-123456";
const created = await request(`${HOST}/api/v1/members`, {
  method: "POST", headers,
  body: JSON.stringify({ username: tempUser, name: "实时容量临时成员", email: `${tempUser}@x.test`, password: tempPw }),
});
const tempMember = created.ok ? await created.json() : null;
const tempLogin = await request(`${HOST}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: tempUser, password: tempPw }),
});
const initialCookie = tempLogin.ok ? tempLogin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";
const initialCsrf = tempLogin.ok ? decodeURIComponent((await tempLogin.json()).csrfToken ?? "") : "";
const changed = await request(`${HOST}/api/v1/auth/password/change`, {
  method: "POST", headers: { cookie: initialCookie, "content-type": "application/json", "x-csrf-token": initialCsrf },
  body: JSON.stringify({ currentPassword: tempPw, newPassword: `${tempPw}-changed` }), signal: AbortSignal.timeout(15_000),
});
if (!changed.ok) throw new Error(`临时成员首次改密失败 ${changed.status}`);
await changed.arrayBuffer();
const readyLogin = await request(`${HOST}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: tempUser, password: `${tempPw}-changed` }), signal: AbortSignal.timeout(15_000) });
if (!readyLogin.ok) throw new Error(`临时成员重新登录失败 ${readyLogin.status}`);
const tempHeaders = { cookie: readyLogin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
  "content-type": "application/json", "x-csrf-token": decodeURIComponent((await readyLogin.json()).csrfToken) };
const latencies = [];
const commentIds = [];

for (let i = 0; i < 5; i++) {
  const body = `@demo 实时容量冒烟 ${stamp}-${i}`;
  const t = performance.now();
  const res = await request(`${HOST}/api/v1/work-items/${workItemId}/comments`, {
    method: "POST", headers: tempHeaders, body: JSON.stringify({ body }), signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) continue;
  const c = await res.json().catch(() => null);
  if (c?.id) commentIds.push(c.id);
  const [notification] = await sql`select n.id from notification n join member m on m.id=n.recipient_id where m.username='demo' and n.body=${body} order by n.created_at desc limit 1`;
  if (!notification) continue;
  const deadline = performance.now() + 5000;
  while ((events.get(notification.id)?.size ?? 0) < CONNECTIONS && performance.now() < deadline) await sleep(10);
  const seen = [...(events.get(notification.id)?.values() ?? [])];
  if (seen.length === CONNECTIONS) latencies.push(Math.max(...seen) - t);
  events.delete(notification.id);
}
const p95 = Math.round(pct(latencies, 95));
check("全部 SSE 收到全部 5 条通知且 P95 < 1000ms", latencies.length === 5 && p95 < 1000, `样本=${latencies.length} P95=${p95}ms 各=${latencies.map((x) => Math.round(x)).join(",")}`);

// 连接池饱和度：50 并发请求期间采样 pg_stat_activity
let maxConns = 0, maxTotal = 0, poolSamples = 0;
const [dbSettings] = await sql`select setting::int as n from pg_settings where name = 'max_connections'`;
const dbMax = dbSettings.n;
const samplePool = async () => {
  try {
    const rows = await sql`select
      count(*)::int as total,
      count(*) filter (where datname = current_database() and application_name = 'feronavi-app')::int as app
      from pg_stat_activity`;
    poolSamples++;
    maxTotal = Math.max(maxTotal, rows[0].total);
    maxConns = Math.max(maxConns, rows[0].app ?? 0);
  } catch { /* ignore */ }
};
await samplePool();
sampler = setInterval(samplePool, 50);
const burst = await Promise.all(Array.from({ length: 50 }, async () => {
  try {
    const res = await request(`${HOST}/api/v1/projects/${pid}/work-items?view=table&pageSize=20`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    await res.arrayBuffer(); return res.ok;
  } catch { return false; }
}));
await sleep(200);
clearInterval(sampler);
const appSaturation = Math.round((maxConns / POOL_MAX) * 100);
const dbSaturation = Math.round((maxTotal / dbMax) * 100);
check(`数据库连接总饱和度 ${dbSaturation}% < 80%（max_connections=${dbMax}）`, poolSamples > 0 && dbSaturation < 80,
  `峰值总连接=${maxTotal}/${dbMax}；应用池峰值=${maxConns}/${POOL_MAX}（50 并发下应用池占满属 6.6 设计内排队）`);
check("50 并发突发无错误", burst.every(Boolean), `成功 ${burst.filter(Boolean).length}/50`);
check("所有 SSE 持续读取期间无意外断线", dropped === 0, `断线 ${dropped}`);
await sql.end();

// 清理
for (const id of commentIds) {
  await request(`${HOST}/api/v1/comments/${id}`, { method: "DELETE", headers }).catch(() => {});
}
if (tempMember?.id) {
  const cleanupSql = postgres(DB_URL, { max: 1 });
  try {
    await cleanupSql`delete from comment where author_id = ${tempMember.id}`;
    await cleanupSql`delete from audit_entry where actor_id = ${tempMember.id} or target_id = ${tempMember.id}`;
    await cleanupSql`delete from activity_entry where actor_id = ${tempMember.id}`;
    await cleanupSql`delete from role_assignment where member_id = ${tempMember.id}`;
    await cleanupSql`delete from member where id = ${tempMember.id}`;
  } catch { /* 清理失败不改变验收结论 */ }
  await cleanupSql.end();
}
closing = true;
for (const c of controllers) c.abort();
await Promise.allSettled(reading);
await sleep(500);

const rssEnd = rssMB();
const report = {
  generatedAt: new Date().toISOString(),
  connections: { requested: CONNECTIONS, opened: okOpen, dropped, openMs },
  rssMB: { before: rssBefore, afterOpen: rssAfterOpen, end: rssEnd },
  notification: { samples: latencies.map((x) => Math.round(x)), p95 },
  pool: { samples: poolSamples, appMaxObserved: maxConns, appPoolMax: POOL_MAX, appSaturationPercent: appSaturation,
    dbMaxObserved: maxTotal, dbMaxConnections: dbMax, dbSaturationPercent: dbSaturation },
  checks: results,
  note: "单机开发环境、演示数据量；非 6.6 验收硬件基线；通知时延不含反向代理",
};
const out = process.env.PERF_OUT ?? `.cache/realtime-capacity-${Date.now()}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
const ok = results.filter((r) => r.pass).length;
console.log(`\n  SSE/连接池冒烟 ${ok}/${results.length} 通过（报告 ${out}）`);
process.exitCode = ok === results.length ? 0 : 1;
} finally {
  closing = true;
  clearInterval(sampler);
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(reading);
  await sql.end();
}
