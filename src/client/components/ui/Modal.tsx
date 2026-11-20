import { useContext, useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { OverlayDepth, isTopOverlay, registerOverlay } from "./overlay-stack.ts";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";
import { Button } from "./Button.tsx";

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
  const depth = useContext(OverlayDepth);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    if (!open || !scrimRef.current) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unregister = registerOverlay(titleId, depth, scrimRef.current);
    const panel = scrimRef.current;
    const focusables = () => panel ? [...panel.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null && !el.closest("[hidden], [inert]")) : [];
    const first = focusables()[0];
    if (!panel.contains(document.activeElement)) (first ?? panelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopOverlay(titleId) || document.querySelector(".modal-scrim")) return;
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { event.preventDefault(); return; }
      const firstItem = items[0]!, lastItem = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === firstItem || !panel?.contains(document.activeElement))) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && (document.activeElement === lastItem || !panel?.contains(document.activeElement))) { event.preventDefault(); firstItem.focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".ui-modal-scrim, .ui-drawer-scrim, .modal-scrim")) return;
      if (isTopOverlay(titleId) && !document.querySelector(".modal-scrim")) (panelRef.current?.querySelector<HTMLElement>("button") ?? panelRef.current)?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      unregister();
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open, titleId, depth]);
  if (!open) return null;
  return createPortal(
    <div ref={scrimRef} className="ui-modal-scrim" style={{ zIndex: 80 + depth }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} className={`ui-modal ui-modal-${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="ui-modal-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" iconOnly aria-label={t("common.close")} onClick={onClose}>
            <Icon name="x" />
          </Button>
        </header>
        <OverlayDepth.Provider value={depth + 1}>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
        </OverlayDepth.Provider>
      </div>
    </div>, document.body,
  );
}
