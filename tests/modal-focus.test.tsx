import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../src/client/components/ui/Modal.tsx";
import { Drawer } from "../src/client/components/ui/Drawer.tsx";
import { DatePicker } from "../src/client/components/DatePicker.tsx";

afterEach(cleanup);

describe("表单弹窗与抽屉共享背景隔离", () => {
  it("弹窗阻止背景聚焦，关闭后恢复原始状态与入口焦点", () => {
    const parked = document.createElement("div"); parked.setAttribute("inert", ""); document.body.append(parked);
    function Form() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>新建</button><Modal open={open} title="表单" onClose={() => setOpen(false)}><input aria-label="名称" /></Modal></>; }
    const { container } = render(<Form />);
    try {
      const trigger = screen.getByRole("button", { name: "新建" }); trigger.focus(); fireEvent.click(trigger);
      expect(container.hasAttribute("inert")).toBe(true);
      expect(document.body.style.overflow).toBe("hidden");
      trigger.focus(); expect(document.activeElement).not.toBe(trigger);
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(container.hasAttribute("inert")).toBe(false);
      expect(parked.hasAttribute("inert")).toBe(true);
      expect(document.activeElement).toBe(trigger);
    } finally { parked.remove(); }
  });

  it("抽屉内弹窗只关闭最上层，恢复到抽屉并继续隔离页面", async () => {
    const closeDrawer = vi.fn();
    function Form() { const [open, setOpen] = useState(false); return <Drawer open title="详情" onClose={closeDrawer}><button onClick={() => setOpen(true)}>编辑</button><Modal open={open} title="编辑表单" onClose={() => setOpen(false)}><input aria-label="名称" /></Modal></Drawer>; }
    const { container } = render(<Form />);
    const trigger = screen.getByRole("button", { name: "编辑" }); trigger.focus(); fireEvent.click(trigger);
    expect(document.querySelector(".ui-drawer-scrim")?.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("dialog", { name: "编辑表单" }).closest("[inert]")).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(closeDrawer).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(container.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".ui-drawer-scrim")?.hasAttribute("inert")).toBe(false);
  });

  it("日期选择在弹窗内可聚焦，Escape先关闭日期层", async () => {
    const close=vi.fn(), change=vi.fn();
    render(<Modal open title="计划" onClose={close}><DatePicker value="2026-11-20" ariaLabel="开始日期" onChange={change} /></Modal>);
    fireEvent.click(screen.getByRole("button", { name: "开始日期" }));
    const calendar=await screen.findByRole("dialog", { name: "开始日期" });
    await act(async () => {});
    expect(calendar.closest("[inert]")).toBeNull();
    const selected=calendar.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!; selected.focus();
    expect(document.activeElement).toBe(selected);
    fireEvent.keyDown(selected, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "开始日期" })).toBeNull();
  });
});
