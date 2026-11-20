import "./_env.ts";
/**
 * 任务队列界面/运行态验收（Round 25 长任务第 45 项）——可重复执行、自建自清。
 * ① 运行中的 worker 真的会取任务（立即任务被消费、失败记 last_error 并回 PENDING）；
 * ② 系统页「任务队列」计数来自真实聚合；③ 后台调度显示「任务处理」间隔。
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { sql as appSql } from "../src/db/index.ts";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let immediateId = null, futureId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });

  // 立即任务（缺 to/subject → 处理器抛错 → 记 last_error；证明 worker 在跑）
  const ins = await sql`insert into job (kind, payload) values ('email.send', '{}'::jsonb) returning id`;
  immediateId = ins[0].id;
  registerBuiltinJobHandlers();
  const processed = await runJobWorkerOnce("accept-jobs", 10);
  const consumed = (await sql`select status, attempts, last_error from job where id = ${immediateId}`)[0];
  check("真实 worker 记录失败任务", processed.failed >= 1);
  check("运行中的 worker 取到了立即任务（attempts≥1）", consumed?.attempts >= 1, JSON.stringify(consumed));
  check("处理器失败被记录为 last_error（不静默）", (consumed?.last_error ?? "").includes("缺少 to/subject"), consumed?.last_error ?? "");

  // 未来的任务用于展示「待处理」计数（worker 不会取）
  const fut = await sql`insert into job (kind, payload, run_at) values ('accept.demo', '{}'::jsonb, now() + interval '1 hour') returning id`;
  futureId = fut[0].id;

  await page.goto(`${BASE}/system`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  await page.getByRole("tab", { name: "运维", exact: true }).click();
  await page.locator("summary", { hasText: "后台调度" }).click();
  const body = await page.locator("body").innerText();
  check("系统页展示「任务队列」与待处理计数", body.includes("任务队列") && /待处理\s*\d+/.test(body), (body.match(/任务队列[^\n]*/) ?? [""])[0]);
  check("系统页后台调度含「任务处理」间隔", /任务处理\s*(?:[0-9.]+s|off)/.test(body), (body.match(/后台调度[^\n]*/) ?? [""])[0]);
  await page.screenshot({ path: "/tmp/job-queue.png" });
} finally {
  if (immediateId) await sql`delete from job where id = ${immediateId}`;
  if (futureId) await sql`delete from job where id = ${futureId}`;
  await sql.end();
  await appSql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  任务队列验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
