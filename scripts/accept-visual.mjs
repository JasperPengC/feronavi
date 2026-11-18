import "./_env.ts";
/**
 * 关键页面视觉回归基线（Round 102）
 * 固定主题/视口/时钟；对动态数据区域用 visibility:hidden 掩码（保留布局、忽略内容变化），
 * pixelmatch 对比 docs/visual-baseline：light/dark × desktop/mobile。
 * 生成/更新基线：UPDATE_VISUAL=1 node scripts/accept-visual.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
const BASE = process.env.BASE;
const DIR = "docs/visual-baseline";
const UPDATE = process.env.UPDATE_VISUAL === "1";
const PAGES = [
  ["settings", "/settings", ".settings-feedback,.settings-section__body,.shell-tabbar,.shell-footer,.eyebrow"],
  ["system", "/system", ".sys-kpi-grid,.sys-alert-stack,.sys-all-ok,.sys-groups,.sys-details,.sys-scheduler-summary,.shell-tabbar,.shell-footer,.eyebrow"],
  ["members", "/members", ".metric-grid,.members-directory,.members-load-panel,.invite-panel,.team-panel,.shell-tabbar,.shell-footer,.eyebrow"],
  ["projects", "/projects", ".data-table tbody,.project-list-toolbar,.shell-tabbar,.shell-footer,.eyebrow"],
  ["workbench", "/workbench", ".workbench-page .page-header,.workbench-cross,.metric-grid,.workbench-top-grid,.workbench-lower-grid,.shell-tabbar,.shell-footer,.eyebrow"],
  ["issues", "/issues", ".metric-grid,.issues-insights,.issues-filterbar,.data-table tbody,.shell-tabbar,.shell-footer,.eyebrow"],
];
const VARIANTS = [
  ["light", "desktop", "light", { width: 1440, height: 950 }],
  ["dark", "desktop", "dark", { width: 1440, height: 950 }],
  ["light", "mobile", "light", { width: 390, height: 844 }],
  ["dark", "mobile", "dark", { width: 390, height: 844 }],
];
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
if (UPDATE) {
  // 清掉旧版无主题/视口后缀的基线，避免两套文件并存
  for (const f of readdirSync(DIR)) if (/^(settings|system|members|projects|workbench|issues)\.png$/.test(f)) unlinkSync(`${DIR}/${f}`);
}
const browser = await chromium.launch({ channel: "chrome" });
const failures = [];
let total = 0;
for (const [theme, device, colorScheme, viewport] of VARIANTS) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", isMobile: device === "mobile", hasTouch: device === "mobile" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async (theme) => {
    await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) });
    document.cookie = `feronavi_theme=${theme}; path=/`;
  }, theme);
  for (const [name, path, masks] of PAGES) {
    total++;
    await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: `${masks.split(",").map((s) => s.trim()).filter(Boolean).join(",")} { visibility: hidden !important; }` });
    const shot = await page.screenshot();
    const baselinePath = `${DIR}/${name}-${theme}-${device}.png`;
    if (UPDATE || !existsSync(baselinePath)) {
      writeFileSync(baselinePath, shot);
      console.log(`  ✓ ${name} ${theme}/${device} 基线已生成`);
      continue;
    }
    const a = PNG.sync.read(readFileSync(baselinePath));
    const b = PNG.sync.read(Buffer.from(shot));
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`  ✗ ${name} ${theme}/${device} 尺寸变化 ${a.width}x${a.height} → ${b.width}x${b.height}`);
      failures.push(`${name}-${theme}-${device}`); continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
    const ratio = changed / (a.width * a.height);
    if (ratio > 0.002) {
      writeFileSync(`/tmp/visual-diff-${name}-${theme}-${device}.png`, PNG.sync.write(diff));
      console.log(`  ✗ ${name} ${theme}/${device} 像素差异 ${(ratio * 100).toFixed(3)}%（阈值 0.2%，diff=/tmp/visual-diff-${name}-${theme}-${device}.png）`);
      failures.push(`${name}-${theme}-${device}`);
    } else {
      console.log(`  ✓ ${name} ${theme}/${device} 一致（差异 ${(ratio * 100).toFixed(3)}%）`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n  关键页面视觉回归 ${total - failures.length}/${total}（light/dark × desktop/mobile）`);
process.exit(failures.length === 0 ? 0 : 1);
