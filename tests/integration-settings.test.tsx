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
  function stubIntegrations(integrations: unknown[] = []) {
    const writes: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes("/api/v1/integrations") && ["POST", "PATCH"].includes(init?.method ?? "")) {
        writes.push({ method: init!.method!, body: JSON.parse(String(init!.body)) });
        return Response.json({ id: "saved" });
      }
      if (u.includes("/api/v1/integrations")) return Response.json({ integrations });
      if (u.includes("/api/v1/projects")) return Response.json({ items: [] });
      return new Response("{}", { status: 404 });
    }));
    return writes;
  }

  function chooseKind(kind: string) {
    fireEvent.click(screen.getByRole("button", { name: "类型", exact: true }));
    fireEvent.click(screen.getByRole("option", { name: kind, exact: true }));
  }

  it.each([
    ["GITHUB", "https://api.github.com"],
    ["GITEE", "https://gitee.com/api/v5"],
  ])("新建%s时提交该提供方的API地址", async (kind, baseUrl) => {
    const writes = stubIntegrations();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "添加集成" }));
    chooseKind(kind);
    expect((screen.getByLabelText("服务地址（https）") as HTMLInputElement).value).toBe(baseUrl);
    expect(screen.getByLabelText("服务地址（https）").getAttribute("placeholder")).toBe(baseUrl);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "仓库集成" } });
    fireEvent.change(screen.getByLabelText("访问令牌"), { target: { value: "test-only-token" } });
    fireEvent.click(screen.getByRole("button", { name: "新建集成" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: "POST", body: { kind, baseUrl } });
  });

  it("连续切换只替换默认或空地址，保留用户输入的自建地址", () => {
    stubIntegrations();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "添加集成" }));
    chooseKind("GITHUB");
    chooseKind("GITEE");
    expect((screen.getByLabelText("服务地址（https）") as HTMLInputElement).value).toBe("https://gitee.com/api/v5");
    fireEvent.change(screen.getByLabelText("服务地址（https）"), { target: { value: "https://git.example.com/api/v3" } });
    chooseKind("GITHUB");
    expect((screen.getByLabelText("服务地址（https）") as HTMLInputElement).value).toBe("https://git.example.com/api/v3");
    fireEvent.change(screen.getByLabelText("服务地址（https）"), { target: { value: "" } });
    chooseKind("GITLAB");
    expect((screen.getByLabelText("服务地址（https）") as HTMLInputElement).value).toBe("https://gitlab.com");
  });

  it("编辑集成时类型不可改，保存保留原地址且不提交kind", async () => {
    const writes = stubIntegrations([INTEGRATION]);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "编辑", exact: true }));
    expect((screen.getByRole("button", { name: "类型", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("服务地址（https）") as HTMLInputElement).value).toBe("https://gitlab.com");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "更新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改", exact: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: "PATCH", body: { name: "更新名称", baseUrl: "https://gitlab.com" } });
    expect(writes[0]!.body).not.toHaveProperty("kind");
  });

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
    fireEvent.click(screen.getByRole("button", { name: "添加集成" }));
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
