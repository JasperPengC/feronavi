import "./_env.ts";
/**
 * 工作区/页脚验收（Round 92）：真实项目切换器 + 实用页脚（当前项目/服务状态/版本）。
 * 明确断言：不再出现「工作区已同步」「本地实例」这类无实际含义的假信息。
 */
import { chromium } from "playwright";
const BASE = process.env.BASE;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const projects = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items);
  await page.goto(`${BASE}/workbench`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);

  const footer = await page.locator(".shell-footer").innerText();
  check("页脚含真实服务状态与版本", footer.includes("服务正常") && /v\S+/.test(footer), footer.replace(/\n/g, " | "));
  check("页脚不再出现「工作区已同步」「本地实例」", !footer.includes("工作区已同步") && !footer.includes("本地实例"), footer.replace(/\n/g, " | "));
  check("非项目页页脚显示全部项目", footer.includes("全部项目"), footer.replace(/\n/g, " | "));

  // 打开项目切换器
  await page.getByRole("button", { name: "切换当前项目", exact: true }).click();
  const menuItems = page.locator(".workspace-menu [role=menuitemradio]");
  await menuItems.first().waitFor({ timeout: 5000 });
  const labels = await menuItems.allInnerTexts();
  check("切换器列出真实项目（全部项目 + 可见项目）", labels.length === projects.length + 1, JSON.stringify(labels.slice(0, 5)));
  check("切换器菜单含组织上下文", (await page.locator(".workspace-menu").innerText()).includes("当前组织"));
  await page.screenshot({ path: "/tmp/workspace-switcher.png" });

  const target = projects[0];
  await page.locator(".workspace-menu [role=menuitemradio]", { hasText: target.name }).click();
  await page.waitForTimeout(1200);
  check("选择项目后进入该项目概览", page.url().includes(`/projects/${target.id}`), page.url());
  const footer2 = await page.locator(".shell-footer").innerText();
  check("项目页页脚显示当前项目名", footer2.includes("当前项目") && footer2.includes(target.name), footer2.replace(/\n/g, " | "));
  check("侧栏出现当前项目分组导航", (await page.locator('.nav-group[data-nav-group="project"]').count()) === 1);

  // 再切回全部项目
  await page.getByRole("button", { name: "切换当前项目", exact: true }).click();
  await page.locator(".workspace-menu [role=menuitemradio]").first().click();
  await page.waitForTimeout(900);
  check("切回全部项目进入项目列表", page.url().endsWith("/projects"), page.url());
  await page.screenshot({ path: "/tmp/workspace-footer.png" });
} finally { await ctx.close(); await browser.close(); }
const ok = results.filter(Boolean).length;
console.log(`\n  工作区/页脚验收 ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
