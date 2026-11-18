/** 安全 Markdown 渲染：不开启原始 HTML，链接统一新窗口打开。 */
import Markdown, { defaultUrlTransform } from "react-markdown";

export function MarkdownView({ text, draftImages }: { text: string; draftImages?: ReadonlyMap<string, string> }) {
  return (
    <div className="markdown-body">
      <Markdown
        urlTransform={(url, key) => key === "src" && draftImages?.has(url) ? draftImages.get(url)! : defaultUrlTransform(url)}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          img: ({ node: _node, ...props }) => <img {...props} loading="lazy" decoding="async" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
