import "./_env.ts";
/**
 * 性能冒烟（总纲 6.6 性能预算 / 第7.1节"CI 至少一条性能冒烟"）
 *
 * ⚠️ 守恒纪律：阈值**全部来自 6.6 定稿表**，不另外发明指标：
 *   · 列表页（工作项/看板/表格）P95 < 500ms / P99 < 1.5s
 *   · 详情页 P95 < 400ms / P99 < 1.2s
 *   · 状态变更（看板拖拽）P95 < 300ms / P99 < 1s
 *   · 全局搜索（全文）P95 < 800ms / P99 < 2s
 *   · 首屏加载（局域网）< 2s
 *   · 并发写：≥ 50 并发不报错（本脚本用**50 并发短突发**替代 10 分钟压测，如实标注）
 *
 * 本机不是 6.6 的验收硬件基线（4 vCPU / 8GB 推荐档），因此结论定位为**回归冒烟**：
 * 超预算即失败，但通过只说明"本机在当前演示数据量下未退化"，不宣称满足生产基线。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import os from "node:os";

const HOST = process.env.BASE;
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 30);
const WARMUP = 3;

/** 6.6 目标（毫秒） */
const BUDGET = {
  list: { p95: 500, p99: 1500, label: "列表页（表格视图）" },
  board: { p95: 500, p99: 1500, label: "看板聚合" },
  detail: { p95: 400, p99: 1200, label: "详情页" },
  transition: { p95: 300, p99: 1000, label: "状态变更（流转）" },
  search: { p95: 800, p99: 2000, label: "全局搜索（全文）" },
  firstPaint: { p95: 2000, p99: 2000, label: "首屏加载（局域网）" },
};

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};
const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};
const round = (n) => Math.round(n * 10) / 10;

async function measure(fn, samples = SAMPLES) {
  const times = [];
  for (let i = 0; i < WARMUP; i++) await fn().catch(() => {});
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const ok = await fn().then(() => true).catch(() => false);
    if (!ok) { times.push(-1); continue; }
    times.push(performance.now() - t0);
  }
  const bad = times.filter((t) => t < 0).length;
  const good = times.filter((t) => t >= 0);
  return { p50: round(pct(good, 50)), p95: round(pct(good, 95)), p99: round(pct(good, 99)), errors: bad, n: samples };
}

const api = async (path, init = {}) => {
  const res = await fetch(`${HOST}${path}`, { headers: { cookie }, ...init });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res;
};
const json = async (path) => (await api(path)).json();

