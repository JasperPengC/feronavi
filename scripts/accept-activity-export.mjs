import "./_env.ts";
/**
 * 项目活动日期筛选 + CSV 导出界面验收（Round 25 长任务第 22 项）——可重复执行、只读。
 * 前置：本地 3000 服务 + demo 管理员 + 演示项目 FINOK 已有活动记录。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import postgres from "postgres";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const pageTitle = `活动导出验收-${stamp}`;
const results = [];
let pageId = null;
const sql = postgres(DB, { max: 1 });
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light", acceptDownloads: true });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  // 真实动作产生一条活动（全量 e2e 清理会清空演示活动，验收必须自己造数据并自清）
  const created = await page.evaluate(async ({ p, title }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const r = await fetch(`/api/v1/projects/${p}/pages`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ title, content: "活动导出验收数据" }),
    });
    return { status: r.status, body: await r.json() };
  }, { p: pid, title: pageTitle });
  pageId = created.body?.id ?? created.body?.page?.id ?? null;
  check("真实接口创建文档（产生活动）", created.status === 201 && !!pageId, `${created.status} ${JSON.stringify(created.body?.id)}`);
  await page.goto(`${BASE}/projects/${pid}/activity`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  check("活动页有日期筛选与导出按钮",
    (await page.getByLabel("起始日期").count()) === 1 && (await page.getByLabel("结束日期").count()) === 1
    && (await page.getByRole("button", { name: "导出 CSV" }).count()) === 1);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("起始日期").fill(today);
  await page.waitForTimeout(1000);
  const rows = await page.locator(".activity-row").count();
  check("按起始日期筛选后仍有活动", rows > 0, String(rows));
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByRole("button", { name: "导出 CSV" }).click(),
  ]);
  const buf = readFileSync(await download.path());
  const text = buf.toString("utf8");
  check("下载文件名 activity-<项目>-YYYYMMDD.csv", /^activity-[0-9a-f]{8}-\d{8}\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
  check("CSV 带 BOM + 表头", buf[0] === 0xef && text.includes("time,action,actorId,targetType,targetId,summary"));
  check("导出内容为真实活动摘要", text.includes(pageTitle) && /创建了文档/.test(text), text.split("\r\n")[1]?.slice(0, 90));
  await page.screenshot({ path: "/tmp/activity-export.png" });
  check("清除日期按钮出现并可复位", (await page.getByRole("button", { name: "清除日期" }).count()) === 1);
  await page.getByRole("button", { name: "清除日期" }).click(); await page.waitForTimeout(500);
  check("日期已清空", (await page.getByLabel("起始日期").inputValue()) === "");
} finally {
  if (pageId) {
    await sql`delete from activity_entry where target_id = ${pageId}`;
    await sql`delete from page_revision where page_id = ${pageId}`;
    await sql`delete from page_permission where page_id = ${pageId}`;
    await sql`delete from page where id = ${pageId}`;
  }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  活动日期筛选/导出验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
