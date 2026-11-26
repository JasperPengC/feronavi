import { fromMarkdown } from "mdast-util-from-markdown";
import { DomainError } from "./errors.ts";
import { DOCUMENT_LINK_GUIDANCE, markdownLinkIssue, markdownLinkIssueLabel, type MarkdownLinkIssue } from "./markdown-links.ts";

export interface DocumentLinkIssue { url: string; line: number; column: number; reason: MarkdownLinkIssue }

/** 只检查实际 Markdown 链接；代码与未使用的引用定义不是网页跳转。 */
export function documentLinkIssues(content: string): DocumentLinkIssue[] {
  const root = fromMarkdown(content);
  type Node = typeof root | (typeof root.children)[number];
  const definitions = new Map<string, string>();
  const key = (identifier: string) => identifier.toUpperCase();
  const walk = (node: Node, visit: (node: Node) => void) => {
    visit(node);
    if ("children" in node) for (const child of node.children) walk(child, visit);
  };
  walk(root, node => {
    if (node.type === "definition" && !definitions.has(key(node.identifier))) definitions.set(key(node.identifier), node.url);
  });
  const issues: DocumentLinkIssue[] = [];
  walk(root, node => {
    const url = node.type === "link" || node.type === "image" ? node.url
      : node.type === "linkReference" || node.type === "imageReference" ? definitions.get(key(node.identifier)) : undefined;
    if (url === undefined) return;
    const reason = markdownLinkIssue(url);
    if (reason) issues.push({ url, line: node.position?.start.line ?? 1, column: node.position?.start.column ?? 1, reason });
  });
  return issues;
}

export function assertDocumentLinks(content: string): void {
  const issues = documentLinkIssues(content);
  if (!issues.length) return;
  const first = issues[0]!;
  throw new DomainError("VALIDATION", `文档第 ${first.line} 行：${markdownLinkIssueLabel(first.reason)}。${DOCUMENT_LINK_GUIDANCE}`, {
    field: "content", issues: issues.slice(0, 50), total: issues.length,
  });
}
