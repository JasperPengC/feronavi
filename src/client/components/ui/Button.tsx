/**
 * 按钮基元（**动作**语义）—— 全站唯一按钮 API。
 *
 * 为什么重写：站内曾**并存两套按钮**（`.btn` 99 处 / `ui-button` 5 处），
 * 且尺寸不同（32 vs --control-height）—— 这正是"各种不一致"的根源之一。
 * 现在统一为：**`ui/Button` 是唯一 API**，但它渲染**成熟的 `.btn` 类**
 * （老代码外观不变、新代码走组件），并保留 `ui-button` 钩子便于后续再演进。
 *
 * **语义纪律（用户要求）**：
 *   · 跳转 → 用 `<LinkButton>`（渲染 `<Link>`/`<a>`，可中键新开、可复制 URL、读屏为链接）
 *   · 动作（提交/删除/开关/弹窗）→ 用本组件 `<Button>`（渲染真正的 `<button>`）
 *   · **不要**用 `<button onClick={() => navigate()}>` 做跳转，也不要用链接做动作。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** 与 .btn 的变体/尺寸类对应（secondary、md 是默认值，不额外加类） */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize, iconOnly = false, className = ""): string {
  return [
    "btn",
    "ui-button",   // 仅作为标记钩子；**不再输出 ui-button-{variant,size}** ——
                   // 它们与 .btn 的尺寸规则冲突（实测：btn-sm 是 26px，ui-button-sm 是 30px，
                   // 后者胜出导致"新建"按钮从 26 变 30，是视觉回归；真实验收量出来的）
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
}: ButtonHTMLAttributes<HTMLButtonElement> & {
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
