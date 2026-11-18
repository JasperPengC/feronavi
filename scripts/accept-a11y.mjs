import "./_env.ts";
/**
 * WCAG 可访问性自动审计（Round 101，axe-core）
 * 逐页运行 wcag2a + wcag2aa 规则，输出 violations 详情；serious/critical 作为失败。
 * 自动扫描不能替代读屏/键盘人工验收，结果中如实标注。
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE;
const USERNAME = process.env.A11Y_USERNAME ?? "demo";
const PASSWORD = process.env.A11Y_PASSWORD ?? "demo-password-12345";
const BASE_PAGES = [
  "/workbench", "/projects", "/issues", "/members", "/settings", "/system", "/portfolios", "/focus",
  "/announcements", "/notifications", "/changelog", "/tokens", "/admin/organization", "/admin/roles", "/admin/audit",
];
const PROJECT_PAGES = ["", "/board", "/table", "/milestones", "/calendar", "/timeline", "/wiki", "/ideas", "/insights", "/activity", "/fields", "/import", "/automation"];

const reportDirectory = process.env.A11Y_REPORT_DIR ?? ".cache/a11y";
mkdirSync(reportDirectory, { recursive: true });
const reportPath = `${reportDirectory}/a11y-report.json`;
const results = [];
const report = [];
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  await page.evaluate(async ({ username, password }) => {
    await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || "");
    await fetch("/api/v1/me/preferences", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ theme: "system" }) });
    document.cookie = "feronavi_theme=auto; path=/";
  }, { username: USERNAME, password: PASSWORD });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items?.[0]?.id);
  const PAGES = [...BASE_PAGES, ...PROJECT_PAGES.map((suffix) => `/projects/${pid}${suffix}`)];
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
    const violations = res.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      details: v.nodes.slice(0, 12).map((n) => ({ target: n.target, html: n.html.slice(0, 200), data: n.any?.map((a) => a.data).filter(Boolean) })),
    }));
    report.push({ theme, path, violations });
    const severe = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    console.log(`  ${theme} ${path}: violations=${violations.length} serious/critical=${severe.length}`);
    if (severe.length) console.log("   ", JSON.stringify(severe.slice(0, 3)));
    results.push({ theme, path, ok: severe.length === 0 });
  }
  await ctx.close();
}
writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
await browser.close();

const ok = results.filter((r) => r.ok).length;
console.log(`\n  WCAG 可访问性自动审计 ${ok}/${results.length} 页无 serious/critical（报告 ${reportPath}）`);
process.exit(ok === results.length ? 0 : 1);
