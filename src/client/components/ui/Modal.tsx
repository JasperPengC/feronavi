import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";

/** 表单型 Modal：页面级创建/编辑不再把表单平铺进内容区。 */
export function Modal({
  open, title, onClose, children, footer, width = "md",
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusables = () => panel ? [...panel.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null) : [];
    const first = focusables()[0];
    (first ?? panel)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector(".modal-scrim")) return;
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { event.preventDefault(); return; }
      const firstItem = items[0]!, lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="ui-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} className={`ui-modal ui-modal-${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="ui-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ui-button ui-button-ghost ui-button-md ui-button-icon" aria-label={t("common.close")} onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
