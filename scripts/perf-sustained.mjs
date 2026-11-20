import "./_env.ts";
import { dirname } from "node:path";
/**
 * 容量爬坡 + 长时间内存观测（Round 86）
 *
 * PERF_MODE=ramp（默认）：600 秒内并发 8→24→40→56→72 逐级爬坡（每 120 秒升一档），
 *   逐档统计 RPS/P50/P95/P99/错误率 + RSS/CPU/PG 连接，定位饱和点；
 * PERF_MODE=soak：PERF_WORKERS 固定并发持续 PERF_DURATION_MS（默认 1200 秒 = 20 分钟），
 *   每 5 分钟窗口统计吞吐与延迟，RSS 线性斜率判断是否存在持续增长。
 *
 * 数据：压测项目 20,000 工作项；测试后清理。真实执行，不以短突发替代。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import postgres from "postgres";

const HOST = process.env.BASE;
const DB = process.env.DATABASE_URL;
const MODE = process.env.PERF_MODE ?? "ramp";
const DURATION_MS = Number(process.env.PERF_DURATION_MS ?? (MODE === "soak" ? 1_200_000 : 600_000));
const MAX_WORKERS = Number(process.env.PERF_WORKERS ?? (MODE === "soak" ? 16 : 72));
const RAMP = (process.env.PERF_RAMP ?? "8,24,40,56,72").split(",").map(Number);
const ITEMS = Number(process.env.PERF_ITEMS ?? 20_000);
if (!["ramp", "soak"].includes(MODE) || ![DURATION_MS, MAX_WORKERS, ITEMS, ...RAMP].every((value) => Number.isSafeInteger(value) && value > 0)
    || (MODE === "ramp" && MAX_WORKERS < Math.max(...RAMP))) {
  throw new Error("容量参数必须为正整数；模式必须是 ramp/soak；workers 不能小于最高爬坡并发");
}
const STAMP = Date.now().toString(36).slice(-6).toUpperCase();
const KEY = `PS${STAMP}`.slice(0, 10);
const OUT = process.env.PERF_OUT ?? `.cache/performance/${MODE}-${STAMP}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = postgres(DB, { max: 4 });
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });

const login = await request(`${HOST}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
});
if (!login.ok) { console.error("登录失败"); process.exit(2); }
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const { csrfToken } = await login.json();
const csrf = decodeURIComponent(csrfToken);
const authHeaders = { cookie, "x-csrf-token": csrf, "content-type": "application/json" };
const serverPid = /^\d+$/u.test(process.env.FERONAVI_TEST_SERVER_PID ?? "") ? process.env.FERONAVI_TEST_SERVER_PID : "";
const rssMB = () => { if (!serverPid) return null; try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", serverPid], { encoding: "utf8" }).trim()) / 1024); } catch { return null; } };
let lastCpuSeconds = null, lastCpuAt = null;
const parseCpuTime = (raw) => {
  const parts = raw.trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? null;
};
/** 进程 CPU%（按 cputime 增量/墙钟增量；多线程可 >100） */
const cpuPct = () => {
  if (!serverPid) return null;
  try {
    const raw = execFileSync("ps", ["-o", "cputime=", "-p", serverPid], { encoding: "utf8" }).trim();
    const secs = parseCpuTime(raw);
    const now = Date.now();
    let pct = null;
    if (secs !== null && lastCpuSeconds !== null && lastCpuAt !== null && now > lastCpuAt) {
      pct = Math.round(((secs - lastCpuSeconds) / ((now - lastCpuAt) / 1000)) * 1000) / 10;
    }
    lastCpuSeconds = secs; lastCpuAt = now;
    return pct;
  } catch { return null; }
};

let projectId = null;
let samples = [];
let phaseStats = [];
const requests = [];
let failedRequests = 0;
let activeWorkers = MODE === "soak" ? MAX_WORKERS : (RAMP[0] ?? 8);
let seedInfo;

