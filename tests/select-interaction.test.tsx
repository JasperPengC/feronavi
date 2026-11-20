import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Select } from "../src/client/components/Select.tsx";
import { Drawer } from "../src/client/components/ui/Drawer.tsx";

afterEach(cleanup);
const options = Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: `选项 ${i}` }));
function Example({ searchable = false }: { searchable?: boolean }) {
  const [value, setValue] = useState("20");
  return <><Select ariaLabel="选择项目" value={value} onChange={setValue} options={options} searchable={searchable} /><button>下一项</button></>;
}

describe("统一下拉交互", () => {
  it("身份选项区分姓名和账号，按账号搜索且占位提示不可选择", () => {
    const change = vi.fn();
    render(<Select ariaLabel="成员" value="" onChange={change} searchable placeholder="选择成员" options={[
      { value: "", label: "选择成员" },
      { value: "m1", label: "研发成员", secondaryLabel: "@engineering-account" },
      { value: "m2", label: "测试成员", secondaryLabel: "@quality-account" },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "成员" }));
    expect(screen.queryByRole("option", { name: "选择成员" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "engineering-account" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("@engineering-account").className).toBe("select-option-secondary");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(change).toHaveBeenCalledWith("m1");
  });

  it("表单进入禁用状态时关闭已打开的浮层", () => {
    const { rerender } = render(<fieldset><Example /></fieldset>);
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    rerender(<fieldset disabled><Example /></fieldset>);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("打开时定位已选项，方向键及首末键移动，提交后恢复触发器焦点", () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "选择项目" });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(document.activeElement).toBe(list);
    expect(document.getElementById(list.getAttribute("aria-activedescendant")!)?.textContent).toContain("选项 20");
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(trigger.textContent).toContain("选项 28");
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(document.getElementById(screen.getByRole("listbox").getAttribute("aria-activedescendant")!)?.textContent).toContain("选项 28");
  });

  it("搜索提交和取消都恢复焦点，重新打开不会残留上次过滤", () => {
    render(<Example searchable />);
    const trigger = screen.getByRole("button", { name: "选择项目" });
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox");
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "选项 29" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(trigger.textContent).toContain("选项 29");
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(30);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "不存在" } });
    expect(screen.getByRole("combobox").hasAttribute("aria-activedescendant")).toBe(false);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("中文输入法确认候选词时不提前提交选项", () => {
    render(<Example searchable />);
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(document.activeElement).toBe(search);
  });

  it("抽屉中的 Escape 只先关闭下拉，弹层留在模态作用域内", () => {
    const close = vi.fn();
    render(<Drawer open onClose={close} title="编辑项目"><Example /></Drawer>);
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    const list = screen.getByRole("listbox");
    expect(list.closest(".ui-drawer-scrim")).toBeTruthy();
    fireEvent.keyDown(list, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
