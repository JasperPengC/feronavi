import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "../src/client/routes/ThemeToggle.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
import { readTheme, setTheme } from "../src/client/lib/theme.ts";
import { apiPut } from "../src/client/lib/api.ts";

vi.mock("../src/client/lib/api.ts", () => ({ apiPut: vi.fn().mockResolvedValue({}) }));
beforeEach(() => { setLocale("zh-CN"); setTheme("auto"); vi.clearAllMocks(); });
afterEach(() => { cleanup(); setTheme("auto"); });

describe("主题菜单", () => {
  it("支持方向键选择，未登录选择只保存在本机并回到触发按钮", () => {
    render(<ThemeToggle syncPreference={false} />);
    const trigger = screen.getByRole("button", { name: "主题" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "跟随系统" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "浅色" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "深色" }));
    fireEvent.click(document.activeElement!);
    expect(readTheme()).toBe("dark");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(apiPut).not.toHaveBeenCalled();
  });

  it("Escape 恢复触发按钮焦点，点击外部关闭菜单", () => {
    render(<ThemeToggle syncPreference={false} />);
    const trigger = screen.getByRole("button", { name: "主题" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("登录后的菜单继续同步账号偏好", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "主题" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "跟随系统" }));
    expect(apiPut).toHaveBeenCalledWith("/api/v1/me/preferences", { theme: "system" });
  });
});