async function setup() {
  const c = await request(`${HOST}/api/v1/projects`, { method: "POST", headers: authHeaders, body: JSON.stringify({ key: KEY, name: `容量测试项目 ${STAMP}`, description: "容量爬坡/长稳测试" }) });
  if (c.status !== 201) throw new Error(`建项目失败 ${c.status}`);
  projectId = (await c.json()).id;
  const [proj] = await sql`select id, key from project where id = ${projectId}`;
  const [taskWf] = await sql`select id from workflow where project_id = ${projectId} and applies_to_type = 'TASK' limit 1`;
  const [defectWf] = await sql`select id from workflow where project_id = ${projectId} and applies_to_type = 'DEFECT' limit 1`;
  const [ts] = await sql`select id from workflow_state where workflow_id = ${taskWf.id} and category = 'NOT_STARTED' limit 1`;
  const [ds] = await sql`select id from workflow_state where workflow_id = ${defectWf.id} and category = 'NOT_STARTED' limit 1`;
  const [rep] = await sql`select id from member where username = 'demo' limit 1`;
  const nTask = Math.floor(ITEMS * 0.8), nDefect = ITEMS - nTask;
  const t0 = Date.now();
  await sql.begin(async (tx) => {
    await tx`insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id, assignee_id, priority, severity, due_date, created_at, updated_at)
      select ${projectId}::uuid, g, ${proj.key} || '-' || g, 'TASK', '容量工作项 ' || g, ${taskWf.id}::uuid, ${ts.id}::uuid, ${rep.id}::uuid, ${rep.id}::uuid,
        (array['URGENT','HIGH','MEDIUM','LOW'])[1 + (g % 4)], null, current_date - (g % 30), now() - (g % 90) * interval '1 day', now()
      from generate_series(1, ${nTask}) g`;
    await tx`insert into work_item (project_id, number, key, type, title, workflow_id, status_id, reporter_id, assignee_id, priority, severity, due_date, created_at, updated_at)
      select ${projectId}::uuid, ${nTask} + g, ${proj.key} || '-' || (${nTask} + g), 'DEFECT', '容量缺陷 ' || g, ${defectWf.id}::uuid, ${ds.id}::uuid, ${rep.id}::uuid, ${rep.id}::uuid,
        (array['URGENT','HIGH','MEDIUM','LOW'])[1 + (g % 4)], (array['S1','S2','S3','S4'])[1 + (g % 4)],
        current_date - (g % 20), now() - (g % 90) * interval '1 day', now()
      from generate_series(1, ${nDefect}) g`;
    await tx`update project set next_issue_number = ${ITEMS + 1} where id = ${projectId}`;
  });
  await sql`analyze work_item`;
  const searchResponse = await request(`${HOST}/api/v1/search?q=${encodeURIComponent("容量")}&limit=20`, { headers: { cookie } });
  if (!searchResponse.ok || !(await searchResponse.json()).items?.some((item) => item.type === "work-item" && item.projectId === projectId)) {
    throw new Error("压测数据搜索未命中，拒绝把空结果记为成功");
  }
  const ids = (await sql`select id from work_item where project_id = ${projectId} order by number limit 2000`).map((r) => r.id);
  seedInfo = { projectId, items: ITEMS, task: nTask, defect: nDefect, seedMs: Date.now() - t0 };
  console.log(`  数据：${ITEMS} 项（${nTask} TASK / ${nDefect} DEFECT），种子 ${seedInfo.seedMs}ms；模式 ${MODE}`);
  return ids;
}

