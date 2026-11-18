import { useEffect } from "react";

/**
 * 为壳层和动态面板启用覆盖式滚动条：原生滚动条始终隐藏，滚动时在 body 上绘制固定定位的 thumb。
 * thumb 不属于滚动容器的布局，所以滚动前后 clientWidth 与内容列位置保持不变。
 */
const SCROLLABLE_SELECTOR = [
  "[data-custom-scroll]",
  ".shell-content",
  ".shell-content > .page",
  ".shell-sidebar",
  ".table-scroll",
  ".board-column-body",
  ".palette-list",
  ".command-results",
  ".notification-popover",
  ".select-panel",
  ".ui-modal-body",
  ".ui-drawer-body",
  ".wiki-tree-scroll",
  ".wiki-layout",
  ".wiki-layout > .wiki-directory",
  ".wiki-layout > .wiki-editor-column",
  ".wiki-layout > .wiki-rag-column",
  ".role-admin-page .ui-tree-layout-side > .ui-tree",
  ".role-editor",
  ".role-assignments",
  ".workflow-grid > .card",
  ".table-view-table",
  ".data-page .ui-tree-layout-side",
  ".data-page .members-dept-side",
  ".data-page .side-col",
  ".data-page .milestone-data-layout > aside",
  ".data-page .custom-field-compose",
  ".data-page .issues-summary",
  ".data-page .issues-filterbar",
  ".data-page .audit-toolbar",
  ".data-page .table-view-toolbar",
  ".data-page .project-activity-controls",
  ".data-page .issues-overview-section",
  ".data-page #tokens-panel-tokens > .card:not(.token-table-card)",
].join(",");

type ScrollbarRecord = {
  element: HTMLElement;
  vertical: HTMLSpanElement;
  horizontal: HTMLSpanElement;
  fadeTimer?: ReturnType<typeof setTimeout>;
  dragging?: "y" | "x";
  cancelDrag?: () => void;
};

function topModal(): HTMLElement | null {
  let top: HTMLElement | null = null;
  let topZ = -Infinity;
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')) {
    if (dialog.closest("[inert], [hidden]")) continue;
    const layer = dialog.closest<HTMLElement>(".ui-drawer-scrim, .modal-scrim, .ui-modal-scrim") ?? dialog;
    const style = getComputedStyle(layer);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const zIndex = Number.parseInt(style.zIndex, 10) || 0;
    if (zIndex >= topZ) { top = dialog; topZ = zIndex; }
  }
  return top;
}

function createThumb(axis: "y" | "x") {
  const thumb = document.createElement("span");
  thumb.className = `custom-scrollbar-thumb custom-scrollbar-thumb-${axis}`;
  thumb.setAttribute("aria-hidden", "true");
  document.body.appendChild(thumb);
  return thumb;
}

function setThumbGeometry(
  thumb: HTMLSpanElement,
  element: HTMLElement,
  axis: "y" | "x",
) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
    thumb.style.display = "none";
    return false;
  }

  if (axis === "y") {
    const maxScroll = element.scrollHeight - element.clientHeight;
    if (maxScroll <= 0 || element.clientHeight <= 0) {
      thumb.style.display = "none";
      return false;
    }
    const track = rect.height;
    const size = Math.max(24, Math.round(track * element.clientHeight / element.scrollHeight));
    const travel = Math.max(0, track - size);
    const position = rect.top + (element.scrollTop / maxScroll) * travel;
    thumb.style.display = "block";
    thumb.style.left = `${Math.round(rect.right - 7)}px`;
    thumb.style.top = `${Math.round(position)}px`;
    thumb.style.height = `${Math.round(size)}px`;
    return true;
  }

  const maxScroll = element.scrollWidth - element.clientWidth;
  if (maxScroll <= 0 || element.clientWidth <= 0) {
    thumb.style.display = "none";
    return false;
  }
  const track = rect.width;
  const size = Math.max(24, Math.round(track * element.clientWidth / element.scrollWidth));
  const travel = Math.max(0, track - size);
  const position = rect.left + (element.scrollLeft / maxScroll) * travel;
  thumb.style.display = "block";
  thumb.style.left = `${Math.round(position)}px`;
  thumb.style.top = `${Math.round(rect.bottom - 7)}px`;
  thumb.style.width = `${Math.round(size)}px`;
  return true;
}

