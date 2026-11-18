import "./_env.ts";
/**
 * 全路由视觉基线（Round 103）
 * 28 个主要路由 × light-desktop / dark-mobile，掩码动态内容与页签/页脚，只保留外壳+页头；
 * 固定时钟（早上好等问候语不波动），pixelmatch 对比 docs/visual-baseline/routes。
 * 生成/更新：UPDATE_VISUAL=1 node scripts/accept-visual-routes.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
const BASE = process.env.BASE;
const DIR = "docs/visual-baseline/routes";
const UPDATE = process.env.UPDATE_VISUAL === "1";
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: "light", reducedMotion: "reduce", timezoneId: "Asia/Shanghai" });
const page = await ctx.newPage();
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const failures = [];
let total;
try {
  await page.clock.install({ time: new Date("2026-10-25T10:00:00+08:00") });
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  const pid = await page.evaluate(async () => (await (await fetch("/api/v1/projects")).json()).items?.[0]?.id);
  const routes = [
    "/workbench", "/projects", `/projects/${pid}`, "/issues", "/members", "/settings", "/system", "/portfolios",
    "/focus", "/announcements", "/notifications", "/changelog", "/tokens", "/admin/organization", "/admin/roles", "/admin/audit",
    `/projects/${pid}/board`, `/projects/${pid}/table`, `/projects/${pid}/milestones`, `/projects/${pid}/calendar`,
    `/projects/${pid}/timeline`, `/projects/${pid}/wiki`, `/projects/${pid}/ideas`, `/projects/${pid}/insights`,
    `/projects/${pid}/activity`, `/projects/${pid}/fields`, `/projects/${pid}/import`,
  ];
  const variants = [
    ["light-desktop", "light", { width: 1440, height: 950 }],
    ["light-wide", "light", { width: 1920, height: 1080 }],
    ["dark-mobile", "dark", { width: 390, height: 844 }],
  ];
  total = routes.length * variants.length;
  for (const [variant, theme, viewport] of variants) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((theme) => { document.cookie = `feronavi_theme=${theme}; path=/`; }, theme);
    for (const route of routes) {
      const slug = route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home";
      await page.goto(BASE + route, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
      await page.addStyleTag({ content: `
        .page > *:not(.page-header) { display: none !important; }
        .page-header .eyebrow, .page-header .page-actions,
        .shell-tabbar, .shell-footer, .shell-header-actions, .shell-header-project, .shell-search { visibility: hidden !important; }
      ` });
      const shot = await page.screenshot();
      const path = `${DIR}/${slug}-${variant}.png`;
      if (UPDATE || !existsSync(path)) { writeFileSync(path, shot); continue; }
      const a = PNG.sync.read(readFileSync(path));
      const b = PNG.sync.read(Buffer.from(shot));
      if (a.width !== b.width || a.height !== b.height) { failures.push(`${route} ${variant} 尺寸`); continue; }
      const diff = new PNG({ width: a.width, height: a.height });
      const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
      const ratio = changed / (a.width * a.height);
      if (ratio > 0.002) {
        writeFileSync(`/tmp/visual-route-${slug}-${variant}.png`, PNG.sync.write(diff));
        failures.push(`${route} ${variant} ${(ratio * 100).toFixed(2)}%`);
      }
    }
  }
} finally { await ctx.close(); await browser.close(); }
console.log(failures.length ? `  ✗ 全路由视觉回归失败：\n    ${failures.slice(0, 10).join("\n    ")}` : `  ✓ 全路由视觉回归 ${total}/${total} 一致（light-desktop + light-wide + dark-mobile）`);
console.log(`\n  全路由视觉回归 ${total - failures.length}/${total}`);
process.exit(failures.length === 0 ? 0 : 1);
