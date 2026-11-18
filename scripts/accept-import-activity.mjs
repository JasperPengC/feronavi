import "./_env.ts";
/**
 * 导入活动的界面验收（Round 25 长任务第 31 项）——可重复执行、自建自清。
 * 真实 HTTP 导入（上传→映射→确认→回滚）→ 活动页「导入」筛选可见三类事件。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-5);
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let batchId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const flow = await page.evaluate(async ({ pid, stamp }) => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const csv = `外部ID,标题,类型\nACC-${stamp}-1,导入验收任务A,任务\nACC-${stamp}-2,导入验收任务B,任务\n`;
    const fd = new FormData();
    fd.append("file", new Blob([csv], { type: "text/csv" }), `验收导入-${stamp}.csv`);
    const up = await fetch(`/api/v1/projects/${pid}/imports`, { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf() }, body: fd });
    const upBody = await up.json();
    const id = upBody.batchId;
    const map = await fetch(`/api/v1/imports/${id}/mapping`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ fieldMap: { 标题: "title" }, externalIdColumn: "外部ID", defaultType: "TASK" }) });
    const conf = await fetch(`/api/v1/imports/${id}/confirm`, { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf() } });
    const confBody = await conf.json();
    const rb = await fetch(`/api/v1/imports/${id}/rollback`, { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf() } });
    return { status: up.status, batchId: id, mapStatus: map.status, confStatus: conf.status, created: confBody.created, rbStatus: rb.status };
  }, { pid, stamp });
  batchId = flow.batchId;
  check("真实导入链路（上传/映射/确认/回滚）", flow.status === 201 && flow.mapStatus === 200 && flow.confStatus === 200 && flow.created === 2 && flow.rbStatus === 200, JSON.stringify(flow));

  await page.goto(`${BASE}/projects/${pid}/activity`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.waitForTimeout(1200);
  const summaries = await page.locator(".activity-summary").allTextContents();
  check("活动页「导入」筛选出现批次创建事件", summaries.some((s) => s.includes("创建了导入批次") && s.includes("待确认")), summaries.slice(0, 3).join(" | "));
  check("出现确认导入事件（含真实数量 2 行）", summaries.some((s) => s.includes("确认导入了 2 行")), summaries.slice(0, 3).join(" | "));
  check("出现回滚事件（软删 2 个工作项）", summaries.some((s) => s.includes("回滚了导入批次") && s.includes("软删 2 个")), summaries.slice(0, 3).join(" | "));
  await page.screenshot({ path: "/tmp/import-activity.png" });
} finally {
  if (batchId) {
    for (const [label, fn] of [
      ["mapping", () => sql`delete from import_mapping where batch_id = ${batchId}`],
      ["batch", () => sql`delete from import_batch where id = ${batchId}`],
      ["activity", () => sql`delete from activity_entry where action like 'import.%' and target_id = ${batchId}`],
    ]) {
      try { await fn(); } catch (e) { console.error(`[cleanup] ${label}:`, e.message); }
    }
  }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  导入活动界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
