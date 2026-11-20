import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";
import { Button } from "./Button.tsx";

import { OverlayDepth, isTopOverlay, registerOverlay } from "./overlay-stack.ts";

/**
 * 抽屉基元。
 *
 * `side` 决定贴边方向：left 从左滑入，right 从右滑入。
 * 关闭时**不能立刻卸载**，否则退场动画根本没机会播放；这里保留 DOM 到 exit 动画结束，
 * 遮罩、背景隔离与焦点约束持续到退场结束；关闭期间保留最后一帧内容。
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
  width = "md",
  side = "right",
  footer,
  className = "",
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: "sm" | "md" | "lg";
  side?: "left" | "right";
  footer?: ReactNode;
  className?: string;
}) {
  const depth = useContext(OverlayDepth);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const titleId = useId();

  // 父组件常用 inline onClose：若把它放进 effect 依赖，输入一次就会触发 cleanup，
  // 把焦点还给打开前的按钮，随后又聚焦关闭键 —— 表现就是“打一个字焦点跳走”。
  useLayoutEffect(() => { onCloseRef.current = onClose; openRef.current = open; }, [onClose, open]);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [content, setContent] = useState({ title, children, footer });
  if (open && (content.title !== title || content.children !== children || content.footer !== footer)) {
    setContent({ title, children, footer });
  }

  useLayoutEffect(() => {
    if (!open) return;
    if (!previousFocus.current) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setVisible(true);
    setClosing(false);
  }, [open]);

  // open=false 时先播放退场，再卸载；重新打开要取消未完成的退场
  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visible) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useLayoutEffect(() => {
    if (!visible || !scrimRef.current) return;
    const unregister = registerOverlay(titleId, depth, scrimRef.current);
    const isTop = () => isTopOverlay(titleId);
    if (isTop() && !panelRef.current?.contains(document.activeElement)) closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTop() || document.querySelector(".modal-scrim")) return;
      if (event.key === "Escape") { event.preventDefault(); if (openRef.current) onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const panel = scrimRef.current;
      const items = panel ? [...panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])',
      )].filter((el) => {
        if (el.offsetParent === null || el.matches(":disabled") || el.closest("[hidden], [inert]") || getComputedStyle(el).visibility === "hidden") return false;
        // 关闭的 details 里仍可能有 offsetParent，但只有它的 summary 能获得焦点。
        for (let ancestor = el.parentElement; ancestor && ancestor !== panel; ancestor = ancestor.parentElement) {
          if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
            const summary = [...ancestor.children].find((child) => child.tagName === "SUMMARY");
            if (!summary?.contains(el)) return false;
          }
        }
        return true;
      }) : [];
      if (items.length === 0) { event.preventDefault(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      // 新抽屉子项的 autoFocus 先于父级 layout effect，允许焦点进入刚挂载的上层。
      if (target.closest(".ui-drawer-scrim, .ui-modal-scrim, .modal-scrim")) return;
      if (isTop() && openRef.current && !document.querySelector(".modal-scrim")) closeRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      unregister();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    };
  }, [visible, depth, titleId]);

  if (!visible) return null;
  const phase = closing ? "is-closing" : "is-open";
  return createPortal(
    <div
      ref={scrimRef}
      className={`ui-drawer-scrim ui-drawer-scrim-${side} ${phase}`}
      style={{ zIndex: 80 + depth }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && open) onClose(); }}
    >
      <aside ref={panelRef} className={`ui-drawer ui-drawer-${width} ui-drawer-side-${side} ${phase} ${className}`}
        role="dialog" aria-modal="true" aria-labelledby={titleId} inert={!open}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open && event.animationName.startsWith("ui-drawer-out-")) {
            setVisible(false); setClosing(false);
          }
        }}>
        <header className="ui-drawer-header">
          <h2 id={titleId}>{content.title}</h2>
          <Button ref={closeRef} variant="ghost" iconOnly aria-label={t("common.close")} onClick={onClose}>
            <Icon name="x" />
          </Button>
        </header>
        <OverlayDepth.Provider value={depth + 1}>
          <div className="ui-drawer-body">{content.children}</div>
          {content.footer && <footer className="ui-drawer-footer">{content.footer}</footer>}
        </OverlayDepth.Provider>
      </aside>
      <div className="ui-drawer-popovers" hidden={!open} inert={!open} />
    </div>, document.body,
  );
}
