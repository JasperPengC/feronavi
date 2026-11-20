import "./_env.ts";
/**
 * 转派历史 + 关注者界面验收（Round 79）——真实浏览器，自建自清。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const pid = process.env.PROJECT_ID;
const DB = process.env.DATABASE_URL;
const STAMP = Date.now().toString(36).slice(-5);
const TITLE = `转派验收缺陷${STAMP}`;
const U = `tw${STAMP}`;
const NAME = `转派验收成员${STAMP}`;
const PW = "tw-accept-pass-123456";
const REASON = `交由 ${NAME} 跟进`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
let wiId = null, memberId = null;
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const prep = await page.evaluate(async ({ pid, title, u, name, pw }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const me = await (await fetch("/api/v1/auth/me")).json();
    const m = await (await fetch("/api/v1/members", { method: "POST", headers, body: JSON.stringify({ username: u, name, email: `${u}@x.test`, password: pw }) })).json();
    const wi = await (await fetch(`/api/v1/projects/${pid}/work-items`, { method: "POST", headers, body: JSON.stringify({ type: "DEFECT", title, severity: "S2", assigneeId: me.memberId }) })).json();
    return { memberId: m.id, wiId: wi.id, statuses: [m.id ? 201 : 0, wi.id ? 201 : 0] };
  }, { pid, title: TITLE, u: U, name: NAME, pw: PW });
  memberId = prep.memberId; wiId = prep.wiId;
  check("真实创建临时成员与缺陷工作项", !!memberId && !!wiId);

  await page.goto(`${BASE}/projects/${pid}/issues`, { waitUntil: "domcontentloaded" });
  await page.getByText("总登记", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByText(TITLE, { exact: true }).click();
  const drawer = page.locator(".ui-drawer");
  await drawer.locator("summary", { hasText: "协作与工时" }).click();
  await drawer.getByText("转派与关注", { exact: true }).waitFor({ timeout: 10_000 });
  check("工作项抽屉显示转派与关注区块", (await drawer.innerText()).includes("转派与关注"));

  // 关注 / 取消关注
  await drawer.getByRole("button", { name: "关注", exact: true }).click();
  await page.waitForTimeout(800);
  check("点击关注后变为已关注并出现在关注者列表", (await drawer.innerText()).includes("已关注") && (await drawer.innerText()).includes("测试管理员"));

  // 转派（选临时成员 + 原因）
  await drawer.locator('[aria-label="转派给"]').click();
  await page.getByRole("option", { name: new RegExp(NAME) }).click();
  await drawer.locator('[aria-label="转派原因"]').fill(REASON);
  await drawer.getByRole("button", { name: "转派", exact: true }).click();
  await page.waitForTimeout(1200);
  const drawerText = await drawer.innerText();
  check("转派后历史出现 from→to 与原因", drawerText.includes(`测试管理员 → ${NAME}`) && drawerText.includes(REASON), drawerText.slice(0, 200));
  const [tr] = await sql`select count(*)::int as n from work_item_transfer where work_item_id = ${wiId} and reason = ${REASON}`;
  check("转派历史真实入库", tr.n === 1);
  const [sub] = await sql`select count(*)::int as n from subscription where target_id = ${wiId} and member_id = (select id from member where username = 'demo')`;
  check("关注记录真实入库", sub.n === 1);
  await page.screenshot({ path: "/tmp/transfer-watchers.png" });
} finally {
  try {
    if (wiId) {
      await sql`delete from work_item_transfer where work_item_id = ${wiId}`;
      await sql`delete from subscription where target_id = ${wiId}`;
      await sql`delete from activity_entry where target_id = ${wiId}`;
      await sql`delete from audit_entry where target_id = ${wiId}`;
      await sql`delete from work_item where id = ${wiId}`;
    }
    if (memberId) {
      await sql`delete from audit_entry where actor_id = ${memberId} or target_id = ${memberId}`;
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    }
  } catch (e) { console.error("[cleanup]", e.message); }
  await sql.end(); await ctx.close(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  转派与关注验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
