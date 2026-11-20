import "./_env.ts";
/**
 * SSO 界面验收（Round 25 长任务第 43 项）——可重复执行、自建自清。
 * 管理页创建身份源 → 登录页出现企业登录入口 → 点击后真实发现失败原因可见。
 * ⚠️ 会对 https://example.com 发起一次只读的 OIDC 发现请求（预期 404）。
 */
import { chromium } from "playwright";
import postgres from "postgres";
const BASE = process.env.BASE;
const DB = process.env.DATABASE_URL;
const stamp = Date.now().toString(36).slice(-5);
const ISSUER = "https://example.com";
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const sql = postgres(DB, { max: 1 });
const browser = await chromium.launch({ channel: "chrome" });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
  await ctx.addCookies([{ name: "feronavi_theme", value: "light", domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.waitForTimeout(600);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  await page.goto(`${BASE}/settings/integrations`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2600);
  await page.getByRole("tab", { name: "身份与访问", exact: true }).click();
  const section = page.locator(".settings-section", { hasText: "SSO / 身份源" });
  await section.scrollIntoViewIfNeeded();
  check("设置页出现「SSO / 身份源」区块", (await section.count()) === 1);
  await section.getByLabel("Issuer（https）").fill(ISSUER);
  await section.getByLabel("Client ID").fill(`client-${stamp}`);
  await section.getByLabel("Client Secret").fill("secret-ui-accept");
  await section.getByRole("button", { name: "新建身份源" }).click();
  await page.waitForTimeout(1300);
  check("新建后提示并出现在列表", (await page.getByText("身份源已保存").count()) > 0
    && (await section.locator(".settings-record-list li", { hasText: `client-${stamp}` }).count()) === 1);
  check("密钥只显示「已配置」不回显明文", (await section.locator(".settings-record-list li", { hasText: `client-${stamp}` }).innerText()).includes("已配置密钥")
    && !(await page.locator("body").innerText()).includes("secret-ui-accept"));

  // 通过真实接口启用（界面表单的“启用”也是同一接口；此处省一次下拉操作）
  await page.evaluate(async (clientId) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    const idps = await fetch("/api/v1/settings/idp", { credentials: "same-origin" }).then((r) => r.json());
    const row = (idps.idps ?? []).find((x) => x.clientId === clientId);
    await fetch("/api/v1/settings/idp", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ id: row.id, kind: "OIDC", issuer: "https://example.com", clientId, enabled: true }),
    });
  }, `client-${stamp}`);

  const anon = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const loginPage = await anon.newPage();
  await loginPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await loginPage.waitForTimeout(1200);
  const btn = loginPage.getByRole("button", { name: /使用 example\.com 登录/ });
  check("登录页出现企业登录入口", (await btn.count()) === 1);
  await btn.click(); await loginPage.waitForTimeout(7000);
  const errText = await loginPage.locator(".alert-error").last().innerText().catch(() => "");
  check("发现失败原因在登录页可见（不静默）", /发现文档|sso|企业登录失败|无法访问/.test(errText), errText.slice(0, 120));
  await page.screenshot({ path: "/tmp/sso-settings.png" });
  await anon.close();
  await ctx.close();
} finally {
  await sql`delete from idp_config where issuer = ${ISSUER}`;
  await sql.end();
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n  SSO 界面验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
