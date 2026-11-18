import type { HTMLAttributes, ReactNode } from "react";

/** 通用面板的唯一入口：标题和动作可选，padding/tone 由同一组样式控制。 */
export function Panel({ tone = "default", padding = "md", title, actions, children, className = "", ...props }: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "raised" | "soft";
  padding?: "none" | "sm" | "md" | "lg";
  children?: ReactNode;
}) {
  return <section {...props} className={["panel", "ui-panel", `ui-panel-${tone}`, `ui-panel-padding-${padding}`, className].filter(Boolean).join(" ")}>
    {(title || actions) && <div className="panel-head">
      {title && <strong className="panel-title">{title}</strong>}
      {actions && <div className="panel-actions">{actions}</div>}
    </div>}
    {children}
  </section>;
}
