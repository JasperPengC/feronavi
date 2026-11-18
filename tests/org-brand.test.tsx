/** 组织名称消费端（Round 25 第 52 项）：登录页显示真实组织名，标签标题同步 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); document.title = "Feronavi"; });

describe("组织名称消费端", () => {
  it("登录页显示「登录到 组织名」，document.title 含组织名", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/organization")) return new Response(JSON.stringify({
        id: "o1", name: "测试组织", logoUrl: null, defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai",
      }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/api/v1/auth/sso/providers")) return new Response(JSON.stringify({ providers: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/api/v1/setup/state")) return new Response(JSON.stringify({ initialized: true, passwordResetEnabled: false }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: ["/login"] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText(/登录到 测试组织/)).toBeTruthy());
    await waitFor(() => expect(document.title).toContain("测试组织"));
  });
});
