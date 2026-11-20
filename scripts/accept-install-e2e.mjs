import "./_env.ts";
/**
 * 全新环境「一键安装」端到端验收（Round 21）
 *
 * 与 `accept-setup-wizard.mjs` 的分工：那个只走到第 6 步确认页就停（保持空库可重复跑），
 * 这个**真的点「完成安装」**，验证装完之后实例确实能用：
 *   ① 全新空库（**只建库，不手工迁移、不手工种子**）→ 起服务 → 启动日志里自动迁移成功；
 *   ② 六步向导真实走完 → 点「完成安装」→ 跳登录页；
 *   ③ 新管理员能登录；内置 4 个角色存在（说明向导自动补齐种子）；账号有 47 项权限、ORG 数据范围。
 *
 * 运行：node scripts/run-isolated-test.ts --empty scripts/accept-install-e2e.mjs
 */
import { chromium } from "playwright";

const HOST = process.env.BASE;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "feronavi_theme", value: "dark", domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
try {
  await page.goto(HOST + "/setup", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  // 注意：必须先打开目标站再 fetch（about:blank 的跨源 fetch 会因不透明源失败）
  const state = await page.evaluate(async () => (await (await fetch("/api/v1/setup/state")).json())).catch(() => null);
  check("目标实例存在且未初始化", !!state && state.initialized === false, JSON.stringify(state));
  const next = () => page.getByRole("button", { name: "下一步", exact: true }).first();
  check("第 1 步自检通过（下一步可点）", !(await next().isDisabled()));
  await next().click(); await page.waitForTimeout(600);   // 环境自检 → 数据库
  await next().click(); await page.waitForTimeout(600);   // 数据库 → 管理员
  await page.getByLabel("用户名").fill("accept_admin");
  await page.getByLabel("姓名").fill("验收管理员");
  await page.getByLabel("邮箱").fill("accept@example.com");
  await page.getByLabel("密码", { exact: true }).fill("Acceptance-Pass-2026");
  await page.getByLabel("确认密码").fill("Acceptance-Pass-2026");
  await page.waitForTimeout(300);
  await next().click(); await page.waitForTimeout(600);   // → 组织
  await page.getByLabel("组织名称").fill("验收组织");
  await next().click(); await page.waitForTimeout(600);   // → 集成
  await next().click(); await page.waitForTimeout(800);   // → 完成确认
  await page.getByRole("button", { name: "完成安装", exact: true }).click();
  await page.waitForTimeout(4000);
  check("点「完成安装」后跳转登录页", page.url().includes("/login"), page.url());
  await page.screenshot({ path: "/tmp/install-e2e-done.png" });

  const login = await page.evaluate(async () => {
    const r = await fetch("/api/v1/auth/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "accept_admin", password: "Acceptance-Pass-2026" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  check("新管理员能登录", login.status === 200, `status=${login.status}`);

  const restricted = await page.evaluate(async () => ({ me: await fetch("/api/v1/auth/me").then(r => r.json()), rolesStatus: (await fetch("/api/v1/roles")).status }));
  check("首次管理员必须改密后才能访问业务接口", restricted.me.mustChangePassword === true && restricted.rolesStatus === 403);
  await page.goto(`${HOST}/change-password`);
  await page.getByLabel(/^当前密码/).fill("Acceptance-Pass-2026");
  await page.getByLabel(/^新密码/).fill("Acceptance-Changed-2026");
  await page.getByLabel(/^确认新密码/).fill("Acceptance-Changed-2026");
  await page.getByRole("button", { name: "确认修改", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/login");
  await page.getByLabel("用户名").fill("accept_admin");
  await page.getByLabel(/^密码/).fill("Acceptance-Changed-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(url => url.pathname !== "/login" && url.pathname !== "/change-password");
  check("完成首次改密并重新登录", await page.evaluate(async () => (await fetch("/api/v1/auth/me").then(r => r.json())).mustChangePassword === false));

  const roles = await page.evaluate(async () => {
    const response = await fetch("/api/v1/roles");
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.roles)) throw new Error(`角色目录读取失败：${response.status} ${JSON.stringify(body)}`);
    return body.roles;
  });
  check("内置 4 个角色已自动补齐", roles.length === 4, JSON.stringify(roles.map((r) => r.key)));

  const me = await page.evaluate(async () => (await (await fetch("/api/v1/auth/me")).json()));
  check("账号拥有 ADMIN 权限（47 项，含 role:manage）",
    Array.isArray(me.permissions) && me.permissions.length === 47 && me.permissions.includes("role:manage"),
    `perms=${(me.permissions || []).length}`);
  check("数据范围是 ORG", (me.dataScopes || []).some((s) => s.scopeType === "ORG"), JSON.stringify(me.dataScopes));
} catch (e) {
  check("脚本完整执行", false, String(e).slice(0, 300));
  await page.screenshot({ path: "/tmp/install-e2e-error.png" }).catch(() => {});
}
const ok = results.filter((r) => r.pass).length;
console.log(`\n  全新环境一键安装验收 ${ok}/${results.length}（HOST=${HOST}）`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
