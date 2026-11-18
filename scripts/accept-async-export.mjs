import "./_env.ts";
/**
 * 异步全量导出界面验收（Round 25 长任务第 46 项）——可重复执行、自建自清。
 * 系统页点「生成全量导出」→ 轮询到下载链接 → 真实下载并校验 schemaVersion/敏感掩码。
 */
import { chromium } from "playwright";
import { readFileSync, rmSync } from "node:fs";
import postgres from "postgres";
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
  check("系统页出现「全量数据导出」卡片", (await page.getByText("全量数据导出", { exact: true }).count()) === 1);
  await page.getByRole("button", { name: "生成全量导出" }).click();
  await page.waitForTimeout(500);
  check("点击后显示生成中状态", (await page.getByText(/导出包生成中/).count()) > 0);

  // worker 每 5s 轮询一次；等待链接出现（最多 25s）
  const link = page.getByRole("link", { name: "下载全量导出包" });
  await link.waitFor({ timeout: 25_000 });
  check("worker 完成生成后出现下载链接", (await link.count()) === 1);

  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
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
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  异步全量导出验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
