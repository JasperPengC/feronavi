/** 危险操作使用同一个确认对话框，不能直接执行或积累重复确认。 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ConfirmButton } from "../src/client/components/ui/ConfirmButton.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

afterEach(cleanup);
setLocale("zh-CN");

describe("ConfirmButton", () => {
  it("打开共享危险确认，重复点击不重复排队，确认后只执行一次", async () => {
    const fn = vi.fn();
    render(<><DialogHost /><ConfirmButton onConfirm={fn}>删除</ConfirmButton></>);
    const trigger = screen.getByRole("button", { name: "删除" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认删除？" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认" }).className).toContain("btn-danger");
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("取消确认不执行并恢复入口", async () => {
    const fn = vi.fn();
    render(<><DialogHost /><ConfirmButton onConfirm={fn} confirmText="确认归档？">归档</ConfirmButton></>);
    const trigger = screen.getByRole("button", { name: "归档" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "确认归档？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(fn).not.toHaveBeenCalled();
  });

  it("入口卸载后旧确认不能执行", async () => {
    const fn = vi.fn();
    const view = render(<><DialogHost /><ConfirmButton onConfirm={fn}>删除</ConfirmButton></>);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<><DialogHost /></>);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fn).not.toHaveBeenCalled();
  });

  it("确认期间入口权限被禁用，旧确认不能继续执行", async () => {
    const fn = vi.fn();
    const view = render(<><DialogHost /><ConfirmButton onConfirm={fn}>删除</ConfirmButton></>);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    view.rerender(<><DialogHost /><ConfirmButton disabled onConfirm={fn}>删除</ConfirmButton></>);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fn).not.toHaveBeenCalled();
  });
});
