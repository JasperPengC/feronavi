import "./_env.ts";
/**
 * 任务队列界面/运行态验收（Round 25 长任务第 45 项）——可重复执行、自建自清。
 * ① 运行中的 worker 真的会取任务（立即任务被消费、失败记 last_error 并回 PENDING）；
 * ② 系统页「任务队列」计数来自真实聚合；③ 后台调度显示「任务处理」间隔。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  let consumed = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    consumed = (await sql`select status, attempts, last_error from job where id = ${immediateId}`)[0];
    if (consumed && consumed.attempts >= 1) break;
  }
  check("运行中的 worker 取到了立即任务（attempts≥1）", consumed?.attempts >= 1, JSON.stringify(consumed));
  check("处理器失败被记录为 last_error（不静默）", (consumed?.last_error ?? "").includes("缺少 to/subject"), consumed?.last_error ?? "");

  // 未来的任务用于展示「待处理」计数（worker 不会取）
  const fut = await sql`insert into job (kind, payload, run_at) values ('accept.demo', '{}'::jsonb, now() + interval '1 hour') returning id`;
  futureId = fut[0].id;

  await page.goto(`${BASE}/system`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  const body = await page.locator("body").innerText();
  check("系统页展示「任务队列」与待处理计数", body.includes("任务队列") && /待处理\s*\d+/.test(body), (body.match(/任务队列[^\n]*/) ?? [""])[0]);
  check("系统页后台调度含「任务处理」间隔", /任务处理\s*[0-9.]+s/.test(body), (body.match(/后台调度[^\n]*/) ?? [""])[0]);
  await page.screenshot({ path: "/tmp/job-queue.png" });
} finally {
  if (immediateId) await sql`delete from job where id = ${immediateId}`;
  if (futureId) await sql`delete from job where id = ${futureId}`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  任务队列验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
