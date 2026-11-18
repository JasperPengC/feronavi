/**
 * 危险操作二次确认按钮（Round 98）：第一次点击不执行，只把按钮变成「确认删除？」；
 * 第二次点击才真正执行。4 秒无操作自动复位，避免误点后一直处于确认态。
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import type { ComponentProps, ReactNode } from "react";
import { t } from "../../i18n/index.ts";

type ConfirmProps = ComponentProps<typeof Button> & {
  onConfirm: () => void;
  children: ReactNode;
  confirmText?: string;
};
export function ConfirmButton({ onConfirm, children, confirmText, disabled, ...props }: ConfirmProps) {
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);
  return (
    <Button
      {...props}
      variant="danger"
      disabled={disabled}
      onClick={(e) => {
        if (!pending) {
          e.preventDefault();
          setPending(true);
          clear();
          timer.current = setTimeout(() => setPending(false), 4000);
          return;
        }
        clear();
        setPending(false);
        onConfirm();
      }}
    >
      {pending ? (confirmText ?? t("common.confirmDelete")) : children}
    </Button>
  );
}
