import "./_env.ts";
/**
 * 成员邀请界面验收（Round 25 长任务第 49 项）——可重复执行、自建自清。
 * 管理员界面生成邀请 → 新浏览器上下文打开链接接受 → 用新账号登录 → 成员目录可见。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-6);
const U = `uiinvite${stamp}`;
const EMAIL = `${U}@x.test`;
const NAME = `受邀验收 ${stamp}`;
const PW = "invited-ui-pass-123456";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
await ctxA.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
const pageA = await ctxA.newPage();
let memberId = null;
try {
  await pageA.goto(`${BASE}/login`); await pageA.waitForTimeout(600);
  await pageA.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await pageA.goto(`${BASE}/members`, { waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2600);
  await pageA.getByRole("tab", { name: "邀请", exact: true }).click();
  await pageA.getByRole("button", { name: "邀请成员", exact: true }).click();
  await pageA.getByLabel("受邀人邮箱").fill(EMAIL);
  await pageA.getByRole("button", { name: "生成邀请链接" }).click();
  await pageA.waitForTimeout(1200);
  const link = (await pageA.getByTestId("invite-link").innerText()).trim();
  check("界面生成邀请并展示一次性链接", /\/invite\/[A-Za-z0-9_-]{20,}/.test(link), link.slice(0, 60));
  check("未配 SMTP 时提示直接复制链接", (await pageA.getByText(/未配置 SMTP/).count()) > 0);
  await pageA.locator(".ui-drawer-body").getByRole("button", { name: "关闭", exact: true }).click();

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const pageB = await ctxB.newPage();
  await pageB.goto(link, { waitUntil: "domcontentloaded" }); await pageB.waitForTimeout(1200);
  check("邀请链接页面可打开且有效", (await pageB.getByRole("button", { name: "接受邀请" }).count()) === 1);
  await pageB.getByLabel(/用户名/).fill(U);
  await pageB.getByLabel(/显示姓名/).fill(NAME);
  await pageB.getByLabel(/密码/).fill(PW);
  await pageB.getByRole("button", { name: "接受邀请" }).click();
  await pageB.waitForTimeout(1600);
  check("接受邀请后提示已加入", (await pageB.getByText("已加入组织，请登录。").count()) === 1);

  const [m] = await sql`select id from member where username = ${U}`;
  memberId = m?.id ?? null;
  check("真实库已建号且邮箱来自邀请", !!memberId && (await sql`select count(*)::int as n from member where id = ${memberId} and email = ${EMAIL}`)[0].n === 1);

  await pageB.getByRole("button", { name: "去登录" }).click();
  await pageB.waitForTimeout(900);
  await pageB.getByLabel("用户名").fill(U);
  await pageB.getByLabel("密码").fill(PW);
  await pageB.getByRole("button", { name: "登录", exact: true }).click();
  await pageB.waitForTimeout(2600);
  await pageB.locator(".shell-header").waitFor();
  const signedIn = await pageB.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me");
    return { status: response.status, actor: await response.json() };
  });
  check("受邀成员用新账号登录成功", signedIn.status === 200 && signedIn.actor.memberId === memberId && signedIn.actor.username === U && new URL(pageB.url()).pathname === "/projects", pageB.url());
  await pageB.goto(link, { waitUntil: "domcontentloaded" });
  await pageB.getByRole("alert").waitFor();
  check("已使用邀请链接不可重复接受", (await pageB.getByRole("alert").innerText()).includes("邀请链接无效或已过期")
    && await pageB.getByRole("button", { name: "接受邀请", exact: true }).count() === 0);
  await ctxB.close();

  await pageA.reload({ waitUntil: "domcontentloaded" }); await pageA.waitForTimeout(2400);
  const memberRow = pageA.locator(".members-table tbody tr").filter({ hasText: EMAIL });
  check("成员目录出现受邀成员", await memberRow.count() === 1 && (await memberRow.innerText()).includes(NAME));
  await pageA.getByRole("tab", { name: "邀请", exact: true }).click();
  const invitation = pageA.locator(".invite-list li").filter({ hasText: EMAIL });
  await invitation.waitFor();
  check("对应邀请台账标记为已使用", (await invitation.innerText()).includes("已使用"));
  await pageA.screenshot({ path: "/tmp/invites.png" });
} finally {
  try {
    if (memberId) {
      await sql`delete from audit_entry where actor_id = ${memberId}`;
      await sql`delete from activity_entry where actor_id = ${memberId}`;
      await sql`delete from role_assignment where member_id = ${memberId}`;
      await sql`delete from member where id = ${memberId}`;
    }
    await sql`delete from invite where email = ${EMAIL}`;
  } catch (e) { console.error("[cleanup]", e.message); }
  await ctxA.close(); await sql.end(); await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  成员邀请界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