/** 登录（Cookie + CSRF） */
const login = await fetch(`${HOST}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "demo", password: "demo-password-12345" }),
});
if (!login.ok) { console.error("登录失败，性能冒烟无法进行"); process.exit(2); }
let cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const { csrfToken } = await login.json();
const csrf = decodeURIComponent(csrfToken);
const headers = { cookie, "x-csrf-token": csrf, "content-type": "application/json" };

const projects = await (await fetch(`${HOST}/api/v1/projects`, { headers: { cookie } })).json();
const projectId = projects.items[0]?.id;
if (!projectId) { console.error("没有项目，无法性能冒烟"); process.exit(2); }

console.log("  ▸ 环境:", JSON.stringify({
  platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length,
  memGB: Math.round(os.totalmem() / 1024 ** 3), node: process.version, host: HOST,
  note: "本机非 6.6 验收硬件基线：结论仅作回归冒烟",
}));

// ① 列表（表格视图）
const listRes = await measure(() => json(`/api/v1/projects/${projectId}/work-items?view=table&pageSize=20`));
check(`列表页 P95 ${listRes.p95}ms < ${BUDGET.list.p95}ms`, listRes.p95 < BUDGET.list.p95, `P99=${listRes.p99}ms 错误=${listRes.errors}/${listRes.n}`);
check(`列表页 P99 ${listRes.p99}ms < ${BUDGET.list.p99}ms`, listRes.p99 < BUDGET.list.p99);
check("列表页无错误", listRes.errors === 0);

// ② 看板
const boardRes = await measure(() => json(`/api/v1/projects/${projectId}/work-items/board`));
check(`看板 P95 ${boardRes.p95}ms < ${BUDGET.board.p95}ms`, boardRes.p95 < BUDGET.board.p95, `P99=${boardRes.p99}ms 错误=${boardRes.errors}/${boardRes.n}`);

// ③ 详情：**专用临时工作项**（不碰演示数据）
const stamp = Date.now().toString(36).slice(-6);
const createTemp = async (title) => {
  const res = await fetch(`${HOST}/api/v1/projects/${projectId}/work-items`, {
    method: "POST", headers, body: JSON.stringify({ type: "TASK", title }),
  });
  if (!res.ok) throw new Error(`创建临时工作项失败 ${res.status}`);
  return (await res.json()).id;
};
const deleteTemp = async (id) => {
  await fetch(`${HOST}/api/v1/work-items/${id}`, { method: "DELETE", headers }).catch(() => {});
};
let tempId = await createTemp(`性能冒烟临时工作项-${stamp}`);
const detailRes = await measure(() => json(`/api/v1/work-items/${tempId}`));
check(`详情 P95 ${detailRes.p95}ms < ${BUDGET.detail.p95}ms`, detailRes.p95 < BUDGET.detail.p95, `P99=${detailRes.p99}ms 错误=${detailRes.errors}/${detailRes.n}`);
check(`详情 P99 ${detailRes.p99}ms < ${BUDGET.detail.p99}ms`, detailRes.p99 < BUDGET.detail.p99);

// ④ 状态变更（真实流转）：每个样本用**新建临时工作项**，避免改坏演示数据/命中终态
const transitionTimes = [];
let transitionErr = 0;
for (let i = 0; i < 5; i++) {
  const id = await createTemp(`性能冒烟流转-${stamp}-${i}`);
  try {
    const cur = await json(`/api/v1/work-items/${id}`);
    const target = (cur.allowedTransitions ?? [])[0];
    const toStateKey = typeof target === "string" ? target : target?.toStateKey;
    if (!toStateKey) { transitionErr++; continue; }
    const t0 = performance.now();
    const res = await fetch(`${HOST}/api/v1/work-items/${id}/transition`, {
      method: "POST", headers, body: JSON.stringify({ toStateKey, version: cur.version }),
    });
    const dt = performance.now() - t0;
    if (!res.ok) transitionErr++; else transitionTimes.push(dt);
  } finally {
    await deleteTemp(id);
  }
}
const p95 = round(pct(transitionTimes, 95));
const p99 = round(pct(transitionTimes, 99));
check(`状态变更 P95 ${p95}ms < ${BUDGET.transition.p95}ms`, p95 < BUDGET.transition.p95, `样本=${transitionTimes.length} 错误=${transitionErr}`);
check(`状态变更 P99 ${p99}ms < ${BUDGET.transition.p99}ms`, p99 < BUDGET.transition.p99);
check("状态变更无错误", transitionErr === 0, `错误=${transitionErr}`);

// ⑤ 全局搜索
const searchRes = await measure(() => json(`/api/v1/search?q=${encodeURIComponent("导入")}`));
check(`搜索 P95 ${searchRes.p95}ms < ${BUDGET.search.p95}ms`, searchRes.p95 < BUDGET.search.p95, `P99=${searchRes.p99}ms 错误=${searchRes.errors}/${searchRes.n}`);
check(`搜索 P99 ${searchRes.p99}ms < ${BUDGET.search.p99}ms`, searchRes.p99 < BUDGET.search.p99);

// ⑥ 50 并发短突发（替代 10 分钟压测，如实标注）
const burstStart = performance.now();
const burst = await Promise.all(Array.from({ length: 50 }, async () => {
  try {
    const r = await fetch(`${HOST}/api/v1/projects/${projectId}/work-items?view=table&pageSize=20`, { headers: { cookie } });
    return r.ok ? 0 : 1;
  } catch { return 1; }
}));
const burstMs = round(performance.now() - burstStart);
const burstErrors = burst.reduce((a, b) => a + b, 0);
check("50 并发列表请求无错误", burstErrors === 0, `总耗时=${burstMs}ms，替代 10 分钟压测（如实标注）`);

// ⑦ 浏览器首屏（局域网目标 <2s）
const browser = await chromium.launch({ headless: true });
const firstPaintTimes = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(`${HOST}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const measurePage = async (path) => {
    await page.goto(`${HOST}${path}`, { waitUntil: "load" });
    return page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return nav ? nav.loadEventEnd - nav.startTime : 0;
    });
  };
  await measurePage("/projects"); // 预热
  for (let i = 0; i < 5; i++) firstPaintTimes.push(await measurePage("/projects"));
  for (let i = 0; i < 3; i++) firstPaintTimes.push(await measurePage(`/projects/${projectId}/board`));
  const fp95 = round(pct(firstPaintTimes, 95));
  check(`首屏加载 P95 ${fp95}ms < ${BUDGET.firstPaint.p95}ms`, fp95 < BUDGET.firstPaint.p95, `样本=${firstPaintTimes.length}`);
} finally {
  await browser.close();
}

// 清理专用临时工作项
await deleteTemp(tempId);

const summary = {
  generatedAt: new Date().toISOString(),
  environment: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1024 ** 3) },
  budgetSource: "项目总纲 6.6 性能预算（定稿）",
  samples: SAMPLES,
  results: { list: listRes, board: boardRes, detail: detailRes, search: searchRes,
    transition: { p95: round(pct(transitionTimes, 95)), p99: round(pct(transitionTimes, 99)), errors: transitionErr, n: transitionTimes.length },
    firstPaintMs: { p95: round(pct(firstPaintTimes, 95)), samples: firstPaintTimes.length } },
  checks: results,
};
const reportPath = process.env.PERF_REPORT_PATH ?? `.cache/performance-baseline-${Date.now()}.json`;
writeFileSync(reportPath, JSON.stringify(summary, null, 2));
const ok = results.filter((r) => r.pass).length;
console.log(`\n  性能冒烟 ${ok}/${results.length} 通过（报告 ${reportPath}；非基准硬件，仅回归）`);
process.exit(ok === results.length ? 0 : 1);
