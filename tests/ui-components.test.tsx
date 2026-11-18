import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Button } from "../src/client/components/ui/Button.tsx";
import { Drawer } from "../src/client/components/ui/Drawer.tsx";
import { StateBlock } from "../src/client/components/ui/StateBlock.tsx";

describe("共享 UI 组件", () => {
  it("loading 按钮不可重复提交并暴露忙碌状态", () => {
    render(<Button loading>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".ui-button-spinner")).toBeTruthy();
  });

  it("错误状态使用 alert 语义并提供动作", () => {
    const onRetry = () => undefined;
    render(<StateBlock kind="error" title="加载失败" description="请稍后再试" action={onRetry} actionLabel="重试" />);
    expect(screen.getByRole("alert").textContent).toContain("加载失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("抽屉 Escape 关闭并将焦点返回触发按钮", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>打开详情</button>
        <Drawer open={open} title="详情" onClose={() => setOpen(false)}>正文</Drawer>
      </>;
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "打开详情" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "详情" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    // 关闭需要保留 DOM 播完退场动画，再卸载；断言要等动画结束
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "详情" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
