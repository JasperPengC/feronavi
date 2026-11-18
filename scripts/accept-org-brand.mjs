import "./_env.ts";
/**
 * 组织名称消费端验收（Round 25 长任务第 52 项）——可重复执行、自愈恢复原名。
 * 改名后：登录页显示「登录到 组织名」、侧栏工作区显示组织名、页脚与浏览器标题同步。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const TEMP = `品牌验收 ${stamp}`;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const [orig] = await sql`select name from organization limit 1`;
const browser = await chromium.launch({ channel: "chrome" });
const results2 = [];
try {
  // 用管理员会话真实 PATCH 组织名（而非直接改库）
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
  await ctxA.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
  const pageA = await ctxA.newPage();
  await pageA.goto(`${BASE}/login`); await pageA.waitForTimeout(500);
  const status = await pageA.evaluate(async (name) => {
    await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) });
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const r = await fetch("/api/v1/organization", { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ name }) });
    return r.status;
  }, TEMP);
  check("管理员 PATCH 组织名成功", status === 200, String(status));

  await pageA.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2400);
  const workspace = await pageA.locator(".workspace-switcher strong").innerText().catch(() => "");
  check("侧栏工作区显示组织名", workspace === TEMP, workspace);
  const footer = await pageA.locator("footer").innerText().catch(() => "");
  check("页脚显示「Feronavi · 组织名」", footer.includes(`Feronavi · ${TEMP}`), footer.replace(/\n/g, " | ").slice(0, 80));
  check("浏览器标签标题含组织名", (await pageA.title()).includes(TEMP), await pageA.title());

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await pageB.waitForTimeout(1400);
  check("未登录登录页显示「登录到 组织名」", (await pageB.getByText(`登录到 ${TEMP}`).count()) === 1);
  await pageA.screenshot({ path: "/tmp/org-brand.png" });
  await ctxB.close(); await ctxA.close();
} finally {
  await sql`update organization set name = ${orig.name}, updated_at = now()`;
  await sql`delete from audit_entry where action = 'organization.updated' and actor_id = (select id from member where username = 'demo')`;
  await sql.end(); await browser.close();
}
void results2;
const ok = results.filter(Boolean).length;
console.log(`\n  组织名称消费端验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
