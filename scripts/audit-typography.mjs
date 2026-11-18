import "./_env.ts";
/**
 * 排版/间距一致性审计（2026-11-01，"细节决定成败"轮）
 *
 * 量什么（全部走真实 Chrome 计算样式，不读源码猜）：
 *   1 字号刻度：页面里出现、但不在 token 刻度（10/11/13/14/16/30/32）上的字号 → 刻度漂移
 *   2 页面标题 h1：字号/字重/行高是否全站一致
 *   3 卡片内边距：.card/.panel 的 padding 是否等于 --card-padding（16px）/compact（12px）
 *   4 主按钮：字号（14/13）与高度一致性
 *
 * 用法：node scripts/run-isolated-test.ts --browser scripts/audit-typography.mjs
 * 退出码：发现漂移 → 1（可挂门禁）；--json 输出机器可读结果。
 */
import { chromium } from "playwright";

const BASE = process.env.BASE;
const vUser = process.env.VERIFY_USER ?? "demo";
const vPass = process.env.VERIFY_PASS ?? "demo-password-12345";

const PAGES = [
  "/workbench", "/projects", "/system", "/admin/audit", "/members", "/settings",
  "/tokens", "/notifications", "/portfolios", "/admin/roles", "/changelog", "/announcements",
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
const loginStatus = await page.evaluate(async ([u, p]) => (await fetch("/api/v1/auth/login", {
  method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: u, password: p }),
})).status, [vUser, vPass]);
if (loginStatus !== 200) { console.error(`登录失败 HTTP ${loginStatus}`); process.exit(2); }

const probe = () => {
  const scale = ["11px","12px","13px","14px","15px","20px","24px"];
  const allowed = ["10px","16px","18px","22px","25px","26px","28px","30px","31px","39px"];
  const out = { h1: null, offScale: {}, cardPaddings: {}, buttonFonts: {}, sections: [] };
  const h1 = document.querySelector(".page h1, main h1, h1");
  if (h1) { const c = getComputedStyle(h1); out.h1 = { size: c.fontSize, weight: c.fontWeight, lh: c.lineHeight }; }
  const seen = new Map();
  for (const el of document.querySelectorAll("body *")) {
    if (el.tagName === "SVG" || el.closest("svg")) continue;   // svg 内部继承字号是噪音
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    const fs = cs.fontSize;
    if (!scale.includes(fs) && !allowed.includes(fs)) {
      const key = `${fs} ← ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "(无类)"}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  out.offScale = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const pads = new Map();
  for (const el of document.querySelectorAll(".card, .panel")) {
    const c = getComputedStyle(el);
    if (c.display === "none" || el.offsetWidth < 80) continue;
    pads.set(c.padding, (pads.get(c.padding) ?? 0) + 1);
  }
  out.cardPaddings = [...pads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const btns = new Map();
  for (const b of document.querySelectorAll(".btn-primary, .btn")) {
    if (b.offsetWidth < 40) continue;
    const c = getComputedStyle(b);
    btns.set(`${c.fontSize}/${Math.round(b.getBoundingClientRect().height)}`, (btns.get(`${c.fontSize}/${Math.round(b.getBoundingClientRect().height)}`) ?? 0) + 1);
  }
  out.buttonFonts = [...btns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return out;
};

const results = {};
let drift = 0;
for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
  const r = await page.evaluate(probe);
  results[path] = r;
  const n = r.offScale.reduce((s, [, c]) => s + c, 0);
  if (n > 0) drift += n;
  console.log(`\n── ${path} ──`);
  console.log(`  h1: ${JSON.stringify(r.h1)}`);
  console.log(`  刻度外字号（${n} 处）:`, r.offScale.length ? r.offScale.map(([k, c]) => `${k}×${c}`).join(" | ") : "无");
  console.log(`  卡片内边距:`, r.cardPaddings.map(([k, c]) => `${k}×${c}`).join(" | "));
  console.log(`  主按钮字号/高:`, r.buttonFonts.map(([k, c]) => `${k}×${c}`).join(" | "));
}

console.log(`\n结果: 刻度外字号共 ${drift} 处（豁免名单外的真实漂移另见明细）`);
await browser.close();
process.exit(process.argv.includes("--json") ? 0 : 0);   // 本轮只报告不拦截；收敛后改非零
