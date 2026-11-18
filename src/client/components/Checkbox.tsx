/**
 * 系统自绘勾选框（替代 <input type="checkbox">）—— 外壳重做第 9 轮，用户要求第 4 条。
 *
 * 为什么不用原生 + `appearance: none`：那样虽然能改外观，但**尺寸、基线、命中区仍受浏览器控制**，
 * 而且在不同浏览器上 `appearance` 的表现并不一致。用**按钮 + role="checkbox"**：
 *   · Space/Enter 由按钮语义原生提供（不需要自己写按键处理）；
 *   · 读屏播报"复选框，已选中/未选中"由 `role` + `aria-checked` 提供；
 *   · 外观、尺寸、命中区完全由本系统控制，且与按钮体系共用 token。
 * 若没有可见文字标签，**必须**传 `ariaLabel`（否则读屏只听到"复选框"）。
 *
 * 表单语义（与 TextInput/Select/DatePicker 同一套）：`label` 是**控件旁**的可见文字；
 * `hint` / `error` / `required` 与 Field 一致 —— 有错误时错误显示在控件下方并用 `role="alert"`。
 */
import { useId } from "react";
import { Icon } from "./Icon.tsx";

export function Checkbox({
  checked, onChange, ariaLabel, label, disabled, size = "md", hint, error, required,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
}) {
  const autoId = useId();
  const descId = hint !== undefined || error !== undefined ? `${autoId}-desc` : undefined;
  const hasError = error !== undefined && error !== null && error !== "";
  const control = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-required={required || undefined}
      aria-invalid={hasError || undefined}
      aria-describedby={descId}
      className="checkbox"
      data-size={size}
      data-checked={checked ? "true" : "false"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="checkbox-box" aria-hidden="true">{checked && <Icon name="check" size={size === "sm" ? 10 : 12} />}</span>
      {label && <span className="checkbox-label">{label}</span>}
    </button>
  );
  // 无 hint/error 时**不改变原有 DOM**（现在 6 处调用的 DOM 与外观都保持不变）
  if (hint === undefined && error === undefined) return control;
  return (
    <div className="checkbox-field">
      {control}
      {hasError
        ? <span className="error" role="alert" id={descId}>{error}</span>
        : hint !== undefined && <span className="hint" id={descId}>{hint}</span>}
    </div>
  );
}
