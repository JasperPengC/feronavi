/** 安全 Markdown 渲染：不开启原始 HTML，链接统一新窗口打开。 */
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./MermaidDiagram.tsx";
import { markdownLinkIssue, markdownLinkIssueLabel } from "../../../shared/markdown-links.ts";
import "./markdown-rich.css";

interface MarkdownNode { type: string; value?: string; url?: string; depth?: number; children?: MarkdownNode[] }
export interface MarkdownCitation { href: string; label: string }

/** 只处理正文文本；代码、既有链接、图片中的编号保持原样。 */
function citationPlugin(citations: MarkdownCitation[]) {
  return () => (tree: MarkdownNode) => {
    function walk(node: MarkdownNode) {
      if (!node.children || ["link", "image", "code", "inlineCode", "html"].includes(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) { walk(child); return [child]; }
        const parts: MarkdownNode[] = []; let offset = 0;
        for (const match of child.value.matchAll(/\[(\d+)\]/g)) {
          const citation = citations[Number(match[1]) - 1];
          if (!citation) continue;
          if (match.index! > offset) parts.push({ type: "text", value: child.value.slice(offset, match.index) });
          parts.push({ type: "link", url: citation.href, children: [{ type: "text", value: match[0] }] });
          offset = match.index! + match[0].length;
        }
        if (!parts.length) return [child];
        if (offset < child.value.length) parts.push({ type: "text", value: child.value.slice(offset) });
        return parts;
      });
    }
    walk(tree);
  };
}

/** 页面已显示同名标题时只省略首个纯文本标题；不改源文、版本或含链接的标题。 */
function documentTitlePlugin(title?: string) {
  return () => (tree: MarkdownNode) => {
    const first = tree.children?.[0];
    if (!title || first?.type !== "heading" || first.depth !== 1) return;
    function plainText(node: MarkdownNode): string | null {
      if (["text", "inlineCode"].includes(node.type)) return node.value ?? "";
      if (!["heading", "strong", "emphasis"].includes(node.type)) return null;
      const parts = (node.children ?? []).map(plainText);
      return parts.includes(null) ? null : parts.join("");
    }
    if (plainText(first)?.trim() === title.trim()) tree.children!.shift();
  };
}

export function MarkdownView({ text, draftImages, citations = [], streaming = false, documentTitle }: { text: string; draftImages?: ReadonlyMap<string, string>; citations?: MarkdownCitation[]; streaming?: boolean; documentTitle?: string }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, documentTitlePlugin(documentTitle), citationPlugin(citations)]}
        urlTransform={(url, key) => key === "src" && draftImages?.has(url) ? draftImages.get(url)!
          : markdownLinkIssue(url) ? url : defaultUrlTransform(url)}
        components={{
          a: ({ node: _node, ...props }) => {
            const issue = markdownLinkIssue(props.href ?? "");
            if (issue) return <span className="markdown-unavailable-link" title={`${markdownLinkIssueLabel(issue)}：${props.href ?? ""}`}>{props.children}</span>;
            const citation = citations.find(item => item.href === props.href);
            return citation ? <a {...props} className="markdown-citation" title={citation.label} aria-label={`${props.children} ${citation.label}`} /> : <a {...props} target="_blank" rel="noreferrer noopener" />;
          },
          pre: ({ node, children }) => {
            const code = node?.children[0];
            if (!streaming && code?.type === "element" && code.tagName === "code" && Array.isArray(code.properties.className) && code.properties.className.includes("language-mermaid")) {
              const source = code.children.filter(child => child.type === "text").map(child => child.value).join("");
              return <MermaidDiagram source={source.trimEnd()} />;
            }
            return <pre>{children}</pre>;
          },
          table: ({ node: _node, ...props }) => <div className="markdown-table-scroll" role="region" aria-label="Table" tabIndex={0}><table {...props} /></div>,
          img: ({ node: _node, ...props }) => {
            const src = typeof props.src === "string" ? props.src : "";
            const isDraft = draftImages && [...draftImages.values()].includes(src);
            const issue = isDraft ? null : markdownLinkIssue(src);
            return issue ? <span className="markdown-unavailable-link" title={`${markdownLinkIssueLabel(issue)}：${src}`}>{props.alt || "图片"}（无法加载）</span>
              : <img {...props} loading="lazy" decoding="async" />;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
