/**
 * 链接按钮 —— **外观像按钮、语义是链接**（用户要求：按场景区分 link 与 button）。
 *
 * 用在哪：**跳转**、**下载**、**外部地址**。
 * 好处（真按钮做不到的）：可以 Cmd/中键**新标签页打开**、可以**复制链接地址**、
 * 读屏软件会念成「链接」，浏览器状态栏显示目标地址 —— 这些是"动作按钮"不该冒充的。
 *
 * 用法：
 *   <LinkButton to="/projects/$projectId/board" params={{ projectId }}>看板</LinkButton>
 *   <LinkButton href="/api/v1/me/data-export" download>导出</LinkButton>
 *   <LinkButton href="https://…" target="_blank" rel="noreferrer">文档</LinkButton>
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { ButtonSize, ButtonVariant } from "./Button.tsx";
import { buttonClasses } from "./Button.tsx";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string;
  children?: ReactNode;
};

/** 站内跳转：TanStack Link（渲染真正的 <a>） */
export function LinkButton({
  to, params, variant = "secondary", size = "md", iconOnly = false, className = "", children, ...rest
}: Common & {
  to: string;
  params?: Record<string, string>;
  title?: string;
  "aria-label"?: string;
  "aria-current"?: "page" | undefined;
}) {
  return (
    <Link to={to as never} params={params as never} className={buttonClasses(variant, size, iconOnly, className)} {...rest}>
      {children}
    </Link>
  );
}

/** 外链 / 下载：原生 <a>（href 是真实地址，可新开、可复制） */
export function ExternalLinkButton({
  href, variant = "secondary", size = "md", iconOnly = false, className = "", children, ...rest
}: Common & {
  href: string;
  download?: boolean | string;
  target?: string;
  rel?: string;
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <a href={href} className={buttonClasses(variant, size, iconOnly, className)} {...rest}>
      {children}
    </a>
  );
}
