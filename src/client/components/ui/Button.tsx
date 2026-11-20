/**
 * 按钮基元（**动作**语义）—— 全站唯一按钮 API。
 *
 * 页面、抽屉和弹窗共用 `.btn` 及 styles/controls.css，不再提供第二套样式。
 * 尺寸由设计令牌决定；支持原生 ref，用于抽屉初始焦点及焦点归还。
 *
 * **语义纪律（用户要求）**：
 *   · 跳转 → 用 `<LinkButton>`（渲染 `<Link>`/`<a>`，可中键新开、可复制 URL、读屏为链接）
 *   · 动作（提交/删除/开关/弹窗）→ 用本组件 `<Button>`（渲染真正的 `<button>`）
 *   · **不要**用 `<button onClick={() => navigate()}>` 做跳转，也不要用链接做动作。
 */
import type { ComponentPropsWithRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** 与 .btn 的变体/尺寸类对应（secondary、md 是默认值，不额外加类） */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize, iconOnly = false, className = ""): string {
  return [
    "btn",
    "ui-button", // 只保留组件标记，不定义独立变体或尺寸。
    variant !== "secondary" ? `btn-${variant}` : "",
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
    iconOnly ? "btn-icon" : "",
    className,
  ].filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  iconOnly = false,
  children,
  className = "",
  disabled,
  ...props
}: ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconOnly?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={buttonClasses(variant, size, iconOnly, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="ui-button-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
