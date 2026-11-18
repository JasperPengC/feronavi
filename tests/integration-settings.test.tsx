/** 外部集成设置（Round 25 长任务第 20 项）：列表、令牌不回显、创建请求体、失败原因原样展示 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegrationSettings } from "../src/client/components/settings/IntegrationSettings.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderSection(onSuccess = vi.fn(), onError = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><IntegrationSettings onSuccess={onSuccess} onError={onError} /></QueryClientProvider>);
  return { onSuccess, onError };
}

const INTEGRATION = {
  id: "i1", kind: "GITLAB", projectId: null, name: "GitLab 主集成", baseUrl: "https://gitlab.com",
  isActive: true, hasToken: true, createdAt: new Date().toISOString(),
};

describe("外部集成设置", () => {
  it("列表显示类型/地址/令牌已配置，且不出现令牌明文", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/integrations")) return new Response(JSON.stringify({ integrations: [INTEGRATION] }), { status: 200 });
      if (u.includes("/api/v1/projects")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderSection();
    await waitFor(() => expect(screen.getByText("GitLab 主集成")).toBeTruthy());
    expect(screen.getByText(/GITLAB · https:\/\/gitlab\.com/)).toBeTruthy();
    expect(screen.getByText(/令牌已配置/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("glpat-");
  });

  it("新建集成提交 kind/name/baseUrl/token；SSRF 失败原因原样展示", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes("/api/v1/integrations") && init?.method === "POST") {
        calls.push({ url: u, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ code: "VALIDATION", message: "不允许访问该地址", details: null }), { status: 400 });
      }
      if (u.includes("/api/v1/integrations")) return new Response(JSON.stringify({ integrations: [] }), { status: 200 });
      if (u.includes("/api/v1/projects")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderSection();
    await waitFor(() => expect(screen.getByText("还没有集成。")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ 添加集成" }));
    await waitFor(() => expect(screen.getByLabelText("名称")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "验收集成" } });
    fireEvent.change(screen.getByLabelText("服务地址（https）"), { target: { value: "http://127.0.0.1:8080" } });
    fireEvent.change(screen.getByLabelText("访问令牌"), { target: { value: "glpat-test-token" } });
    fireEvent.click(screen.getByRole("button", { name: "新建集成" }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.body).toMatchObject({ kind: "GITLAB", name: "验收集成", baseUrl: "http://127.0.0.1:8080", token: "glpat-test-token", projectId: null });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("不允许访问该地址"));
  });
});
