/** 登录页：组织信息与表单可访问名称。 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

describe("登录页", () => {
  it("显示当前组织和唯一登录标题，表单控件有可访问名称", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return json({ code: "UNAUTHORIZED" }, 401);
      if (u.includes("/api/v1/organization")) return json({ name: "测试组织" });
      if (u.includes("/api/v1/setup/state")) return json({ passwordResetEnabled: false });
      if (u.includes("/api/v1/auth/sso/providers")) return json({ providers: [] });
      return json({});
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: ["/login"] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "登录" })).toBeTruthy());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await screen.findByText("登录到 测试组织")).toBeTruthy();
    expect(screen.getByLabelText(/用户名/)).toBeTruthy();
    expect(screen.getByLabelText(/密码/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  });
});
