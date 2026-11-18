import "./_env.ts";
/**
 * 外部收集（Intake）活动的界面验收（Round 25 长任务第 32 项）——可重复执行、自建自清。
 * 真实建表单 → 匿名提交 → 转化 → 活动页「收集」筛选可见三类事件。
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
let formId = null, submissionIds = [], ideaId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const flow = await page.evaluate(async ({ pid, stamp }) => {
    const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const h = { "content-type": "application/json", "x-csrf-token": csrf() };
    const f = await fetch(`/api/v1/projects/${pid}/intake-forms`, { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify({ name: `验收收集表 ${stamp}`, schema: [{ key: "title", label: "标题", type: "TEXT", required: true }] }) }).then((r) => r.json());
    const submit = await fetch(`/api/v1/intake/${f.submitToken}/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `验收外部提交 ${stamp}` }) });
    const sub = await submit.json();
    const conv = await fetch(`/api/v1/intake-submissions/${sub.id}/convert`, { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": csrf() } }).then((r) => r.json());
    return { formId: f.form?.id, token: f.submitToken, submitStatus: submit.status, submissionId: sub.id, ideaId: conv.idea?.id };
  }, { pid, stamp });
  formId = flow.formId; submissionIds = [flow.submissionId]; ideaId = flow.ideaId;
  check("真实建表单 + 匿名提交 + 转化", !!formId && flow.submitStatus === 201 && !!flow.submissionId && !!ideaId, JSON.stringify(flow.submitStatus));

  await page.goto(`${BASE}/projects/${pid}/activity`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2400);
  await page.getByRole("button", { name: "收集", exact: true }).click();
  await page.waitForTimeout(1200);
  const summaries = await page.locator(".activity-summary").allTextContents();
  check("出现表单创建事件", summaries.some((s) => s.includes("创建了外部收集表单") && s.includes(stamp)), summaries.slice(0, 4).join(" | "));
  check("出现匿名提交事件（只报表单名）", summaries.some((s) => s.includes("收到一条外部提交") && s.includes("验收收集表")), summaries.slice(0, 4).join(" | "));
  check("出现转化事件", summaries.some((s) => s.includes("把外部提交转为想法")), summaries.slice(0, 4).join(" | "));
  await page.screenshot({ path: "/tmp/intake-activity.png" });
} finally {
  try {
    if (formId) {
      await sql`delete from activity_entry where target_id in (${formId}, ${submissionIds[0] ?? formId})`;
      await sql`delete from intake_submission where form_id = ${formId}`;
      await sql`delete from intake_form where id = ${formId}`;
    }
    if (ideaId) await sql`delete from idea where id = ${ideaId}`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  Intake 活动界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
