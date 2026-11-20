import "./_env.ts";
/**
 * 项目模板界面验收（Round 25 长任务第 42 项）——可重复执行、自建自清。
 * 真实建模板 → 项目页「新建项目」选择模板 → 建出带初始集的项目。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `TP${stamp}`;
const TPL_NAME = `验收模板 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let templateId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const tpl = await page.evaluate(async (name) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    return await fetch("/api/v1/project-templates", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ name, payload: {
        milestones: [{ name: "启动会" }],
        iterations: [{ name: "第一迭代", startDate: "2026-11-01", endDate: "2026-11-14" }],
        workItems: [{ title: "需求梳理", type: "REQUIREMENT" }, { title: "环境准备", type: "TASK" }],
      } }),
    }).then((r) => r.json());
  }, TPL_NAME);
  templateId = tpl.id;
  check("真实创建模板", !!templateId);

  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "项目模板", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("option", { name: new RegExp(stamp) }).click();
  await page.getByLabel("标识").fill(KEY);
  await page.getByLabel("项目名称").fill(`模板建项目 ${stamp}`);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForTimeout(1800);
  const notice = await page.getByText(/已从模板创建：里程碑/).last().innerText().catch(() => "");
  check("创建后提示初始集数量（1 里程碑/1 迭代/2 工作项）",
    /已从模板创建/.test(notice) && /里程碑 1/.test(notice) && /迭代 1/.test(notice) && /工作项 2/.test(notice), notice);
  check("项目列表出现新项目", (await page.getByText(KEY).count()) > 0);
  const counts = await sql`select
    (select count(*)::int from milestone where project_id = (select id from project where key = ${KEY})) as m,
    (select count(*)::int from iteration where project_id = (select id from project where key = ${KEY})) as i,
    (select count(*)::int from work_item where project_id = (select id from project where key = ${KEY}) and deleted_at is null) as w`;
  check("真实库确有 1 里程碑 / 1 迭代 / 2 工作项", counts[0].m === 1 && counts[0].i === 1 && counts[0].w === 2, JSON.stringify(counts[0]));
  await page.screenshot({ path: "/tmp/project-templates.png" });
} finally {
  try {
    const rows = await sql`select id from project where key = ${KEY}`;
    for (const r of rows) {
      await sql`delete from work_item where project_id = ${r.id}`;
      await sql`delete from milestone where project_id = ${r.id}`;
      await sql`delete from iteration where project_id = ${r.id}`;
      await sql`delete from project where id = ${r.id}`;
    }
    if (templateId) await sql`delete from project_template where id = ${templateId}`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  项目模板界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
