import "./_env.ts";
/**
 * 兼容合规异步导出验收：真实会话入队、worker执行、浏览器下载并校验敏感掩码。
 * 当前系统页迁移入口为加密备份；完整备份UI另由accept-system-backup覆盖。
 */
import { chromium } from "playwright";
import { readFileSync, rmSync } from "node:fs";
import postgres from "postgres";
import { registerBuiltinJobHandlers } from "../src/server/services/job-handlers.ts";
import { runJobWorkerOnce } from "../src/server/services/job.service.ts";
import { sql as appSql } from "../src/db/index.ts";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const DATA_DIR = process.env.DATA_DIR ?? "/tmp/feronavi-data";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light", acceptDownloads: true });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let jobId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/system`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  await page.getByRole("tab", { name: "数据", exact: true }).click();
  await page.getByRole("heading", { name: "系统数据备份与恢复", exact: true }).waitFor();
  check("系统页迁移入口为当前加密备份UI", await page.getByRole("button", { name: "创建安全备份", exact: true }).count() === 1);
  const queued = await page.evaluate(async () => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "");
    const response = await fetch("/api/v1/system/exports", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: "{}" });
    return { status: response.status, body: await response.json() };
  });
  jobId = queued.body.id;
  check("兼容异步导出真实入队并返回PENDING", queued.status === 201 && !!jobId && queued.body.status === "PENDING");
  const pending = await page.request.get(`${BASE}/api/v1/system/exports/${jobId}`);
  check("未生成时下载端点明确返回生成中", pending.status() === 409 && (await pending.json()).details?.status === "PENDING");

  // 隔离夹具关闭定时器；消费本次真实入队任务，再检查页面轮询与下载。
  registerBuiltinJobHandlers();
  const processed = await runJobWorkerOnce("accept-async-export", 10);
  check("真实 worker 消费导出任务", processed.succeeded >= 1 && processed.failed === 0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(id => { window.location.href = `/api/v1/system/exports/${id}`; }, jobId),
  ]);
  check("worker完成后浏览器能真实下载兼容导出", !!download);
  const path = `/tmp/accept-async-export-${Date.now()}.json`;
  await download.saveAs(path);
  const body = JSON.parse(readFileSync(path, "utf8"));
  check("下载文件含 schemaVersion=1 / mode=async / 数据表", body.schemaVersion === "1" && body.mode === "async"
    && typeof body.totalRows === "number" && !!body.data, JSON.stringify({ sv: body.schemaVersion, mode: body.mode, rows: body.totalRows }));
  check("敏感掩码口径生效（member 无 password_hash，exported setting 存在）",
    !JSON.stringify(body.data.member ?? []).includes("password_hash") && Array.isArray(body.data.setting ?? body.data.setting));

  const jobs = await sql`select id, status from job where kind = 'export.full' order by created_at desc limit 1`;
  jobId = jobs[0]?.id ?? null;
  check("真实任务已 SUCCEEDED 且导出文件落盘", jobs[0]?.status === "SUCCEEDED"
    && (() => { try { readFileSync(`${DATA_DIR}/exports/${jobId}.json`); return true; } catch { return false; } })());
  rmSync(path, { force: true });
  await page.screenshot({ path: "/tmp/async-export.png" });
} finally {
  if (jobId) {
    try { rmSync(`${DATA_DIR}/exports/${jobId}.json`, { force: true }); } catch { /* 文件可能已被清理 */ }
    await sql`delete from job where id = ${jobId}`;
  }
  await sql.end();
  await appSql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  异步全量导出验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
