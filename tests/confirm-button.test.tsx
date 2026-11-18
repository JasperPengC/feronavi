/** 危险操作二次确认（Round 98） */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ConfirmButton } from "../src/client/components/ui/ConfirmButton.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

afterEach(() => { cleanup(); vi.useRealTimers(); });
setLocale("zh-CN");

describe("ConfirmButton", () => {
  it("第一次点击只进入确认态，不执行；第二次才执行", () => {
    const fn = vi.fn();
    render(<ConfirmButton onConfirm={fn}>删除</ConfirmButton>);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认删除？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除？" }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  });

  it("4 秒无操作自动复位", () => {
    vi.useFakeTimers();
    render(<ConfirmButton onConfirm={vi.fn()}>删除</ConfirmButton>);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("button", { name: "确认删除？" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  });
});
