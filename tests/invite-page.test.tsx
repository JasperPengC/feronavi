/** 邀请注册页（Round 25 第 49 项）：有效令牌显示表单并可提交；无效令牌显示错误 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}

describe("邀请注册页", () => {
  it("有效令牌：填表提交后显示已加入", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const url = String(i);
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: "m-new", username: "newbie", name: "新成员" }), { status: 201 }); }
      if (url.includes("/api/v1/invites/tok123456")) return new Response(JSON.stringify({ valid: true, expiresAt: new Date(Date.now() + 86400000).toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/api/v1/setup/state")) return new Response(JSON.stringify({ initialized: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    renderAt("/invite/tok123456");
    await waitFor(() => expect(screen.getByLabelText(/用户名/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: "newbie" } });
    fireEvent.change(screen.getByLabelText(/显示姓名/), { target: { value: "新成员" } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: "password-123456" } });
    fireEvent.click(screen.getByRole("button", { name: "接受邀请" }));
    await waitFor(() => expect(screen.getByText("已加入组织，请登录。")).toBeTruthy());
    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({ username: "newbie", name: "新成员", password: "password-123456" });
  });

  it("无效令牌：显示失效提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      if (String(i).includes("/api/v1/setup/state")) return new Response(JSON.stringify({ initialized: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ valid: false }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    renderAt("/invite/badtoken123");
    await waitFor(() => expect(screen.getByText(/邀请链接无效或已过期/)).toBeTruthy());
  });
});
