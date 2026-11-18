/**
 * 按钮/链接统一迁移脚本（前端统一化长任务）
 *
 * 为什么要有它：手工改按钮覆盖不全，正则批量换开标签又会**破坏闭合标签配平**（第 9 轮踩过）。
 * 这里把可靠做法固化成工具：
 *   ① 扫描 `<button className="btn…">` / `<Link className="btn…">` / `<a className="btn…">`；
 *   ② 为每个开标签**向后配对闭合标签**（按钮/链接内不会有同类嵌套）；
 *   ③ **从后往前**替换，避免索引失效；
 *   ④ **写入前断言开闭数量相等**，配平失败就不写。
 *
 * 用法：node scripts/migrate-buttons.mjs <文件> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const dry = process.argv.includes("--dry");
if (!file) { console.error("用法: node scripts/migrate-buttons.mjs <文件> [--dry]"); process.exit(2); }
let s = readFileSync(file, "utf8");

/**
 * 花括号感知的标签扫描：从 `from` 处的 `<tag` 开始，返回标签结束位置（`>` 的下标）。
 * 为什么必须这样：`onClick={() => …}` 里的 `=>` 含 `>`，用 `[^>]*` 会在箭头处截断，
 * 把标签切成两半（第 11 轮两次把文件改坏的根因）。
 */
function findTagEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** 收集某一类开标签：返回 { start, end, openText } */
function collectTags(src, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}\\s`, "g");
  let m;
  while ((m = re.exec(src))) {
    const endIdx = findTagEnd(src, m.index);
    if (endIdx < 0) continue;
    out.push({ start: m.index, end: endIdx + 1, openText: src.slice(m.index, endIdx + 1) });
    re.lastIndex = endIdx + 1;
  }
  return out;
}


function attrsFrom(cls) {
  const p = cls.split(/\s+/);
  const a = [];
  if (p.includes("btn-danger")) a.push('variant="danger"');
  else if (p.includes("btn-primary")) a.push('variant="primary"');
  else if (p.includes("btn-ghost")) a.push('variant="ghost"');
  if (p.includes("btn-sm")) a.push('size="sm"');
  else if (p.includes("btn-lg")) a.push('size="lg"');
  if (p.includes("btn-icon")) a.push("iconOnly");
  return a.join(" ");
}

const edits = [];
const handle = ({ from, to, closeTag, newClose }) => {
  for (const t of collectTags(s, from)) {
    const clsM = /className="(btn[^"]*)"/.exec(t.openText);
    if (!clsM) continue;                         // 只迁挂 .btn 的
    const close = s.indexOf(closeTag, t.end);
    if (close < 0) continue;
    const attrs = attrsFrom(clsM[1]);
    // ⚠️ 必须**保留原标签的其余属性**（to=/onClick=/disabled=…），只去掉 className="btn…"。
    //    我第一版只写了 `<${to} attrs>`，把 `to="/focus"` 丢了 → JSX 非法（第 11 轮第二次改坏的根因）。
    const restAttrs = t.openText
      .replace(/^<[a-zA-Z]+\s*/, "")       // 去掉标签名
      .replace(/className="btn[^"]*"/, "") // 去掉 btn 类
      .replace(/\s*\/?>$/, "")            // 去掉结尾 > 或 />
      .replace(/\s+/g, " ")
      .trim();
    edits.push({ start: t.start, end: t.end, close, newOpen: `<${to}${attrs ? " " + attrs : ""}${restAttrs ? " " + restAttrs : ""}>`, closeTag, newClose });
  }
};
handle({ from: "button", to: "Button", closeTag: "</button>", newClose: "</Button>" });
handle({ from: "Link", to: "LinkButton", closeTag: "</Link>", newClose: "</LinkButton>" });
handle({ from: "a", to: "ExternalLinkButton", closeTag: "</a>", newClose: "</ExternalLinkButton>" });
if (edits.length === 0) { console.log("  没有可迁移的 .btn（button/Link/a）"); process.exit(0); }

// ③ 从后往前替换
let converted = { button: 0, link: 0, a: 0 };
for (const e of edits.reverse()) {
  const closeTag = e.closeTag ?? "</button>";
  const newClose = e.newClose ?? "</Button>";
  s = s.slice(0, e.start) + e.newOpen + s.slice(e.end, e.close) + newClose + s.slice(e.close + closeTag.length);
  if (e.newOpen.startsWith("<Button")) converted.button++;
  else if (e.newOpen.startsWith("<LinkButton")) converted.link++;
  else converted.a++;
}

// ④ 配平断言（只看本文件里这三类开闭是否成对）
const chk = (openRe, closeStr, label) => {
  const opens = [...s.matchAll(openRe)].length;
  const closes = s.split(closeStr).length - 1;
  if (opens !== closes) { console.error(`  ⛔ ${label} 不配平: 开 ${opens} / 闭 ${closes} → **不写入**`); process.exit(1); }
  return opens;
};
chk(/<Button[ >]/g, "</Button>", "Button");
chk(/<LinkButton[ >]/g, "</LinkButton>", "LinkButton");
chk(/<ExternalLinkButton[ >]/g, "</ExternalLinkButton>", "ExternalLinkButton");

// ⑤ 补 import（缺什么补什么）
const rel = "components/ui/";
for (const [re, name] of [[/<Button[ >]/, "Button"], [/<LinkButton[ >]/, "LinkButton"], [/<ExternalLinkButton[ >]/, "ExternalLinkButton"]]) {
  if (re.test(s) && !s.includes(`ui/${name}.tsx`)) {
    const m = /\nimport [^\n]+ from "[^"]+";/.exec(s);
    if (m) s = s.slice(0, m.index + m[0].length) + `\nimport { ${name} } from "../${rel}${name}.tsx";` + s.slice(m.index + m[0].length);
  }
}

console.log(`  ✅ ${file}: button ${converted.button} / Link ${converted.link} / a ${converted.a}${dry ? "（dry-run，未写入）" : ""}`);
if (!dry) writeFileSync(file, s);
