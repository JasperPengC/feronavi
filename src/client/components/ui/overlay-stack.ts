import { createContext } from "react";

/** 表单弹窗与抽屉共用层级、背景隔离和滚动锁，避免嵌套时相互覆盖状态。 */
export const OverlayDepth = createContext(0);
const active = new Map<string, { depth: number; scrim: HTMLElement }>();
const originalInert = new Map<HTMLElement, boolean>();
let originalOverflow = "";
let observer: MutationObserver | undefined;
const top = () => [...active].sort((a, b) => a[1].depth - b[1].depth).at(-1);
export const isTopOverlay = (id: string) => top()?.[0] === id;

function syncBackground() {
  const current = top()?.[1].scrim;
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement) || child.matches("script, style, .modal-scrim")) continue;
    if (!originalInert.has(child)) originalInert.set(child, child.hasAttribute("inert"));
    child.toggleAttribute("inert", child === current ? originalInert.get(child)! : true);
  }
}

export function registerOverlay(id: string, depth: number, scrim: HTMLElement) {
  if (active.size === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    observer = new MutationObserver(syncBackground);
    observer.observe(document.body, { childList: true });
  }
  active.set(id, { depth, scrim });
  syncBackground();
  return () => {
    active.delete(id);
    if (active.size) syncBackground();
    else {
      observer?.disconnect(); observer = undefined;
      for (const [element, value] of originalInert) element.toggleAttribute("inert", value);
      originalInert.clear();
      document.body.style.overflow = originalOverflow;
    }
  };
}
