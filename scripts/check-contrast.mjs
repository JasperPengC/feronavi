/**
 * 主题对比度检查（T5）
 *
 * 核心正文 token 与可读文字控件的对比度检查。
 * 原型批准的辅助色、强调色不是通用文字色；保留它们的实测值作为诊断，
 * 但不把每个强调色与每一种中性底色的组合误当成真实 UI 文字配对。
 */
import { readFileSync } from "node:fs";

const css = readFileSync("src/client/styles/tokens.css", "utf8");

function parseBlock(name) {
  const m = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`找不到 .${name}`);
  const out = {};
  const block = m[1].replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of block.split(";")) {
    const kv = line.split(":");
    if (kv.length < 2) continue;
    out[kv[0].trim()] = kv.slice(1).join(":").trim();
  }
  return out;
}

function hexToRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [l1, l2] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** 正文与可读辅助文字在实际使用的中性面板上达到 WCAG AA。 */
const TEXT_COLORS = ["--text", "--text-soft", "--text-muted"];
const TEXT_SURFACES = [
  "--bg", "--bg-subtle", "--bg-muted", "--surface-chrome", "--surface-workbench",
  "--surface-panel", "--surface-raised", "--surface-3",
];
const EXTRA_PAIRS = [["--danger", "--danger-bg"], ["--primary-fg", "--primary"], ["--primary-fg", "--primary-hover"]];

let pass = 0, fail = 0, checked = 0;
for (const theme of ["light", "dark"]) {
  const t = parseBlock(`theme-${theme}`);
  console.log(`\n  ── ${theme === "light" ? "亮色" : "深色"}主题 ──`);
  for (const fg of TEXT_COLORS) {
    const results = TEXT_SURFACES.map((bg) => ({ bg, value: t[bg] ? ratio(t[fg] ?? "", t[bg]) : NaN }));
    checked += results.length;
    const missing = !t[fg] || results.some((r) => Number.isNaN(r.value));
    const worst = results.reduce((a, b) => a.value < b.value ? a : b);
    const ok = !missing && results.every((r) => r.value >= 4.5);
    if (ok) pass++; else fail++;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${fg.padEnd(14)} 最低 ${Number.isFinite(worst.value) ? worst.value.toFixed(2) : "--"}:1（${worst.bg}）`);
  }
  // 品牌强调/状态 token 仍显示在此处的最低实测值，方便审查原型颜色的对比度局限；
  // 它们只在对应的状态标记、图表、图标或强调控件中使用，不作为通用正文颜色。
  for (const fg of ["--text-faint", "--blue", "--blue-bright", "--violet", "--cyan", "--green", "--amber", "--red", "--primary", "--success", "--warning", "--danger", "--info", "--neutral"]) {
    const results = TEXT_SURFACES.map((bg) => ({ bg, value: t[bg] ? ratio(t[fg] ?? "", t[bg]) : NaN }));
    const worst = results.reduce((a, b) => a.value < b.value ? a : b);
    console.log(`  NOTE ${fg.padEnd(14)} 最低 ${Number.isFinite(worst.value) ? worst.value.toFixed(2) : "--"}:1（${worst.bg}；原型强调/辅助色）`);
  }
  for (const [fg, bg] of EXTRA_PAIRS) {
    checked++;
    const value = t[fg] && t[bg] ? ratio(t[fg], t[bg]) : NaN;
    const ok = Number.isFinite(value) && value >= 4.5;
    if (ok) pass++; else fail++;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${fg.padEnd(14)} on ${bg.padEnd(19)} ${Number.isFinite(value) ? value.toFixed(2) : "--"}:1（需 ≥ 4.5）`);
  }
}

console.log(`\n结果: ${pass} 项颜色规则通过 / ${fail} 项失败（检查 ${checked} 个前景/背景组合）`);
process.exit(fail === 0 ? 0 : 1);
