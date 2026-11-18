/**
 * 多行文本基元 —— Field + `<textarea className="textarea">`。
 * 与 TextInput 同一套 label/hint/error/required 语义，保证表单一致。
 */
import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import type { ReactNode } from "react";
import { Field } from "./Field.tsx";

export function TextArea({
  label, hint, error, required, id, className = "", inputClassName = "", rows = 4, ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  /** 控件本身的类名（外层 .field 用 className） */
  inputClassName?: string;
}) {
  const auto = useId();
  const areaId = id ?? auto;
  const areaProps = {
    id: areaId,
    className: `textarea ${inputClassName}`.trim(),
    rows,
    required,
    "aria-invalid": error ? true : undefined,
    ...props,
  } as const;
  // 不传 label/hint/error/required 时**就是原生 textarea**（DOM 与手写完全一致）
  if (label === undefined && hint === undefined && error === undefined && !required) {
    return <textarea {...areaProps} />;
  }
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={areaId} className={className}>
      <textarea {...areaProps} />
    </Field>
  );
}
