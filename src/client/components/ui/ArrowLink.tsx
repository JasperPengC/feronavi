/**
 * 卡片跳转链接（Round 92 设计基线）：**纯文字 + 右箭头 icon**，禁止按钮化/下划线。
 *
 * 用于卡片标题栏的「查看全部 →」「项目 →」这类跳转；语义仍是 <a>/<Link>，
 * 可中键新开、可复制 URL、读屏为链接；视觉上不是按钮。
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Icon } from "../Icon.tsx";

type Base = { children: ReactNode; className?: string; title?: string; "aria-label"?: string };
type Internal = Base & { to: string; params?: Record<string, string>; href?: never };
type External = Base & { href: string; target?: string; rel?: string; download?: boolean | string; to?: never; params?: never };

export function ArrowLink(props: Internal | External) {
  const content = (
    <>
      <span className="arrow-link-text">{props.children}</span>
      <Icon name="arrow" size={13} />
    </>
  );
  const cls = `arrow-link${props.className ? ` ${props.className}` : ""}`;
  if ("href" in props && props.href) {
    const { href, target, rel, download, children: _children, ...rest } = props;
    void _children;
    return <a className={cls} href={href} target={target} rel={rel} download={download} {...rest}>{content}</a>;
  }
  const { to, params, children: _children, ...rest } = props as Internal;
  void _children;
  return <Link className={cls} to={to as never} params={params as never} {...rest}>{content}</Link>;
}
