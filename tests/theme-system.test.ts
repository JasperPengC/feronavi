/** 跟随系统主题（Round 91）：服务端 "system" 与客户端 "auto" 的归一化 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeTheme, readTheme, setTheme, applyTheme, watchSystemTheme } from "../src/client/lib/theme.ts";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mq));
  return { mq, listeners, set(m: boolean) { mq.matches = m; listeners.forEach((fn) => fn()); } };
}

beforeEach(() => {
  document.documentElement.className = "";
  document.cookie = "feronavi_theme=; path=/; max-age=0";
});

describe("主题值域归一化", () => {
  it("服务端 system 等价于 auto，未知值回退 auto", () => {
    expect(normalizeTheme("system")).toBe("auto");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme(null)).toBe("auto");
    expect(normalizeTheme("whatever")).toBe("auto");
  });

  it("setTheme('system') 写 auto cookie，并在系统深色时应用深色（真实 bug 回归）", () => {
    mockMatchMedia(true);
    document.cookie = "feronavi_theme=system; path=/";
    expect(readTheme()).toBe("auto");
    applyTheme("system");
    expect(document.documentElement.className).toBe("theme-dark");
    setTheme("system");
    expect(document.cookie).toContain("feronavi_theme=auto");
    expect(document.documentElement.className).toBe("theme-dark");
  });

  it("auto 模式监听系统变化；light/dark 固定选择不跟随", () => {
    const m = mockMatchMedia(false);
    document.cookie = "feronavi_theme=auto; path=/";
    const off = watchSystemTheme();
    m.set(true);
    expect(document.documentElement.className).toBe("theme-dark");
    m.set(false);
    expect(document.documentElement.className).toBe("theme-light");
    off();
    document.cookie = "feronavi_theme=dark; path=/";
    applyTheme("dark");
    m.set(false);
    expect(document.documentElement.className).toBe("theme-dark");
  });
});
