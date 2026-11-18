import "./_env.ts";
import { dirname } from "node:path";
/**
 * 真实 10 分钟持续混合负载测试（Round 84 · 用户第 4 条要求：不用短突发冒充）
 *
 * 真实执行：建压测项目 + 批量 2 万工作项 → 16 个并发 worker 持续 600 秒混合读/写
 * （项目列表、表格列表、看板、详情、缺陷统计、全局搜索、通知、跨项目问题、评论写入），
 * 每 5 秒采样服务端 RSS 与 PG 应用连接数；结束后输出逐接口 P50/P95/P99、错误率、RPS、资源曲线。
 *
 * ⚠️ 如实边界：单机开发环境（非 6.6 验收硬件），结论仅代表当前环境与 2 万工作项数据量；
 * 但**持续时间是真实 600 秒**，不是短突发替代。环境可覆盖：PERF_DURATION_MS（默认 600000）。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";

const HOST = process.env.BASE;
const DB = process.env.DATABASE_URL;
const DURATION_MS = Number(process.env.PERF_DURATION_MS ?? 600_000);
const WARMUP_MS = Number(process.env.PERF_WARMUP_MS ?? 15_000);
const WORKERS = Number(process.env.PERF_WORKERS ?? 16);
const ITEMS = Number(process.env.PERF_ITEMS ?? 20_000);
const STAMP = Date.now().toString(36).slice(-6).toUpperCase();
const KEY = `PF${STAMP}`.slice(0, 10);
const OUT = process.env.PERF_OUT ?? `.cache/performance/load-10m-${STAMP}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const sql = postgres(DB, { max: 4 });

const login = await fetch(`${HOST}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
});
if (!login.ok) { console.error("登录失败"); process.exit(2); }
let cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const { csrfToken } = await login.json();
const csrf = decodeURIComponent(csrfToken);
const authHeaders = { cookie, "x-csrf-token": csrf, "content-type": "application/json" };

let projectId = null;
let sampleTimer = null;
const samples = [];
const serverPid = /^\d+$/u.test(process.env.FERONAVI_TEST_SERVER_PID ?? "") ? process.env.FERONAVI_TEST_SERVER_PID : "";
const rssMB = () => {
  if (!serverPid) return null;
  try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", serverPid], { encoding: "utf8" }).trim()) / 1024); } catch { return null; }
};

async function setup() {
  const created = await fetch(`${HOST}/api/v1/projects`, { method: "POST", headers: authHeaders, body: JSON.stringify({ key: KEY, name: `压测项目 ${STAMP}`, description: "10 分钟持续负载测试专用项目" }) });
  if (created.status !== 201) throw new Error(`建项目失败 ${created.status}`);
  const createdBody = await created.json();
  projectId = createdBody.id ?? createdBody.project?.id ?? null;
  if (!projectId) { const list = await (await fetch(`${HOST}/api/v1/projects`, { headers: { cookie } })).json(); projectId = list.items?.find((p) => p.key === KEY)?.id ?? null; }
  if (!projectId) throw new Error("无法获得压测项目 id");

  const [proj] = await sql`select id, key from project where id = ${projectId}`;
  const [taskWf] = await sql`select id from workflow where project_id = ${projectId} and applies_to_type = 'TASK' limit 1`;
  const [defectWf] = await sql`select id from workflow where project_id = ${projectId} and applies_to_type = 'DEFECT' limit 1`;
  const [taskState] = taskWf ? await sql`select id from workflow_state where workflow_id = ${taskWf.id} and category = 'NOT_STARTED' limit 1` : [];
  const [defectState] = defectWf ? await sql`select id from workflow_state where workflow_id = ${defectWf.id} and category = 'NOT_STARTED' limit 1` : [];
  const [reporter] = await sql`select id from member where username = 'demo' limit 1`;
  if (!taskState || !defectState || !reporter) throw new Error("缺少 workflow/state/reporter");
  const nTask = Math.floor(ITEMS * 0.8);
  const nDefect = ITEMS - nTask;
  const t0 = Date.now();
  await sql.begin(async (tx) => {
    await tx`insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id, assignee_id, priority, severity, due_date, created_at, updated_at)
      select ${projectId}::uuid, g, ${proj.key} || '-' || g, 'TASK', '压测工作项 ' || g, ${taskWf.id}::uuid, ${taskState.id}::uuid, ${reporter.id}::uuid, ${reporter.id}::uuid,
        (array['URGENT','HIGH','MEDIUM','LOW'])[1 + (g % 4)], null,
        current_date - (g % 30), now() - (g % 90) * interval '1 day', now()
      from generate_series(1, ${nTask}) g`;
    await tx`insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id, assignee_id, priority, severity, due_date, created_at, updated_at)
      select ${projectId}::uuid, ${nTask} + g, ${proj.key} || '-' || (${nTask} + g), 'DEFECT', '压测缺陷 ' || g, ${defectWf.id}::uuid, ${defectState.id}::uuid, ${reporter.id}::uuid, ${reporter.id}::uuid,
        (array['URGENT','HIGH','MEDIUM','LOW'])[1 + (g % 4)], (array['S1','S2','S3','S4'])[1 + (g % 4)],
        current_date - (g % 20), now() - (g % 90) * interval '1 day', now()
      from generate_series(1, ${nDefect}) g`;
  });
  const seedMs = Date.now() - t0;
  const ids = (await sql`select id from work_item where project_id = ${projectId} order by number limit 2000`).map((r) => r.id);
  console.log(`  压测数据：${ITEMS} 工作项（TASK ${nTask} / DEFECT ${nDefect}），种子耗时 ${seedMs}ms`);
  return { ids, seedMs, nTask, nDefect };
}

const endpoints = [];
function record(name, latency, ok, status) {
  endpoints.push({ name, latency, ok, status });
}

async function oneLoop(workerIdx, stopAt, ids) {
  while (Date.now() < stopAt) {
    const r = Math.random();
    const id = ids[Math.floor(Math.random() * ids.length)];
    let name, url;
    if (r < 0.24) { name = "projects.list"; url = `${HOST}/api/v1/projects`; }
    else if (r < 0.44) { name = "workitems.table"; url = `${HOST}/api/v1/projects/${projectId}/work-items?view=table&pageSize=50&page=${1 + Math.floor(Math.random() * 20)}`; }
    else if (r < 0.58) { name = "workitems.board"; url = `${HOST}/api/v1/projects/${projectId}/work-items/board`; }
    else if (r < 0.74) { name = "workitems.detail"; url = `${HOST}/api/v1/work-items/${id}`; }
    else if (r < 0.82) { name = "issues.stats"; url = `${HOST}/api/v1/projects/${projectId}/issues/stats`; }
    else if (r < 0.91) { name = "search"; url = `${HOST}/api/v1/search?q=${encodeURIComponent("压测")}&limit=20`; }
    else if (r < 0.96) { name = "issues.global"; url = `${HOST}/api/v1/issues?pageSize=20`; }
    else { name = "notifications"; url = `${HOST}/api/v1/notifications`; }
    const t = performance.now();
    let ok; let status = 0;
    try {
      const res = await fetch(url, { headers: { cookie } });
      status = res.status; ok = res.ok; await res.arrayBuffer();
    } catch { ok = false; }
    record(name, performance.now() - t, ok, status);
    // 写入路径（约 6%）：创建评论，走真实 CSRF/权限/领域服务
    if (Math.random() < 0.06) {
      const wt = performance.now();
      let wok; let wstatus = 0;
      try {
        const res = await fetch(`${HOST}/api/v1/work-items/${ids[(workerIdx * 97 + Math.floor(Math.random() * 900)) % ids.length]}/comments`, {
          method: "POST", headers: authHeaders, body: JSON.stringify({ body: `压测评论 ${STAMP}` }),
        });
        wstatus = res.status; wok = res.status === 201 || res.ok; await res.arrayBuffer();
      } catch { wok = false; }
      record("comments.create", performance.now() - wt, wok, wstatus);
    }
    // 控制请求速率（约 20-40 req/s/worker 上限）
    await sleep(20 + Math.floor(Math.random() * 50));
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] * 10) / 10;
}

let report;
try {
  const setupInfo = await setup();
  const ids = setupInfo.ids;
  console.log(`  目标持续 ${Math.round(DURATION_MS / 1000)} 秒（预热 ${Math.round(WARMUP_MS / 1000)} 秒），${WORKERS} 并发 worker`);
  // 预热（不计入指标）
  const warmEnd = Date.now() + WARMUP_MS;
  await Promise.all(Array.from({ length: Math.min(4, WORKERS) }, (_, i) => oneLoop(i, warmEnd, ids)));
  endpoints.length = 0;
  samples.length = 0;
  sampleTimer = setInterval(async () => {
    try {
      const [row] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and application_name not like '%psql%'`;
      samples.push({ at: nowIso(), rssMB: rssMB(), pgConnections: row?.n ?? null });
    } catch { samples.push({ at: nowIso(), rssMB: rssMB(), pgConnections: null }); }
  }, 5000);
  const t0 = Date.now();
  const stopAt = t0 + DURATION_MS;
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => oneLoop(i, stopAt, ids)));
  const actualMs = Date.now() - t0;
  clearInterval(sampleTimer);
  sampleTimer = null;
  await sleep(300); // 收集最后采样
  const byName = new Map();
  for (const e of endpoints) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e); byName.set(e.name, arr);
  }
  const stats = [...byName.entries()].map(([name, rows]) => {
    const good = rows.filter((r) => r.ok).map((r) => r.latency);
    return {
      endpoint: name, count: rows.length, errors: rows.filter((r) => !r.ok).length,
      p50: percentile(good, 50), p95: percentile(good, 95), p99: percentile(good, 99),
      max: Math.round(Math.max(...good, 0) * 10) / 10,
      statuses: Object.fromEntries(Object.entries(rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {}))),
    };
  }).sort((a, b) => b.count - a.count);
  const total = endpoints.length;
  const errors = endpoints.filter((e) => !e.ok).length;
  const rss = samples.map((s) => s.rssMB).filter((x) => x !== null);
  const dbConns = samples.map((s) => s.pgConnections).filter((x) => x !== null);
  const budget = { "workitems.table": 500, "workitems.detail": 400, search: 800, "comments.create": 300, "workitems.board": 500 };
  const violations = stats.filter((s) => budget[s.endpoint] && s.p95 > budget[s.endpoint]).map((s) => `${s.endpoint} P95 ${s.p95} > ${budget[s.endpoint]}`);
  report = {
    schemaVersion: 1, kind: "load-10m", startedAt: new Date(t0).toISOString(), actualDurationMs: actualMs,
    requestedDurationMs: DURATION_MS, warmupMs: WARMUP_MS, workers: WORKERS,
    environment: { host: HOST, node: process.version, platform: process.platform, cpus: (await import("node:os")).cpus().length, totalMemMB: Math.round((await import("node:os")).totalmem() / 1048576), serverPid },
    seed: { projectId, ...setupInfo, itemCount: ITEMS },
    totals: { requests: total, errors, errorRate: total ? Math.round((errors / total) * 10000) / 100 : 0, rps: Math.round((total / (actualMs / 1000)) * 100) / 100 },
    resources: { rssStartMB: rss[0] ?? null, rssEndMB: rss[rss.length - 1] ?? null, rssMaxMB: rss.length ? Math.max(...rss) : null, pgConnMax: dbConns.length ? Math.max(...dbConns) : null, samples },
    endpoints: stats, budgetViolations: violations,
    note: "单机开发环境（非 6.6 验收硬件基线）；持续时间为真实 600 秒。",
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\n  实测 ${Math.round(actualMs / 1000)}s / 请求 ${total} / 错误 ${errors} / RPS ${report.totals.rps}`);
  for (const s of stats) console.log(`  ${s.endpoint.padEnd(18)} n=${String(s.count).padStart(5)} P50=${String(s.p50).padStart(6)} P95=${String(s.p95).padStart(6)} P99=${String(s.p99).padStart(6)} err=${s.errors}`);
  console.log(`  资源：RSS ${report.resources.rssStartMB}→${report.resources.rssEndMB}MB（max ${report.resources.rssMaxMB}）PG连接 max ${report.resources.pgConnMax}`);
  console.log(`  预算违规：${violations.length ? violations.join("; ") : "无"}`);
  console.log(`  报告：${OUT}`);
} finally {
  if (sampleTimer) clearInterval(sampleTimer);
  if (projectId) {
    try {
      await sql`delete from comment where target_id in (select id from work_item where project_id = ${projectId})`;
      await sql`delete from activity_entry where project_id = ${projectId}`;
      await sql`delete from audit_entry where target_id = ${projectId}`;
      await sql`delete from project where id = ${projectId}`;
      console.log("  压测项目已清理");
    } catch (e) { console.error("  清理失败：", e.message); }
  }
  await sql.end();
  if (report) writeFileSync(OUT, JSON.stringify(report, null, 2));
}
