import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PageHead, PageGrid } from "../src/client/components/Page.tsx";
import { ToastHost, toast } from "../src/client/components/ui/Toast.tsx";

describe("壳层共享布局", () => {
  it("页面标题行保持统一语义结构", () => {
    render(<PageHead title="项目总览" sub="查看需要你关注的工作" actions={<button>新建</button>} />);
    expect(screen.getByRole("heading", { name: "项目总览" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建" })).toBeTruthy();
  });

  it("主辅列布局保留可识别的区域语义", () => {
    render(<PageGrid main={<div>主内容</div>} side={<aside>辅助内容</aside>} />);
    expect(screen.getByText("主内容").parentElement?.className).toContain("main-col");
    expect(screen.getByText("辅助内容").parentElement?.className).toContain("side-col");
  });

  it("toast 提供全局状态反馈并带 live region", async () => {
    render(<ToastHost />);
    toast.success("已保存");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"));
  });
});
