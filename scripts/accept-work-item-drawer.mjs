import "./_env.ts";
/**
 * 工作项详情抽屉验收（Round 25 长任务第 35 项）——可重复执行、自建自清。
 * 看板打开详情 → 描述/关联/评论三块可见；添加/移除关联（真实 API）；发评论后可见。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const pid = process.env.PROJECT_ID;
const stamp = Date.now().toString(36).slice(-5);
const IDEA_TITLE = `抽屉关联想法 ${stamp}`;
const COMMENT = `抽屉评论 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let ideaId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const idea = await page.evaluate(async ({ pid, title }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    return await fetch(`/api/v1/projects/${pid}/ideas`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ title, description: "抽屉验收" }) }).then((r) => r.json());
  }, { pid, title: IDEA_TITLE });
  ideaId = idea.id;
  check("真实创建关联目标想法", !!ideaId);

  await page.goto(`${BASE}/projects/${pid}/board`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000);
  const card = page.locator(".board-column-body .card").first();
  check("看板有工作项卡片", (await card.count()) === 1);
  await card.getByRole("button", { name: "详情" }).click();
  await page.waitForTimeout(1200);
  const drawer = page.locator(".wi-drawer");
  check("详情抽屉打开（基本信息/关联/评论）", (await drawer.count()) === 1
    && (await drawer.innerText()).includes("基本信息") && (await drawer.innerText()).includes("关联") && (await drawer.innerText()).includes("评论"));

  await page.getByLabel("关联类型").click(); await page.waitForTimeout(300);
  await page.getByRole("option", { name: "想法" }).click(); await page.waitForTimeout(800);
  await page.getByLabel("关联目标").click(); await page.waitForTimeout(700);
  await page.getByRole("option", { name: new RegExp(stamp) }).click();
  await page.getByRole("button", { name: "添加关联" }).click();
  await page.waitForTimeout(1200);
  check("添加关联后列表出现目标", (await page.locator(".wi-drawer__links").innerText()).includes(stamp), await page.locator(".wi-drawer__links").innerText().catch(() => ""));
  await page.locator(".wi-drawer__links li").first().getByRole("button", { name: "移除" }).click();
  await page.waitForTimeout(1000);
  check("移除关联后列表为空", (await page.locator(".wi-drawer__links").count()) === 0);

  await page.getByLabel(/写评论/).fill(COMMENT);
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForTimeout(1200);
  check("评论发布后可见", (await drawer.innerText()).includes(COMMENT));
  await page.screenshot({ path: "/tmp/work-item-drawer.png" });
} finally {
  try {
    if (ideaId) {
      await sql`delete from work_item_link where (source_type = 'IDEA' and source_id = ${ideaId}) or (target_type = 'IDEA' and target_id = ${ideaId})`;
      await sql`delete from comment where body like ${"%" + stamp + "%"}`;
      await sql`delete from idea where id = ${ideaId}`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  工作项详情抽屉验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