export function useCustomScrollbars() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const records = new Map<HTMLElement, ScrollbarRecord>();
    let frame = 0;
    let resizeObserver: ResizeObserver | undefined;

    const canInteract = (element: HTMLElement) => {
      const modal = topModal();
      return !element.closest("[inert], [hidden]") && (!modal || modal.contains(element));
    };
    const hideRecord = (record: ScrollbarRecord) => {
      record.cancelDrag?.();
      if (record.fadeTimer) clearTimeout(record.fadeTimer);
      record.fadeTimer = undefined;
      for (const thumb of [record.vertical, record.horizontal]) {
        thumb.classList.remove("is-visible", "is-dragging", "is-persistent");
        thumb.style.display = "none";
      }
    };

    const updateRecord = (record: ScrollbarRecord) => {
      if (!record.element.isConnected) return;
      if (!canInteract(record.element)) { hideRecord(record); return; }
      setThumbGeometry(record.vertical, record.element, "y");
      setThumbGeometry(record.horizontal, record.element, "x");
      const persistent = record.element.hasAttribute("data-scrollbar-persistent");
      record.vertical.classList.toggle("is-persistent", persistent);
      record.horizontal.classList.toggle("is-persistent", persistent);
    };

    const updateAll = () => {
      frame = 0;
      records.forEach((record, element) => {
        if (!element.isConnected) {
          hideRecord(record);
          resizeObserver?.unobserve(element);
          record.vertical.remove();
          record.horizontal.remove();
          records.delete(element);
          return;
        }
        updateRecord(record);
      });
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateAll);
    };

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
    }

    const markScrollables = () => {
      document.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR).forEach((element) => {
        element.dataset.customScroll = "true";
        if (!records.has(element)) {
          const vertical = createThumb("y");
          const horizontal = createThumb("x");
          const record: ScrollbarRecord = { element, vertical, horizontal };
          vertical.addEventListener("pointerdown", (event) => startDrag(record, "y", event));
          horizontal.addEventListener("pointerdown", (event) => startDrag(record, "x", event));
          records.set(element, record);
          resizeObserver?.observe(element);
        }
      });
      scheduleUpdate();
    };

    const showRecord = (record: ScrollbarRecord, fade = true) => {
      if (!canInteract(record.element)) { hideRecord(record); return; }
      updateRecord(record);
      record.vertical.classList.add("is-visible");
      record.horizontal.classList.add("is-visible");
      if (record.fadeTimer) clearTimeout(record.fadeTimer);
      record.fadeTimer = fade && !record.dragging ? setTimeout(() => {
        record.vertical.classList.remove("is-visible");
        record.horizontal.classList.remove("is-visible");
        record.fadeTimer = undefined;
      }, 680) : undefined;
    };

    const startDrag = (record: ScrollbarRecord, axis: "y" | "x", event: PointerEvent) => {
      const element = record.element;
      const thumb = axis === "y" ? record.vertical : record.horizontal;
      if (!canInteract(element) || !thumb.classList.contains("is-visible")) return;
      event.preventDefault();
      event.stopPropagation();
      const elementRect = element.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      const startClient = axis === "y" ? event.clientY : event.clientX;
      const startScroll = axis === "y" ? element.scrollTop : element.scrollLeft;
      const track = axis === "y" ? elementRect.height : elementRect.width;
      const thumbSize = axis === "y" ? thumbRect.height : thumbRect.width;
      const maxScroll = axis === "y"
        ? element.scrollHeight - element.clientHeight
        : element.scrollWidth - element.clientWidth;
      const travel = Math.max(1, track - thumbSize);
      record.dragging = axis;
      thumb.classList.add("is-dragging");
      showRecord(record, false);
      const move = (ev: PointerEvent) => {
        if (!canInteract(element)) { hideRecord(record); return; }
        const delta = (axis === "y" ? ev.clientY : ev.clientX) - startClient;
        const next = startScroll + (delta / travel) * maxScroll;
        if (axis === "y") element.scrollTop = next;
        else element.scrollLeft = next;
      };
      const cancel = () => {
        record.dragging = undefined;
        record.cancelDrag = undefined;
        thumb.classList.remove("is-dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      const end = () => {
        cancel();
        showRecord(record, true);
      };
      record.cancelDrag = cancel;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
      window.addEventListener("pointercancel", end, { once: true });
    };

    const recordAt = (target: EventTarget | null): ScrollbarRecord | null => {
      if (!(target instanceof Element)) return null;
      const element = target.closest<HTMLElement>(SCROLLABLE_SELECTOR);
      return element ? records.get(element) ?? null : null;
    };
    const onPointerOver = (event: PointerEvent) => {
      const record = recordAt(event.target);
      if (record) showRecord(record, false);
    };
    const onPointerOut = (event: PointerEvent) => {
      const record = recordAt(event.target);
      if (!record || record.dragging) return;
      if (event.relatedTarget instanceof Node && record.element.contains(event.relatedTarget)) return;
      showRecord(record, true);
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const record = records.get(target);
      if (record) showRecord(record);
    };

    const onResize = () => scheduleUpdate();

    markScrollables();
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    window.addEventListener("resize", onResize);

    const observer = new MutationObserver(markScrollables);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "aria-modal", "hidden"] });

    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      resizeObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      records.forEach((record) => {
        record.cancelDrag?.();
        if (record.fadeTimer) clearTimeout(record.fadeTimer);
        record.vertical.remove();
        record.horizontal.remove();
      });
      records.clear();
    };
  }, []);
}
