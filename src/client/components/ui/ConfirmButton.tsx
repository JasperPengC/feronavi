/** 所有危险操作复用全站确认对话框，原调用方保留权限及提交状态。 */
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import type { ComponentProps, ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { confirmDialog } from "../Dialog.tsx";

type ConfirmProps = ComponentProps<typeof Button> & {
  onConfirm: () => void;
  children: ReactNode;
  confirmText?: string;
};
export function ConfirmButton({ onConfirm, children, confirmText, disabled, ...props }: ConfirmProps) {
  const [pending, setPending] = useState(false);
  const confirming = useRef(false);
  const mounted = useRef(true);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return (
    <Button
      {...props}
      variant="danger"
      disabled={disabled}
      aria-disabled={disabled || pending}
      aria-haspopup="dialog"
      onClick={async (e) => {
        e.preventDefault();
        if (confirming.current || disabledRef.current) return;
        confirming.current = true;
        setPending(true);
        try {
          if (await confirmDialog(confirmText ?? t("common.confirmDelete"), { danger: true })
            && mounted.current && !disabledRef.current) onConfirm();
        } finally {
          confirming.current = false;
          if (mounted.current) setPending(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
