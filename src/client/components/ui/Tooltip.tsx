import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type DOMAttributes } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition } from "../../lib/tooltip-position.ts";

type TriggerProps = Pick<DOMAttributes<Element>, "onPointerEnter" | "onPointerMove" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "onClick"> & {
  "aria-describedby"?: string;
};

let activeTooltip: { id: string; dismiss: () => void } | null = null;

/** 不新增包裹元素，适用于按钮、HTML 图表及 SVG 数据点。 */
export function Tooltip({ content, children, followPointer = false, className = "" }: {
  content: ReactNode;
  children: (props: TriggerProps) => ReactNode;
  followPointer?: boolean;
  className?: string;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<{ element: Element; point?: { x: number; y: number } } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchWasOpen = useRef(false);
  const pointerType = useRef("");
  const cancelClose = () => clearTimeout(closeTimer.current);
  const close = () => {
    cancelClose(); setAnchor(null); setPosition(null);
    if (activeTooltip?.id === id) activeTooltip = null;
  };
  const show = (element: Element, point?: { x: number; y: number }) => {
    cancelClose();
    if (activeTooltip && activeTooltip.id !== id) activeTooltip.dismiss();
    activeTooltip = { id, dismiss: close };
    setAnchor({ element, point });
  };
  const leave = () => { cancelClose(); closeTimer.current = setTimeout(close, 100); };

  useEffect(() => () => {
    clearTimeout(closeTimer.current);
    if (activeTooltip?.id === id) activeTooltip = null;
  }, [id]);
  useLayoutEffect(() => {
    if (!anchor || !bubble.current) return;
    const update = () => {
      if (!anchor.element.isConnected) return close();
      const rect = anchor.element.getBoundingClientRect();
      const view = window.visualViewport;
      const width = view?.width ?? window.innerWidth;
      const height = view?.height ?? window.innerHeight;
      const offsetX = view?.offsetLeft ?? 0;
      const offsetY = view?.offsetTop ?? 0;
      const target = anchor.point
        ? { left: anchor.point.x, right: anchor.point.x, top: anchor.point.y, bottom: anchor.point.y }
        : rect;
      const result = tooltipPosition({ left: target.left - offsetX, right: target.right - offsetX, top: target.top - offsetY, bottom: target.bottom - offsetY }, bubble.current!.getBoundingClientRect(), { width, height }, !!anchor.point);
      setPosition({ left: result.left + offsetX, top: result.top + offsetY });
    };
    const onScroll = close;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bubble.current);
    observer.observe(anchor.element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", onScroll);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", onScroll);
    };
  }, [anchor, content]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    const onOutside = (event: PointerEvent) => {
      if (!anchor.element.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onOutside, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onOutside, true); };
  }, [anchor]);

  const trigger: TriggerProps = {
    "aria-describedby": anchor ? id : undefined,
    onPointerEnter: (event) => {
      if (event.pointerType === "touch") return;
      show(event.currentTarget, followPointer ? { x: event.clientX, y: event.clientY } : undefined);
    },
    onPointerMove: (event) => {
      if (followPointer && anchor && event.pointerType !== "touch") setAnchor({ element: event.currentTarget, point: { x: event.clientX, y: event.clientY } });
    },
    onPointerLeave: leave,
    onPointerDown: (event) => { pointerType.current = event.pointerType; touchWasOpen.current = !!anchor; },
    onFocus: (event) => show(event.currentTarget),
    onBlur: close,
    onClick: (event) => {
      if (pointerType.current === "touch" && touchWasOpen.current) close();
      else {
        show(event.currentTarget, followPointer && event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined);
      }
    },
  };
  const portal = anchor?.element.closest(".ui-drawer-scrim")?.querySelector(".ui-drawer-popovers")
    ?? anchor?.element.closest(".ui-modal-scrim, .modal-scrim") ?? document.body;
  return <>
    {children(trigger)}
    {anchor && createPortal(
      <div ref={bubble} id={id} role="tooltip" className={`ui-tooltip ${className}`}
        style={{ ...position, visibility: position ? "visible" : "hidden" }}
        onPointerEnter={cancelClose} onPointerLeave={leave}>
        {content}
      </div>, portal,
    )}
  </>;
}
