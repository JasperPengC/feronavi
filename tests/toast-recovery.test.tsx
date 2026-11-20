import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastHost, toast } from "../src/client/components/ui/Toast.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

afterEach(() => {
  screen.queryAllByRole("button", { name: "关闭" }).forEach((button) => fireEvent.click(button));
  cleanup(); vi.useRealTimers();
});

it("错误保留至关闭，普通成功消息仍自动消失", () => {
  vi.useFakeTimers(); setLocale("zh-CN"); render(<ToastHost />);
  act(() => { toast.error("保存失败，请重新加载后重试"); toast.success("已完成"); });
  act(() => { vi.advanceTimersByTime(20_000); });
  expect(screen.getByRole("alert").textContent).toContain("保存失败");
  expect(screen.queryByText("已完成")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("连续失败只保留最近三条反馈，避免遮挡整个页面", () => {
  setLocale("zh-CN"); render(<ToastHost />);
  act(() => { for (let i = 0; i < 10; i++) toast.error(`错误 ${i}`); });
  expect(screen.getAllByRole("alert")).toHaveLength(3);
  expect(screen.queryByText("错误 0")).toBeNull();
  expect(screen.getByText("错误 9")).toBeTruthy();
});
