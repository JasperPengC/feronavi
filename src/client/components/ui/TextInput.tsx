/**
 * 文本输入基元 —— Field + `<input className="input">` 的统一封装。
 *
 * 用法：`<TextInput label="名称" value={v} onValueChange={setV} required hint="…" />`
 * —— 页面里**不再手写 label/input/错误提示三件套**，这是"表单组件一致"的落点。
 */
import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import type { ReactNode } from "react";
import { Field } from "./Field.tsx";

export function TextInput({
  label, hint, error, required, id, className = "", inputClassName = "", ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  /** 控件本身的类名（外层 .field 用 className） */
  inputClassName?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const inputProps = {
    id: inputId,
    className: `input ${inputClassName}`.trim(),
    required,
    "aria-invalid": error ? true : undefined,
    ...props,
  } as const;
  // 不传 label/hint/error/required 时**就是原生 input**（DOM 与手写完全一致）——
  // 工具栏/快速添加这类紧凑形态也能用基元统一，而不会被多包一层 .field。
  if (label === undefined && hint === undefined && error === undefined && !required) {
    return <input {...inputProps} />;
  }
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={className}>
      <input {...inputProps} />
    </Field>
  );
}
