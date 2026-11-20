/** 安全 Markdown 渲染：不开启原始 HTML，链接统一新窗口打开。 */
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./MermaidDiagram.tsx";
import "./markdown-rich.css";

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }
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

export function MarkdownView({ text, draftImages, citations = [], streaming = false }: { text: string; draftImages?: ReadonlyMap<string, string>; citations?: MarkdownCitation[]; streaming?: boolean }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, citationPlugin(citations)]}
        urlTransform={(url, key) => key === "src" && draftImages?.has(url) ? draftImages.get(url)! : defaultUrlTransform(url)}
        components={{
          a: ({ node: _node, ...props }) => {
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
          img: ({ node: _node, ...props }) => <img {...props} loading="lazy" decoding="async" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
