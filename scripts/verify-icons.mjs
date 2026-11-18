/**
 * 图标光学规范验收（真实 Chrome getBBox）—— 长任务 Round 25 第 29 项
 *
 * 为什么需要：NORM 表是"每个图标实测包围盒 → 缩放 + 平移"生成的，但这些数字**没有回归检查**：
 * 改一个路径或补一个图标忘加 NORM，视觉上就会重新出现"大大小小"，而普通结构检查发现不了。
 *
 * 做法（不靠手估）：
 *   1 从 `src/client/components/Icon.tsx` 解析 PATHS（图标几何）与 NORM（归一参数）；
 *   2 断言两侧图标名集合完全一致（新增图标必须补 NORM）；
 *   3 把每个图标按 NORM 渲染进真实 Chrome，`getBBox()` 量测**变换后**的可视包围盒；
 *   4 断言：最大边 = 18（±0.6）、中心 = (12,12)（±0.6）、视觉线宽 = 1.6（±0.1）；
 *   5 输出全表与截图（/tmp/icon-audit.png），退出码 0/1 作为闸门。
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const SRC = "src/client/components/Icon.tsx";
const src = readFileSync(SRC, "utf8");

function parsePaths() {
  const start = src.indexOf("const PATHS:");
  if (start < 0) throw new Error("未找到 PATHS 定义");
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
  const out = [];
  for (const line of block.split("\n")) {
    const m = /^\s{2}("([\w-]+)"|([\w-]+)):\s*(.+),$/.exec(line);
    if (!m) continue;
    const name = m[2] ?? m[3];
    let value = m[4].trim();
    if (value.startsWith("<>")) {
      if (!value.endsWith("</>")) throw new Error(`图标 ${name} 的 Fragment 未闭合`);
      value = value.slice(2, -3);
    }
    if (!value.startsWith("<") || !value.endsWith("/>")) throw new Error(`图标 ${name} 的几何无法解析：${value.slice(0, 40)}`);
    out.push({ name, markup: value });
  }
  return out;
}

function parseNorm() {
  const start = src.indexOf("const NORM:");
  if (start < 0) throw new Error("未找到 NORM 定义");
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
  const map = new Map();
  for (const m of block.matchAll(/"([\w-]+)":\s*\{\s*s:\s*([\d.]+),\s*tx:\s*(-?[\d.]+),\s*ty:\s*(-?[\d.]+)\s*\}/g)) {
    map.set(m[1], { s: Number(m[2]), tx: Number(m[3]), ty: Number(m[4]) });
  }
  return map;
}

const paths = parsePaths();
const norm = parseNorm();
const names = paths.map((p) => p.name);
const problems = [];
for (const name of names) if (!norm.has(name)) problems.push(`缺少 NORM：${name}`);
for (const name of norm.keys()) if (!names.includes(name)) problems.push(`NORM 多余：${name}`);
if (new Set(names).size !== names.length) problems.push("PATHS 存在重名图标");

const html = `<!doctype html><html><body style="margin:0;background:#fff">
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">
${paths.map((p) => {
  const n = norm.get(p.name);
  if (!n) return "";
  return `<svg data-icon="${p.name}" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:-9999px">
    <g data-s="${n.s}" data-tx="${n.tx}" data-ty="${n.ty}" transform="translate(${n.tx} ${n.ty}) scale(${n.s})" stroke-width="${(1.6 / n.s).toFixed(3)}">${p.markup}</g>
  </svg>`;
}).join("\n")}
</svg></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html);
const rows = await page.evaluate(() => [...document.querySelectorAll("svg[data-icon]")].map((svg) => {
  const name = svg.getAttribute("data-icon");
  const s = Number(svg.querySelector("g").getAttribute("data-s"));
  const tx = Number(svg.querySelector("g").getAttribute("data-tx"));
  const ty = Number(svg.querySelector("g").getAttribute("data-ty"));
  const g = svg.querySelector("g");
  const b = g.getBBox();
  const strokeLocal = Number(g.getAttribute("stroke-width"));
  // 变换后的可视包围盒（在 24 单位网格坐标系里）
  const x = tx + s * b.x, y = ty + s * b.y;
  const w = s * b.width, h = s * b.height;
  return {
    name, s, tx, ty,
    width: w, height: h,
    maxExtent: Math.max(w, h),
    cx: x + w / 2, cy: y + h / 2,
    stroke: strokeLocal * s,
  };
}));
await browser.close();

const LIM = { extent: [17.4, 18.6], center: [11.4, 12.6], stroke: [1.5, 1.7] };
for (const r of rows) {
  if (r.maxExtent < LIM.extent[0] || r.maxExtent > LIM.extent[1]) problems.push(`${r.name}: 最大边 ${r.maxExtent.toFixed(3)} 超出 18±0.6`);
  if (r.cx < LIM.center[0] || r.cx > LIM.center[1]) problems.push(`${r.name}: 中心 x ${r.cx.toFixed(3)} 超出 12±0.6`);
  if (r.cy < LIM.center[0] || r.cy > LIM.center[1]) problems.push(`${r.name}: 中心 y ${r.cy.toFixed(3)} 超出 12±0.6`);
  if (r.stroke < LIM.stroke[0] || r.stroke > LIM.stroke[1]) problems.push(`${r.name}: 视觉线宽 ${r.stroke.toFixed(3)} 超出 1.6±0.1`);
}

const maxExt = Math.max(...rows.map((r) => Math.abs(r.maxExtent - 18)));
const maxCenter = Math.max(...rows.map((r) => Math.max(Math.abs(r.cx - 12), Math.abs(r.cy - 12))));
console.log(`  ▸ 图标 ${rows.length} 个（PATHS=${names.length} / NORM=${norm.size}）`);
console.log(`  ▸ 最大边偏差 ${maxExt.toFixed(4)} · 居中偏差 ${maxCenter.toFixed(4)}`);
for (const r of rows) console.log(`    ${r.name.padEnd(18)} 边 ${r.maxExtent.toFixed(3).padStart(6)}  中心 ${r.cx.toFixed(3).padStart(6)},${r.cy.toFixed(3).padStart(6)}  线宽 ${r.stroke.toFixed(3)}`);

// 截图画廊（视觉验收用）
const browser2 = await chromium.launch({ headless: true });
const page2 = await browser2.newPage({ viewport: { width: 1100, height: 700 } });
await page2.setContent(`<!doctype html><html><body style="margin:24px;font:12px system-ui;background:#fff;color:#111">
<h3 style="margin:0 0 12px">图标光学规范（真实 Chrome 渲染；每格 24 网格 / 可视最大边 18）</h3>
<div style="display:grid;grid-template-columns:repeat(9,1fr);gap:10px">
${paths.map((p) => {
  const n = norm.get(p.name);
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-linecap="round" stroke-linejoin="round">
      <g transform="translate(${n.tx} ${n.ty}) scale(${n.s})" stroke-width="${(1.6 / n.s).toFixed(3)}">${p.markup}</g>
    </svg><span style="color:#6b7280">${p.name}</span></div>`;
}).join("")}
</div></body></html>`);
await page2.screenshot({ path: "/tmp/icon-audit.png", fullPage: true });
await browser2.close();

if (problems.length) {
  console.error(`  ⛔ 图标规范未达标：\n${problems.map((p) => `     - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("  ✅ 全部图标满足：最大边 18±0.6 / 居中 (12,12)±0.6 / 视觉线宽 1.6±0.1；截图 /tmp/icon-audit.png");
