/**
 * 现行文档站自检。
 *
 * 检查每份文档、完整导航、表格与代码渲染、HTML 转义及解析进度。
 * 代码块被解析成 <pre>、XSS 转义生效（文档里有 `<script>` 之类的字面量时必须转义）。
 * 另测**解析器的进度保证**：像表格但缺分隔行的输入不得让解析器死循环（实测踩到过一次挂起）。
 */
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, renderMarkdown } from "./build-docs-site.mjs";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const OUT = mkdtempSync(join(tmpdir(), "feronavi-docs-check-"));
try {
const r = buildSite(process.env.DOCS_DIR || undefined, OUT);

ok("现有公开文档和索引页已生成", r.pages.length > 0 && existsSync(join(OUT, "index.html")), r.pages.join(","));
ok("样式表随之生成", existsSync(join(OUT, "style.css")));

readFileSync(join(OUT, r.pages[0]), "utf8");
const heading = renderMarkdown("# Public heading");
ok("Markdown 标题被解析为带锚点的标题元素", /<h1 id="public-heading">Public heading<\/h1>/.test(heading), heading);
ok("每页提供完整导航", r.pages.every((file) => {
  const html = readFileSync(join(OUT, file), "utf8");
  return r.pages.every((target) => html.includes(`href="${target}"`));
}));

const xss = renderMarkdown("段落 <script>alert(1)</script> 与 `<b>` 混排");
ok("**HTML 被转义**（文档里的标签字面量不得变成真标签）", xss.includes("&lt;script&gt;") && !xss.includes("<script>"), xss.slice(0, 80));

// 进度保证：这类输入曾让解析器死循环
const t0 = Date.now();
const tricky = renderMarkdown("| 像表格但没有分隔行 |\n| 第二行 |\n普通段落");
ok("像表格但缺分隔行时不死循环（进度保证）", Date.now() - t0 < 1000 && tricky.includes("普通段落"), `${Date.now() - t0}ms`);

const code = renderMarkdown("```\nconst a = 1;\n```");
ok("围栏代码块被解析为 <pre><code>", code.includes("<pre><code>") && code.includes("const a = 1;"));
const list = renderMarkdown("- 甲\n- 乙\n\n1. 一\n2. 二");
ok("无序与有序列表分别解析", list.includes("<ul>") && list.includes("<ol>"), list.slice(0, 60));
const quote = renderMarkdown("> 引用里 `有代码`");
ok("引用块与行内代码", quote.includes("<blockquote>") && quote.includes("<code>"));

} finally { rmSync(OUT, { recursive: true, force: true }); }
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
