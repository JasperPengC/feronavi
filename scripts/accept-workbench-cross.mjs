import "./_env.ts";
/**
 * 工作台跨域关注界面验收（Round 68 对标 YouQu P2）——可重复执行、自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const DEFECT = `跨域验收缺陷 ${STAMP}`;
const MS = `跨域验收里程碑 ${STAMP}`;
const due = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().slice(0, 10); })();
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let defectId = null, msId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ pid, defect, ms, due }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const me = await (await fetch("/api/v1/auth/me")).json();
    const before = await (await fetch("/api/v1/workbench")).json();
    const d = await fetch(`/api/v1/projects/${pid}/work-items`, { method: "POST", headers, body: JSON.stringify({ type: "DEFECT", title: defect, severity: "S1", priority: "URGENT", assigneeId: me.memberId }) });
    const m = await fetch(`/api/v1/projects/${pid}/milestones`, { method: "POST", headers, body: JSON.stringify({ name: ms, dueDate: due }) });
    return { before: before.crossDomain, dStatus: d.status, mStatus: m.status, dBody: await d.json(), mBody: await m.json() };
  }, { pid, defect: DEFECT, ms: MS, due });
  defectId = prep.dBody?.id ?? null; msId = prep.mBody?.id ?? null;
  check("真实创建缺陷与临期里程碑", prep.dStatus === 201 && prep.mStatus === 201, JSON.stringify({ d: prep.dStatus, m: prep.mStatus }));

  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" });
  await page.getByText("跨域关注", { exact: true }).waitFor({ timeout: 15_000 });
  const body = await page.locator("main").innerText();
  check("跨域关注区含四张统计", ["我的未完成缺陷", "未完成缺陷", "未完成 S1", "临期 / 逾期里程碑"].every((x) => body.includes(x)));
  check("新建里程碑出现在列表", body.includes(MS));
  const after = await page.evaluate(async () => (await (await fetch("/api/v1/workbench")).json()).crossDomain);
  check("我的未完成缺陷 +1（真实增量）", after.myOpenDefects === prep.before.myOpenDefects + 1, JSON.stringify({ before: prep.before.myOpenDefects, after: after.myOpenDefects }));
  check("临期里程碑 +1（真实增量）", after.milestones.dueSoon === prep.before.milestones.dueSoon + 1, JSON.stringify({ before: prep.before.milestones, after: after.milestones }));
  check("里程碑链接指向真实详情路由", (await page.locator(`a[href*="/milestones/${msId}"]`).count()) === 1);
  const layout = await page.evaluate(() => {
    const footer = document.querySelector(".shell-footer")?.getBoundingClientRect();
    const sidebar = document.querySelector(".shell-sidebar")?.getBoundingClientRect();
    return { vh: innerHeight, footerBottom: footer ? Math.round(footer.bottom) : null, sidebarBottom: sidebar ? Math.round(sidebar.bottom) : null };
  });
  check("底部外壳留白 12–24px（Footer 不贴视口底边）", layout.footerBottom !== null && layout.vh - layout.footerBottom >= 12 && layout.vh - layout.footerBottom <= 24, JSON.stringify(layout));
  check("侧栏全高（Celeris 骨架：贴视口底边）", layout.sidebarBottom !== null && Math.abs(layout.vh - layout.sidebarBottom) <= 1, JSON.stringify(layout));
  await page.screenshot({ path: "/tmp/workbench-cross.png" });
} finally {
  try {
    if (defectId) {
      await sql`delete from activity_entry where target_id = ${defectId}`;
      await sql`delete from audit_entry where target_id = ${defectId}`;
      await sql`delete from work_item where id = ${defectId}`;
    }
    if (msId) {
      await sql`delete from activity_entry where target_id = ${msId}`;
      await sql`delete from milestone where id = ${msId}`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  工作台跨域验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
