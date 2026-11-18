import "./_env.ts";
/** 超宽屏（2560）关键页面视觉基线（Round 104）：验证 PC 超宽屏内容上限与居中。 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
const BASE = process.env.BASE;
const DIR = "docs/visual-baseline/wide";
const UPDATE = process.env.UPDATE_VISUAL === "1";
const PAGES = [
  ["workbench", "/workbench", ".metric-grid,.workbench-top-grid,.workbench-lower-grid,.shell-tabbar,.shell-footer,.eyebrow"],
  ["settings", "/settings", ".settings-feedback,.settings-section__body,.shell-tabbar,.shell-footer,.eyebrow"],
  ["issues", "/issues", ".metric-grid,.issues-chart-grid,.issues-filterbar,.data-table tbody,.shell-tabbar,.shell-footer,.eyebrow"],
  ["system", "/system", ".sys-kpi-grid,.sys-alert-stack,.sys-all-ok,.sys-groups,.sys-details,.sys-scheduler-summary,.shell-tabbar,.shell-footer,.eyebrow"],
];
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 }, colorScheme: "light", reducedMotion: "reduce" });
const page = await ctx.newPage();
const failures = [];
try {
  await page.goto(`${BASE}/login`); await page.waitForTimeout(400);
  await page.evaluate(async () => { await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "demo", password: "demo-password-12345" }) }); });
  for (const [name, path, masks] of PAGES) {
    await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    await page.addStyleTag({ content: `${masks.split(",").map((s) => s.trim()).filter(Boolean).join(",")} { visibility: hidden !important; }` });
    const shot = await page.screenshot();
    const baseline = `${DIR}/${name}.png`;
    if (UPDATE || !existsSync(baseline)) { writeFileSync(baseline, shot); console.log(`  ✓ ${name} 2560 基线已生成`); continue; }
    const a = PNG.sync.read(readFileSync(baseline)); const b = PNG.sync.read(Buffer.from(shot));
    if (a.width !== b.width || a.height !== b.height) { failures.push(name); continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
    const ratio = changed / (a.width * a.height);
    if (ratio > 0.002) { writeFileSync(`/tmp/visual-wide-${name}.png`, PNG.sync.write(diff)); console.log(`  ✗ ${name} 差异 ${(ratio * 100).toFixed(3)}%`); failures.push(name); }
    else console.log(`  ✓ ${name} 2560 一致（${(ratio * 100).toFixed(3)}%）`);
  }
} finally { await ctx.close(); await browser.close(); }
console.log(`\n  超宽屏视觉回归 ${PAGES.length - failures.length}/${PAGES.length}`);
process.exit(failures.length ? 1 : 0);
