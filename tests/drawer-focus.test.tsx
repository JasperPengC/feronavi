/** Drawer 焦点：父级 inline onClose 不能导致输入时焦点跳到关闭键 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { Drawer } from "../src/client/components/ui/Drawer.tsx";
import { confirmDialog, DialogHost } from "../src/client/components/Dialog.tsx";
import { t } from "../src/client/i18n/index.ts";
import { DatePicker } from "../src/client/components/DatePicker.tsx";

function Harness() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  return (
    <Drawer open={open} title="测试抽屉" onClose={() => setOpen(false)}>
      <input aria-label="输入框" value={value} onChange={(e) => setValue(e.target.value)} />
    </Drawer>
  );
}

afterEach(cleanup);

describe("Drawer 焦点", () => {
  it("抽屉中的日期弹层保持可操作，Escape 先关闭日期弹层", async () => {
    const close = vi.fn();
    const change = vi.fn();
    render(<Drawer open title="排期" onClose={close}>
      <DatePicker value="2026-11-07" onChange={change} ariaLabel="开始日期" />
    </Drawer>);
    fireEvent.click(screen.getByRole("button", { name: "开始日期" }));
    const calendar = await screen.findByRole("dialog", { name: "开始日期" });
    await act(async () => {}); // body MutationObserver 已完成背景隔离。
    expect(calendar.closest("[inert]")).toBeNull();
    const day = calendar.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!;
    day.focus();
    expect(document.activeElement).toBe(day);
    fireEvent.keyDown(day, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "开始日期" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "开始日期" }));
    fireEvent.click(screen.getByRole("button", { pressed: true }));
    expect(change).toHaveBeenCalledWith("2026-11-07");
  });

  it("关闭动画结束前持续隔离背景并保留抽屉内容，结束后恢复焦点", () => {
    vi.useFakeTimers();
    try {
      function ClosingDrawer() {
        const [item, setItem] = useState<string | null>(null);
        return <><button onClick={() => setItem("项目详情")}>打开</button>
          <Drawer open={!!item} title={item ?? ""} onClose={() => setItem(null)}>
            {item && <p>保留详情内容</p>}
          </Drawer></>;
      }
      const { container } = render(<ClosingDrawer />);
      const trigger = screen.getByRole("button", { name: "打开" });
      trigger.focus(); fireEvent.click(trigger);
      expect(container.hasAttribute("inert")).toBe(true);
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.click(screen.getByRole("button", { name: t("common.close") }));
      expect(document.querySelector(".ui-drawer.is-closing")?.textContent).toContain("保留详情内容");
      expect(container.hasAttribute("inert")).toBe(true);
      expect(document.body.style.overflow).toBe("hidden");
      act(() => vi.advanceTimersByTime(300));
      expect(document.querySelector(".ui-drawer")).toBeNull();
      expect(container.hasAttribute("inert")).toBe(false);
      expect(document.activeElement).toBe(trigger);
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it("输入时焦点停留在输入框，不被关闭键抢走", () => {
    render(<Harness />);
    const input = screen.getByLabelText("输入框");
    input.focus();
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    expect(document.activeElement).toBe(input);
  });

  it("嵌套编辑抽屉按 Escape 只关闭最上层，并将焦点还给编辑入口", async () => {
    const closeOuter = vi.fn();
    function Nested() {
      const [editing, setEditing] = useState(false);
      return <Drawer open title="详情" onClose={closeOuter}>
        <button onClick={() => setEditing(true)}>编辑详情</button>
        <Drawer open={editing} title="编辑" onClose={() => setEditing(false)}>
          <input aria-label="编辑标题" autoFocus />
        </Drawer>
      </Drawer>;
    }
    render(<Nested />);
    const trigger = screen.getByRole("button", { name: "编辑详情" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText("编辑标题"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(closeOuter).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("确认框的 Escape 只取消确认，不关闭下层抽屉", async () => {
    const close = vi.fn();
    render(<><DialogHost /><Drawer open title="草稿" onClose={close}>
      <button onClick={() => void confirmDialog("放弃草稿？")}>放弃</button>
    </Drawer></>);
    const trigger = screen.getByRole("button", { name: "放弃" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "放弃草稿？" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("焦点循环保留折叠分区的键盘入口", () => {
    // jsdom 没有布局；只模拟可见性，Tab 的默认跳转由浏览器验收。
    const offset = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
    try {
      render(<Drawer open title="分区详情" onClose={() => {}}>
        <button>发评论</button>
        <details><summary>附件</summary></details>
        <details><summary>关联与子项</summary></details>
        <details><summary>协作与工时</summary><button>隐藏的工时提交</button></details>
      </Drawer>);
      const comment = screen.getByRole("button", { name: "发评论" });
      comment.focus();
      // 仍有 summary 在后面，不能提前拦截 Tab 回到关闭按钮。
      expect(fireEvent.keyDown(comment, { key: "Tab" })).toBe(true);
      const last = screen.getByText("协作与工时");
      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
      const close = screen.getByRole("button", { name: t("common.close") });
      expect(document.activeElement).toBe(close);
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
    } finally { offset.mockRestore(); }
  });
});
