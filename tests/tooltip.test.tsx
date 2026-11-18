import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InfoTip } from "../src/client/components/ui/InfoTip.tsx";
import { Tooltip } from "../src/client/components/ui/Tooltip.tsx";

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("说明和图表提示交互", () => {
  it("聚焦后可读，点击不会因为 focus 后再次 toggle 而消失，Escape 只关闭提示", () => {
    const parentEscape = vi.fn();
    render(<div onKeyDown={parentEscape}><InfoTip text="按项目内工作项统计" label="说明" /></div>);
    const button = screen.getByRole("button", { name: "说明" });
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(screen.getByRole("tooltip").textContent).toBe("按项目内工作项统计");
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(parentEscape).not.toHaveBeenCalled();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("点击外部关闭，卸载后不会遗留气泡", () => {
    const { unmount } = render(<InfoTip text="说明正文" />);
    fireEvent.focus(screen.getByRole("button"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(screen.getByRole("button"));
    unmount();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("抽屉里的提示保留在抽屉层，避免被模态背景 inert 屏蔽", () => {
    render(<div className="ui-drawer-scrim"><div className="ui-drawer"><InfoTip text="抽屉说明" /></div><div className="ui-drawer-popovers" /></div>);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip").parentElement?.className).toBe("ui-drawer-popovers");
  });

  it("图表数据更新时保留当前提示并显示新值", () => {
    const chart = (count: number) => <Tooltip followPointer content={`活动 ${count}`}>{props => <button {...props}>数据点</button>}</Tooltip>;
    const { rerender } = render(chart(4));
    fireEvent.focus(screen.getByRole("button"));
    rerender(chart(8));
    expect(screen.getByRole("tooltip").textContent).toBe("活动 8");
  });

  it("表单弹窗的提示保持在弹窗层，不落到遮罩后面", () => {
    render(<div className="ui-modal-scrim"><div className="ui-modal"><InfoTip text="表单说明" /></div></div>);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip").parentElement?.className).toBe("ui-modal-scrim");
  });

  it("快速移动到下一个数据点时立即替换上一条提示", () => {
    render(<><InfoTip text="第一个说明" label="第一个" /><InfoTip text="第二个说明" label="第二个" /></>);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "第一个" }));
    fireEvent.pointerLeave(screen.getByRole("button", { name: "第一个" }));
    fireEvent.pointerEnter(screen.getByRole("button", { name: "第二个" }));
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toBe("第二个说明");
  });
});
