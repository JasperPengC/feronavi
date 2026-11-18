import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useCustomScrollbars } from "../src/client/lib/useCustomScrollbars.ts";

function HookHost() { useCustomScrollbars(); return null; }

function scrollable(className: string, left: number) {
  const element = document.createElement("div");
  element.className = className;
  Object.defineProperties(element, {
    clientWidth: { value: 300 }, scrollWidth: { value: 600 },
    clientHeight: { value: 400 }, scrollHeight: { value: 1200 },
  });
  element.getBoundingClientRect = () => ({ x: left, y: 60, left, top: 60, width: 300, height: 400, right: left + 300, bottom: 460, toJSON() {} });
  return element;
}

function addDialog(zIndex: number, left: number) {
  const scrim = document.createElement("div");
  scrim.className = "ui-drawer-scrim";
  scrim.style.position = "fixed";
  scrim.style.zIndex = String(zIndex);
  const dialog = document.createElement("aside");
  dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
  const body = scrollable("ui-drawer-body", left);
  dialog.append(body); scrim.append(dialog); document.body.append(scrim);
  return { scrim, body };
}

function verticalAt(left: number) {
  return [...document.querySelectorAll<HTMLElement>(".custom-scrollbar-thumb-y")].find((thumb) => thumb.style.left === `${left + 293}px`)!;
}

function pointer(target: EventTarget, type: string, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY, clientX: 295, cancelable: true }));
}

afterEach(() => { cleanup(); document.body.replaceChildren(); });

describe("自绘滚动条模态层级", () => {
  it("常驻滚动提示无需悬停，仍服从模态遮挡与页签隐藏", async () => {
    const background = scrollable("shell-content", 0);
    background.dataset.scrollbarPersistent = "";
    document.body.append(background);
    render(<HookHost />);
    await waitFor(() => expect(verticalAt(0)?.classList.contains("is-persistent")).toBe(true));
    const thumb = verticalAt(0);
    const { scrim } = addDialog(80, 400);
    await waitFor(() => expect(thumb.style.display).toBe("none"));
    expect(thumb.classList.contains("is-persistent")).toBe(false);
    scrim.remove();
    await waitFor(() => expect(thumb.classList.contains("is-persistent")).toBe(true));
    background.hidden = true;
    await waitFor(() => expect(thumb.style.display).toBe("none"));
    expect(thumb.classList.contains("is-persistent")).toBe(false);
  });

  it("抽屉打开后立即隐藏背景双轴滚动条，关闭后允许重新显示", async () => {
    const background = scrollable("shell-content", 0); document.body.append(background);
    render(<HookHost />);
    fireEvent.pointerOver(background);
    const thumb = verticalAt(0);
    expect(thumb.classList.contains("is-visible")).toBe(true);
    const { scrim, body } = addDialog(80, 400);
    await waitFor(() => expect(document.querySelectorAll(".custom-scrollbar-thumb-y")).toHaveLength(2));
    await waitFor(() => expect(thumb.style.display).toBe("none"));
    expect(thumb.classList.contains("is-visible")).toBe(false);
    fireEvent.scroll(background);
    expect(thumb.style.display).toBe("none");
    fireEvent.pointerOver(body);
    expect(verticalAt(400).classList.contains("is-visible")).toBe(true);
    expect(verticalAt(400).style.display).toBe("block");
    scrim.remove();
    await waitFor(() => expect(document.querySelectorAll(".custom-scrollbar-thumb-y")).toHaveLength(1));
    fireEvent.pointerOver(background);
    expect(thumb.style.display).toBe("block");
    expect(thumb.classList.contains("is-visible")).toBe(true);
  });

  it("最上层保留拖拽，下层抽屉即便收到事件也不能显示或拖动", async () => {
    const lower = addDialog(80, 0);
    render(<HookHost />);
    fireEvent.pointerOver(lower.body);
    const lowerThumb = verticalAt(0);
    const top = addDialog(81, 400);
    await waitFor(() => expect(document.querySelectorAll(".custom-scrollbar-thumb-y")).toHaveLength(2));
    fireEvent.pointerOver(top.body);
    const topThumb = verticalAt(400);
    topThumb.getBoundingClientRect = () => ({ x: 693, y: 60, left: 693, top: 60, width: 4, height: 133, right: 697, bottom: 193, toJSON() {} });
    pointer(topThumb, "pointerdown", 80); pointer(window, "pointermove", 180); pointer(window, "pointerup", 180);
    expect(top.body.scrollTop).toBeGreaterThan(0);
    fireEvent.pointerOver(lower.body);
    expect(lowerThumb.style.display).toBe("none");
    pointer(lowerThumb, "pointerdown", 80); pointer(window, "pointermove", 180); pointer(window, "pointerup", 180);
    expect(lower.body.scrollTop).toBe(0);
    expect(lowerThumb.classList.contains("is-visible")).toBe(false);
  });

  it("打开更高层时取消背景正在进行的拖拽，层级优先于 DOM 顺序", async () => {
    const background = scrollable("shell-content", 0); document.body.append(background);
    render(<HookHost />); fireEvent.pointerOver(background);
    const backgroundThumb = verticalAt(0);
    pointer(backgroundThumb, "pointerdown", 80);
    const top = addDialog(200, 400);
    const lower = addDialog(80, 800);
    await waitFor(() => expect(document.querySelectorAll(".custom-scrollbar-thumb-y")).toHaveLength(3));
    fireEvent.pointerOver(lower.body);
    fireEvent.pointerOver(top.body);
    pointer(window, "pointermove", 180);
    expect(background.scrollTop).toBe(0);
    expect(backgroundThumb.classList.contains("is-dragging")).toBe(false);
    expect(verticalAt(800)?.classList.contains("is-visible") ?? false).toBe(false);
    expect(verticalAt(400).style.display).toBe("block");
  });
});
