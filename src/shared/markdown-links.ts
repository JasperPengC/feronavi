/** 网页 Markdown 引用必须在其它成员的浏览器中有明确含义。 */
export type MarkdownLinkIssue = "LOCAL_PATH" | "RELATIVE_PATH" | "UNSUPPORTED_URL";

export const DOCUMENT_LINK_GUIDANCE = "链接请使用 http(s) 网页、带 page ID 的平台文档地址、平台附件地址或 #锚点。代码引用使用真实仓库 URL（建议固定 commit）；本地/相对文件路径仅作为行内代码或代码块展示，不能作为链接或图片目标。不要猜测仓库地址。";

export function markdownLinkIssue(raw: string): MarkdownLinkIssue | null {
  let value = raw.trim();
  try { value = decodeURIComponent(value); } catch { /* 保留无法解码的原值供协议检查。 */ }
  if (/^(?:file:|vscode(?:-insiders)?:|sandbox:|[a-z]:[\\/]|\\\\|~[\\/])/iu.test(value)
    || /^\/(?:Users|home|root|var|tmp|private|opt|usr|etc|mnt|Volumes|Applications|Library|Windows|Program Files|workspace|workspaces)(?:\/|$)/iu.test(value)) return "LOCAL_PATH";
  if (/^(?:https?:\/\/|mailto:)/iu.test(value)) return null;
  if (/^[#?]/u.test(value)) return null;
  if (/^\/(?![/\\])/u.test(value)) {
    // 根路径只接受明确的平台路由；任意本机绝对路径都不能猜成网页地址。
    // URL 按浏览器规则折叠 ..，再判定，避免 /projects/../Users 一类绕过。
    const path = new URL(value, "https://feronavi.invalid").pathname;
    return /^\/(?:projects(?:\/|$)|api\/v1\/attachments\/|workbench(?:\/|$)|settings(?:\/|$)|inbox(?:\/|$)|issues(?:\/|$)|focus(?:\/|$)|changelog(?:\/|$)|system(?:\/|$)|members(?:\/|$)|admin(?:\/|$)|tokens(?:\/|$)|assistant(?:\/|$)|intake(?:\/|$))/.test(path) || path === "/" ? null : "LOCAL_PATH";
  }
  if (!value || /^[a-z][a-z\d+.-]*:/iu.test(value)) return "UNSUPPORTED_URL";
  return "RELATIVE_PATH";
}

export function markdownLinkIssueLabel(reason: MarkdownLinkIssue): string {
  return reason === "LOCAL_PATH" ? "本地路径，无法通过网页访问" : reason === "RELATIVE_PATH" ? "相对文件路径，缺少可访问的目标地址" : "不支持的链接地址";
}
