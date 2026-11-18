/** 令牌管理页（第六期 W2）—— jsdom 渲染 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试",
  permissions: ["apikey:manage_own"], dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    for (const [k, v] of Object.entries(routes)) {
      if (u.includes(k)) return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/tokens"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("API 令牌页", () => {
  it("读取失败可原位重试，不把失败显示成空列表", async () => {
    let failed = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) return new Response(JSON.stringify(ACTOR));
      if (url.includes("/tokens")) return new Response(JSON.stringify(failed ? { code: "INTERNAL", message: "暂时不可用" } : []), { status: failed ? 503 : 200 });
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("令牌列表加载失败");
    expect(screen.queryByText(/还没有令牌/)).toBeNull();
    failed = false;
    fireEvent.click(within(error).getByRole("button", { name: "重新载入" }));
    await screen.findByText(/还没有令牌/);
  });

  it("取消新建时保留未确认放弃的草稿", async () => {
    stub({ "/api/v1/auth/me": ACTOR, "/api/v1/tokens": [] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新建令牌" }));
    fireEvent.change(screen.getByLabelText("令牌用途"), { target: { value: "待配置客户端" } });
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    const confirmation = await screen.findByRole("dialog", { name: /未保存/ });
    fireEvent.click(within(confirmation).getByRole("button", { name: "取消", exact: true }));
    expect((screen.getByLabelText("令牌用途") as HTMLInputElement).value).toBe("待配置客户端");
  });

  it("空态提示创建", async () => {
    stub({ "/api/v1/auth/me": ACTOR, "/api/v1/tokens": [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/还没有令牌/)).toBeTruthy());
  });

  it("列表展示用途/前缀/档位（不含明文）", async () => {
    stub({
      "/api/v1/auth/me": ACTOR,
      "/api/v1/tokens": [{
        id: "t1", name: "Claude Desktop", tokenPrefix: "fero_…ab12", tier: "READ_ONLY",
        projectWhitelist: [], allowedIpCidrs: [], expiresAt: null, lastUsedAt: null, revokedAt: null,
      }],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Claude Desktop")).toBeTruthy());
    expect(screen.getByText("fero_…ab12")).toBeTruthy();
    // 档位下拉里也有「只读」选项，故允许匹配多处
    expect(screen.getAllByText("只读").length).toBeGreaterThan(0);
    expect(screen.getByText("不过期")).toBeTruthy();
    expect(screen.getByText("吊销")).toBeTruthy();
  });

  it("创建后明文只显示一次并给出 MCP 接入片段", async () => {
    stub({
      "/api/v1/auth/me": ACTOR,
      "/api/v1/tokens": [],
      "/api/v1/tokens?": [],
    });
    // create 走 POST：让桩按方法分派
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/api/v1/tokens") && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ token: "fero_SECRETVALUE123", row: { id: "t9", name: "新令牌", tokenPrefix: "fero_…123", tier: "READ_ONLY", projectWhitelist: [], allowedIpCidrs: [], expiresAt: null, lastUsedAt: null, revokedAt: null } }),
          { status: 201, headers: { "content-type": "application/json" } });
      }
      if (u.includes("/api/v1/tokens")) return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/还没有令牌/)).toBeTruthy());

    // 新建令牌走 Modal：点页头按钮打开，再在弹层里填写
    fireEvent.click(screen.getByRole("button", { name: "新建令牌" }));
    await waitFor(() => expect(screen.getByLabelText("令牌用途")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("令牌用途"), { target: { value: "新令牌" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(screen.getByText(/请立刻复制保存/)).toBeTruthy());
    expect(screen.getByText("fero_SECRETVALUE123")).toBeTruthy();
    // 接入片段里必须带 Bearer 用法
    fireEvent.click(screen.getByText("MCP 接入方式"));
    await waitFor(() => expect(screen.getByText(/Authorization: Bearer fero_SECRETVALUE123/)).toBeTruthy());
    // 关掉明文提示
    fireEvent.click(screen.getByText("我已保存"));
    await waitFor(() => expect(screen.queryByText("fero_SECRETVALUE123")).toBeNull());
  });

  it("页面只保留标题，不再堆砌说明", async () => {
    stub({ "/api/v1/auth/me": ACTOR, "/api/v1/tokens": [] });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "API 令牌" })).toBeTruthy());
    expect(screen.queryByText(/账号权限 ∩ 令牌档位 ∩ 项目白名单/)).toBeNull();
  });
});
