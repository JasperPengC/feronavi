/**
 * 表单字段基元（前端表单统一化 第 1 步）
 *
 * 为什么需要它：此前 **20 个页面各自手写 `<input className="input">`**，
 * 标签、提示、错误、必填标记的写法各不相同 —— 这就是"表单组件不一致"。
 * CSS 里早就有 `.field / .hint / .error` 的约定（tokens.css），但**没有对应的 React 组件**，
 * 于是没人用它。本组件就是那层缺失的封装：**统一产出 .field 结构**。
 *
 * 自绘控件（Select / DatePicker / Checkbox）不是原生 input，`<label for>` 给不出可访问名称，
 * 所以额外提供 `labelId` / `descId`：控件用 `aria-labelledby` / `aria-describedby` 反指过来，
 * 与 TextInput 的"label 关联 + 错误播报"保持**同一套语义**。
 */
import type { ReactNode } from "react";

export function Field({
  label, hint, error, required, htmlFor, labelId, descId, children, className = "",
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  /** label 元素的 id（自绘控件用它做 aria-labelledby） */
  labelId?: string;
  /** hint / error 元素的 id（自绘控件用它做 aria-describedby） */
  descId?: string;
  children: ReactNode;
  className?: string;
}) {
  const hasError = error !== undefined && error !== null && error !== "";
  return (
    <div className={`field ${className}`.trim()}>
      {label !== undefined && (
        <label htmlFor={htmlFor} id={labelId}>
          {label}
          {required && <span aria-hidden="true" style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>}
        </label>
      )}
      {children}
      {hasError && (
        <span className="error" role="alert" id={descId}>{error}</span>
      )}
      {!hasError && hint !== undefined && (
        <span className="hint" id={descId}>{hint}</span>
      )}
    </div>
  );
}
