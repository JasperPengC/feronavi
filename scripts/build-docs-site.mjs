#!/usr/bin/env node
/**
 * 文档站构建（第十四期，P5 交付物）
 *
 * 为什么自研：只把仓库里 现行项目文档转成可浏览站点，**不需要引入 Markdown 依赖**
 * （与本项目"拒绝为单一功能引入未审计依赖"的一贯原则一致，先例：Excel 导入）。
 * 覆盖面刻意保守：标题、段落、列表、表格、代码块、行内代码、粗体、链接 —— 恰好是这些文档用到的全部语法。
 *
 * 输出：`docs-site/`（index.html + 每份文档一页 + style.css）。可作为静态站点直接托管。
 * 注：产物**不进版本库**（.gitignore），文档本身才是真相源 —— 站点是派生物。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = process.env.DOCS_DIR || fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = process.env.OUT_DIR ?? "docs-site";
export const DOCS = ["README.md", "deploy.md", "testing.md", "architecture.md", "reference/permissions.md"];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/** 行内语法：代码 → 粗体 → 删除线 → 链接（顺序有讲究：代码优先，避免其中的 * 被当成粗体） */
function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/** Markdown → HTML：只处理这些文档实际用到的语法 */
export function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    // 代码块
    if (line.trim().startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    // 表格（含分隔行）
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && isTableRow(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>" +
        body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
      continue;
    }
    // 标题（含锚点，便于互相链接）
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} id="${slug(h[2])}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // 引用块
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${buf.map((b) => inline(b)).join("<br>")}</blockquote>`);
      continue;
    }
    // 列表
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const buf = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${buf.map((b) => `<li>${inline(b)}</li>`).join("")}</${tag}>`);
      continue;
    }
    // 分隔线 / 空行
    if (/^\s*---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (line.trim() === "") { i++; continue; }
    // 段落（连续非空行合并）
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !isTableRow(lines[i]) && !lines[i].trim().startsWith("```")) {
      buf.push(lines[i]); i++;
    }
    if (buf.length === 0) {
      /**
       * ⚠️ 进度保证：走到这里说明该行不属于任何已处理语法（例如"像表格但没有分隔行"）。
       * 必须**至少消费一行**，否则解析器会在原地死循环 —— 实测踩到（脚本挂起不退出）。
       */
      out.push(`<p>${inline(line)}</p>`);
      i++;
      continue;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const PAGE = (title, body, nav) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Feronavi 文档</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<nav>${nav}</nav>
<main>${body}</main>
<footer>由 <code>scripts/build-docs-site.mjs</code> 从 Markdown 文件生成 · 文档是真相源，站点是派生物</footer>
</body>
</html>`;

const STYLE = `:root{--bg:#fff;--fg:#1d2430;--muted:#5d6a7c;--line:rgba(29,36,48,.12);--code:#f4f6fa}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--fg:#e6ebf2;--muted:#9aa7b6;--line:rgba(255,255,255,.12);--code:#1b2129}}
*{box-sizing:border-box}
body{margin:0;display:grid;grid-template-columns:260px 1fr;min-height:100vh;background:var(--bg);color:var(--fg);
  font:15px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
nav{border-right:1px solid var(--line);padding:20px 14px;position:sticky;top:0;height:100vh;overflow:auto}
nav a{display:block;padding:6px 10px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:14px}
nav a:hover{background:var(--code);color:var(--fg)}
nav a[aria-current=page]{background:rgba(73,104,232,.12);color:#4968e8;font-weight:600}
nav h1{font-size:15px;margin:0 0 14px;padding:0 10px}
main{padding:28px 32px;max-width:980px;overflow-wrap:anywhere}
h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .5em}
h1{font-size:28px}h2{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{font-size:18px}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:13px}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:var(--code)}
code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.9em}
pre{background:var(--code);padding:14px;border-radius:10px;overflow:auto}
pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:8px 14px;border-left:3px solid var(--line);color:var(--muted)}
a{color:#4968e8}
footer{grid-column:1/-1;border-top:1px solid var(--line);padding:14px 32px;color:var(--muted);font-size:13px}
@media (max-width:860px){body{grid-template-columns:1fr}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}`;

export function buildSite(srcDir = SRC_DIR, outDir = OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "style.css"), STYLE);
  const availableDocs = DOCS.filter((name) => existsSync(join(srcDir, name)));
  if (availableDocs.length === 0) throw new Error("缺少可构建的 Markdown 文档");
  const pages = availableDocs.map((name) => ({ name, file: `${slug(basename(name, ".md"))}.html`, title: name.replace(/\.md$/, "") }));
  for (const name of availableDocs) {
    const path = join(srcDir, name);
    const md = readFileSync(path, "utf8");
    const html = renderMarkdown(md).replace(/href="([^"#]+\.md)(#[^"]*)?"/gu, (original, href, hash = "") => {
      const page = pages.find((p) => p.name === href || basename(p.name) === basename(href));
      return page ? `href="${page.file}${hash}"` : original;
    });
    const file = `${slug(basename(name, ".md"))}.html`;
    const nav = `<h1>Feronavi 文档</h1>` + pages.map((p) =>
      `<a href="${p.file}"${p.file === file ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`).join("");
    // 循环变量是 name（不是 p）；标题与页面元数据都从它派生
    writeFileSync(join(outDir, file), PAGE(name.replace(/\.md$/, ""), html, nav));
  }
  // 索引页
  const index = `<h1>Feronavi 文档站</h1><p>本仓库包含的公开文档：</p><ul>` +
    pages.map((p) => `<li><a href="${p.file}">${esc(p.title)}</a></li>`).join("") + "</ul>" +
    `<p>使用 <code>pnpm check:docs-site</code> 检查生成结果。</p>`;
  writeFileSync(join(outDir, "index.html"), PAGE("索引", index, `<h1>Feronavi 文档</h1>` + pages.map((p) => `<a href="${p.file}">${esc(p.title)}</a>`).join("")));
  return { pages: pages.map((p) => p.file), outDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = buildSite();
    console.log(`  ✅ 文档站已生成：${r.outDir}（${r.pages.length + 1} 页）`);
    for (const p of r.pages) console.log(`     ${p}`);
  } catch (e) {
    console.error(`  ❌ 生成失败：${e.message}`);
    process.exit(1);
  }
}