function record(phase, name, latency, ok, status, at) {
  requests.push({ phase, name, latency, ok, status, at });
  if (!ok) failedRequests++;
}
async function loop(idx, ids, stopAt, startAt) {
  while (Date.now() < stopAt) {
    if (MODE === "ramp" && idx >= activeWorkers) { await sleep(120); continue; }
    const r = Math.random();
    const id = ids[Math.floor(Math.random() * ids.length)];
    let name, url;
    if (r < 0.24) { name = "projects.list"; url = `${HOST}/api/v1/projects`; }
    else if (r < 0.44) { name = "workitems.table"; url = `${HOST}/api/v1/projects/${projectId}/work-items?view=table&pageSize=50&page=${1 + Math.floor(Math.random() * 20)}`; }
    else if (r < 0.58) { name = "workitems.board"; url = `${HOST}/api/v1/projects/${projectId}/work-items/board`; }
    else if (r < 0.74) { name = "workitems.detail"; url = `${HOST}/api/v1/work-items/${id}`; }
    else if (r < 0.82) { name = "issues.stats"; url = `${HOST}/api/v1/projects/${projectId}/issues/stats`; }
    else if (r < 0.91) { name = "search"; url = `${HOST}/api/v1/search?q=${encodeURIComponent("容量")}&limit=20`; }
    else if (r < 0.96) { name = "issues.global"; url = `${HOST}/api/v1/issues?pageSize=20`; }
    else { name = "notifications"; url = `${HOST}/api/v1/notifications`; }
    const phase = MODE === "ramp" ? Math.min(RAMP.length - 1, Math.floor((Date.now() - startAt) / (DURATION_MS / RAMP.length))) : Math.floor((Date.now() - startAt) / 300_000);
    const t = performance.now();
    let ok; let status = 0;
    try { const res = await request(url, { headers: { cookie } }); status = res.status; ok = res.ok; await res.arrayBuffer(); } catch { ok = false; }
    record(phase, name, performance.now() - t, ok, status, Date.now() - startAt);
    if (Math.random() < 0.06) {
      const wt = performance.now();
      let wok; let wstatus = 0;
      try {
        const res = await request(`${HOST}/api/v1/work-items/${ids[(idx * 97 + Math.floor(Math.random() * 900)) % ids.length]}/comments`, {
          method: "POST", headers: authHeaders, body: JSON.stringify({ body: `容量评论 ${STAMP}` }),
        });
        wstatus = res.status; wok = res.ok; await res.arrayBuffer();
      } catch { wok = false; }
      record(phase, "comments.create", performance.now() - wt, wok, wstatus, Date.now() - startAt);
    }
    await sleep(20 + Math.floor(Math.random() * 50));
  }
}

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] * 100) / 100;
};
const summarize = (rows) => {
  const by = new Map();
  for (const r of rows) { const a = by.get(r.name) ?? []; a.push(r); by.set(r.name, a); }
  return [...by.entries()].map(([name, arr]) => ({
    endpoint: name, count: arr.length, errors: arr.filter((x) => !x.ok).length,
    statuses: Object.fromEntries([...new Set(arr.map((x) => x.status))].map((status) => [status, arr.filter((x) => x.status === status).length])),
    p50: percentile(arr.filter((x) => x.ok).map((x) => x.latency), 50),
    p95: percentile(arr.filter((x) => x.ok).map((x) => x.latency), 95),
    p99: percentile(arr.filter((x) => x.ok).map((x) => x.latency), 99),
  })).sort((a, b) => b.count - a.count);
};

