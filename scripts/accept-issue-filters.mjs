import "./_env.ts";
/**
 * 问题追踪个人快捷筛选 + 排序 + 列验收（Round 81，对标 YouQu 列表）
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const A = `筛选甲${STAMP}`;
const B = `筛选乙${STAMP}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let ids = [];
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  ids = await page.evaluate(async ({ a, b }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const me = await (await fetch("/api/v1/auth/me")).json();
    const p = (await (await fetch("/api/v1/projects")).json()).items[0];
    const first = await (await fetch(`/api/v1/projects/${p.id}/work-items`, { method: "POST", headers, body: JSON.stringify({ type: "DEFECT", title: a, severity: "S1", assigneeId: me.memberId }) })).json();
    const second = await (await fetch(`/api/v1/projects/${p.id}/work-items`, { method: "POST", headers, body: JSON.stringify({ type: "DEFECT", title: b, severity: "S3" }) })).json();
    await fetch(`/api/v1/work-items/${second.id}/follow`, { method: "PUT", headers, body: JSON.stringify({ channels: ["IN_APP"] }) });
    return [first.id, second.id, me.memberId];
  }, { a: A, b: B });
  check("真实创建两条缺陷（一条指派 demo、一条关注）", ids.length === 3 && !!ids[0] && !!ids[1]);

  await page.goto(`${BASE}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByText("近 14 天缺陷趋势", { exact: true }).waitFor({ timeout: 15_000 });
  check("个人快捷筛选按钮齐全", (await page.getByRole("button", { name: "指派给我", exact: true }).count()) === 1
    && (await page.getByRole("button", { name: "我登记", exact: true }).count()) === 1
    && (await page.getByRole("button", { name: "我关注的", exact: true }).count()) === 1
    && (await page.getByRole("button", { name: "我协作的", exact: true }).count()) === 1);
  check("表格含类型与登记人列", (await page.locator("table thead").innerText()).includes("类型") && (await page.locator("table thead").innerText()).includes("登记人"));

  await page.getByRole("button", { name: "指派给我", exact: true }).click();
  await page.waitForTimeout(900);
  const assignedText = await page.locator("table tbody").innerText();
  check("指派给我筛选只显示我的缺陷", assignedText.includes("筛选甲") && !assignedText.includes("筛选乙"), assignedText.slice(0, 80));
  await page.getByRole("button", { name: "我关注的", exact: true }).click();
  await page.waitForTimeout(900);
  check("我关注的筛选命中关注项", (await page.locator("table tbody").innerText()).includes("筛选乙"));
  await page.getByRole("button", { name: "我登记", exact: true }).click();
  await page.waitForTimeout(900);
  check("我登记筛选命中本人登记", (await page.locator("table tbody").innerText()).includes("筛选甲") && (await page.locator("table tbody").innerText()).includes("筛选乙"));
  await page.getByRole("button", { name: "全部", exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.locator('[aria-label="排序"]').click();
  check("排序下拉含最新/最早/严重度/到期", (await page.getByRole("option", { name: "严重度", exact: true }).count()) === 1 && (await page.getByRole("option", { name: "到期日", exact: true }).count()) === 1);
  await page.getByRole("option", { name: "严重度", exact: true }).click();
  await page.waitForTimeout(800);
  check("按严重度排序后 S1 行在前", (await page.locator("table tbody tr").first().innerText()).includes("S1"), (await page.locator("table tbody tr").first().innerText()).slice(0, 60));
  await page.screenshot({ path: "/tmp/issue-filters.png" });
} finally {
  try {
    for (const id of [ids[0], ids[1]]) {
      if (!id) continue;
      await sql`delete from subscription where target_id = ${id}`;
      await sql`delete from audit_entry where target_id = ${id}`;
      await sql`delete from activity_entry where target_id = ${id}`;
      await sql`delete from work_item where id = ${id}`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  问题追踪快捷筛选验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
