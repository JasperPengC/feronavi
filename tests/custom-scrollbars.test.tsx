import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCustomScrollbars } from "../src/client/lib/useCustomScrollbars.ts";
import { Drawer } from "../src/client/components/ui/Drawer.tsx";
import { Select } from "../src/client/components/Select.tsx";

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
  it("真实抽屉中的下拉滚动条处于可交互模态层，仍可拖拽", async () => {
    render(<><HookHost /><Drawer open onClose={() => {}} title="下拉测试">
      <Select ariaLabel="测试列表" value="0" onChange={() => {}}
        options={Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: `选项 ${i}` }))} />
    </Drawer></>);
    fireEvent.click(screen.getByRole("button", { name: "测试列表" }));
    const list = screen.getByRole("listbox");
    Object.defineProperties(list, {
      clientWidth: { value: 300 }, scrollWidth: { value: 300 },
      clientHeight: { value: 400 }, scrollHeight: { value: 1200 },
    });
    list.getBoundingClientRect = () => ({ x: 800, y: 60, left: 800, top: 60, width: 300, height: 400, right: 1100, bottom: 460, toJSON() {} });
    await waitFor(() => expect(verticalAt(800)).toBeTruthy());
    const thumb = verticalAt(800);
    expect(thumb.closest(".ui-drawer-scrim")).toBe(list.closest(".ui-drawer-scrim"));
    expect(thumb.closest("[inert]")).toBeNull();
    fireEvent.scroll(list);
    thumb.getBoundingClientRect = () => ({ x: 1093, y: 60, left: 1093, top: 60, width: 4, height: 133, right: 1097, bottom: 193, toJSON() {} });
    pointer(thumb, "pointerdown", 80); pointer(window, "pointermove", 180); pointer(window, "pointerup", 180);
    expect(list.scrollTop).toBeGreaterThan(0);
    expect(screen.getByRole("listbox")).toBe(list);
  });

  it("下拉选项仅在滚动时显示浮动滚动条，停止后淡出，移入移出不唤醒", async () => {
    const list = scrollable("select-options", 0);
    list.dataset.scrollbarScrollOnly = "";
    document.body.append(list);
    render(<HookHost />);
    await waitFor(() => expect(verticalAt(0)).toBeTruthy(), { timeout: 1000 });
    const thumb = verticalAt(0);
    expect(thumb.classList.contains("is-visible")).toBe(false);
    fireEvent.pointerOver(list);
    expect(thumb.classList.contains("is-visible")).toBe(false);
    fireEvent.scroll(list);
    expect(thumb.classList.contains("is-visible")).toBe(true);
    await waitFor(() => expect(thumb.classList.contains("is-visible")).toBe(false), { timeout: 1500 });
    fireEvent.pointerOut(list);
    fireEvent.pointerOver(list);
    expect(thumb.classList.contains("is-visible")).toBe(false);
    list.remove();
    await waitFor(() => expect(thumb.isConnected).toBe(false));
  });

  it("抽屉内与内容同层的下拉浮层可滚动，背景下拉仍被遮挡", async () => {
    const background = scrollable("select-options", 0);
    document.body.append(background);
    const { scrim } = addDialog(80, 400);
    const popovers = document.createElement("div");
    popovers.className = "ui-drawer-popovers";
    const list = scrollable("select-options", 800);
    popovers.append(list); scrim.append(popovers);
    render(<HookHost />);
    await waitFor(() => expect(verticalAt(800)).toBeTruthy(), { timeout: 1000 });
    fireEvent.scroll(list);
    expect(verticalAt(800).style.display).toBe("block");
    expect(verticalAt(800).classList.contains("is-visible")).toBe(true);
    fireEvent.scroll(background);
    expect([...document.querySelectorAll<HTMLElement>(".custom-scrollbar-thumb-y")]
      .filter(thumb => thumb.style.display === "block")).toHaveLength(2);
  });

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
