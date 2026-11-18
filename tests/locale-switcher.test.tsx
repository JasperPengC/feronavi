/** 语言切换（第十四期）：未登录/向导场景可选语言并持久化 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

function stub(routes: Record<string, [number, unknown]>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    for (const [k, [status, body]] of Object.entries(routes)) {
      if (u.includes(k)) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
function chooseLanguage(label: string) {
  fireEvent.click(screen.getByRole("button", { name: /语言 \/ Language|Language \/ 语言/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: label, exact: true }));
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  setLocale("zh-CN");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("语言切换", () => {
  it("语言菜单选择后收起并恢复焦点，再次展开显示当前选项", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: true }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByRole("heading", { name: "登录", exact: true })).toBeTruthy());
    await waitFor(() => expect(screen.getByText("忘记密码？")).toBeTruthy());
    chooseLanguage("English");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in", exact: true })).toBeTruthy());

    expect(screen.queryByRole("menu")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Language / 语言" });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "English" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "English" }));
  });

  it("登录页提供语言切换，切到 English 后文案即时变英文", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: false }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByRole("heading", { name: "登录", exact: true })).toBeTruthy());
    chooseLanguage("English");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in", exact: true })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "登录", exact: true })).toBeNull();
  });

  it("选择被持久化到 localStorage（未登录场景没有账号偏好可依赖）", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: false }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByRole("heading", { name: "登录", exact: true })).toBeTruthy());
    chooseLanguage("English");
    await waitFor(() => expect(localStorage.getItem("feronavi_locale")).toBe("en-US"));
    chooseLanguage("简体中文");
    await waitFor(() => expect(localStorage.getItem("feronavi_locale")).toBe("zh-CN"));
  });

  it("向导语言菜单可切换并标记当前语言，Esc 关闭后归还焦点", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: false, currentStep: 1, passwordResetEnabled: false }] });
    renderAt("/setup");
    await waitFor(() => expect(screen.getByRole("button", { name: "语言 / Language" })).toBeTruthy());
    chooseLanguage("English");
    await waitFor(() => expect(localStorage.getItem("feronavi_locale")).toBe("en-US"));
    const trigger = screen.getByRole("button", { name: "Language / 语言" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const english = screen.getByRole("menuitemradio", { name: "English" });
    expect(english.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(english);
    fireEvent.keyDown(english, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("切换后的语言在重新挂载时保持（localStorage 生效）", async () => {
    stub({ "/api/v1/setup/state": [200, { initialized: true, passwordResetEnabled: false }] });
    renderAt("/login");
    await waitFor(() => expect(screen.getByRole("heading", { name: "登录", exact: true })).toBeTruthy());
    chooseLanguage("English");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in", exact: true })).toBeTruthy());
    cleanup();
    // 重新挂载：detectLocale 会优先读 localStorage
    setLocale(localStorage.getItem("feronavi_locale") ?? null);
    renderAt("/login");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in", exact: true })).toBeTruthy());
  });
});