let report;
try {
  const ids = await setup();
  const go = async () => {
    const stopAt = Date.now() + DURATION_MS;
    const startAt = Date.now();
    let lastProgressAt = startAt;
    const sampler = setInterval(async () => {
      let pg = null;
      try { const [r] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database()`; pg = r?.n ?? null; } catch { /* ignore */ }
      samples.push({ at: new Date().toISOString(), elapsedMs: Date.now() - startAt, rssMB: rssMB(), cpuPct: cpuPct(), pgConnections: pg, activeWorkers: MODE === "ramp" ? RAMP[Math.min(RAMP.length - 1, Math.floor((Date.now() - startAt) / (DURATION_MS / RAMP.length)))] : MAX_WORKERS });
      if (Date.now() - lastProgressAt >= 60_000) {
        lastProgressAt = Date.now();
        const latest = samples.at(-1);
        console.log(`  进度 ${Math.floor(latest.elapsedMs / 1000)}s / ${DURATION_MS / 1000}s：请求 ${requests.length}，错误 ${failedRequests}，RSS ${latest.rssMB}MB，PG连接 ${pg}`);
      }
    }, 10_000);
    // 立即启动全部 MAX_WORKERS（按 activeWorkers 门控），再按时间升档
    const workers = Promise.all(Array.from({ length: MAX_WORKERS }, (_, i) => loop(i, ids, stopAt, startAt)));
    if (MODE === "ramp") {
      const seg = DURATION_MS / RAMP.length;
      for (let i = 0; i < RAMP.length; i++) {
        activeWorkers = RAMP[i];
        console.log(`  第 ${i + 1} 档：${activeWorkers} 并发（${Math.round(seg / 1000)}s）`);
        await sleep(Math.max(0, Math.min(seg, stopAt - Date.now())));
      }
    } else {
      console.log(`  固定 ${MAX_WORKERS} 并发，持续 ${Math.round(DURATION_MS / 1000)}s`);
    }
    await workers;
    clearInterval(sampler);
    const actualMs = Date.now() - startAt;
    const good = requests.filter((r) => r.ok).length;
    const phases = MODE === "ramp"
      ? RAMP.map((_, i) => ({ phase: i + 1, workers: RAMP[i], rows: requests.filter((r) => r.phase === i) }))
      : Array.from({ length: Math.ceil(DURATION_MS / 300_000) }, (_, i) => ({ phase: i + 1, workers: MAX_WORKERS, rows: requests.filter((r) => r.phase === i) }));
    phaseStats = phases.map((p) => {
      const dur = MODE === "ramp" ? DURATION_MS / RAMP.length : Math.min(300_000, Math.max(1, DURATION_MS - (p.phase - 1) * 300_000));
      const errors = p.rows.filter((r) => !r.ok).length;
      return { phase: p.phase, workers: p.workers, durationMs: dur, requests: p.rows.length, errors,
        rps: Math.round((p.rows.length / (dur / 1000)) * 100) / 100, endpoints: summarize(p.rows) };
    });
    const rss = samples.map((s) => s.rssMB).filter((x) => x !== null);
    const cpu = samples.map((s) => s.cpuPct).filter((x) => x !== null);
    // RSS 首末平均变化率（MB/min），并非回归拟合或泄漏结论。
    const rssSlopeMBPerMin = rss.length >= 2 && actualMs > 0 ? Math.round(((rss[rss.length - 1] - rss[0]) / (actualMs / 60000)) * 100) / 100 : null;
    report = {
      schemaVersion: 1, kind: `sustained-${MODE}`, startedAt: new Date(startAt).toISOString(), actualDurationMs: actualMs,
      environment: { host: HOST, cpus: os.cpus().length, totalMemMB: Math.round(os.totalmem() / 1048576), serverPid },
      seed: seedInfo, totals: { requests: requests.length, errors: requests.length - good, errorRate: requests.length ? Math.round(((requests.length - good) / requests.length) * 10000) / 100 : 0,
        rps: Math.round((requests.length / (actualMs / 1000)) * 100) / 100 },
      phases: phaseStats,
      resources: { rssStartMB: rss[0] ?? null, rssEndMB: rss[rss.length - 1] ?? null, rssMaxMB: rss.length ? Math.max(...rss) : null,
        rssSlopeMBPerMin, cpuAvg: cpu.length ? Math.round((cpu.reduce((a, b) => a + b, 0) / cpu.length) * 10) / 10 : null,
        cpuMax: cpu.length ? Math.max(...cpu) : null, pgConnMax: samples.map((s) => s.pgConnections).filter((x) => x !== null).reduce((a, b) => Math.max(a, b), 0),
        samples },
      requestedDurationMs: DURATION_MS,
      checks: { durationCompleted: actualMs >= DURATION_MS, requestsMade: requests.length > 0,
        errorRateUnderPointOnePercent: requests.length > 0 && (requests.length - good) / requests.length < 0.001 },
      note: `单机开发环境；${MODE} 实际持续 ${Math.round(actualMs / 1000)}s；延迟统计仅包含成功请求，失败单独计数。`,
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`\n  实测 ${Math.round(actualMs / 1000)}s / 请求 ${report.totals.requests} / 错误 ${report.totals.errors} / RPS ${report.totals.rps}`);
    for (const p of phaseStats) console.log(`  档${p.phase} ${String(p.workers).padStart(2)}并发 rps=${String(p.rps).padStart(7)} req=${String(p.requests).padStart(6)} err=${p.errors} P95(table)=${p.endpoints.find((e) => e.endpoint === "workitems.table")?.p95 ?? "-"}`);
    console.log(`  资源：RSS ${report.resources.rssStartMB}→${report.resources.rssEndMB}MB（max ${report.resources.rssMaxMB}，斜率 ${rssSlopeMBPerMin}MB/min）CPU avg ${report.resources.cpuAvg}% max ${report.resources.cpuMax}% PG max ${report.resources.pgConnMax}`);
    console.log(`  报告：${OUT}`);
    if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
  };
  await go();
} finally {
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
