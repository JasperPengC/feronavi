/** MCP 客户端策略设置（Round 25 长任务第 26 项）：列表信息、整体替换保存、空态 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { McpClientSettings } from "../src/client/components/settings/McpClientSettings.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

const CLIENT = {
  id: "c1", tokenId: "t1", tokenName: "策略自检令牌", tier: "READ_WRITE",
  clientName: "policy-e2e", clientVersion: "2.3", lastSeenAt: new Date().toISOString(),
  callCount: 7, policies: [{ toolName: "ping", effect: "DENY" }],
};

function renderSection(onSuccess = vi.fn(), onError = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><McpClientSettings onSuccess={onSuccess} onError={onError} /></QueryClientProvider>);
  return { onSuccess, onError };
}

describe("MCP 客户端策略设置", () => {
  it("列表显示令牌/客户端/调用次数/现有策略", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ clients: [CLIENT] }), { status: 200 })));
    renderSection();
    await waitFor(() => expect(screen.getByText("策略自检令牌")).toBeTruthy());
    expect(screen.getByText(/policy-e2e v2\.3/)).toBeTruthy();
    expect(screen.getByText(/调用 7 次/)).toBeTruthy();
    expect(screen.getByText(/ping=DENY/)).toBeTruthy();
  });

  it("编辑策略整体替换：移除旧项 + 新增 DENY + 保存发送 policies", async () => {
    const puts: { url: string; body: { policies: { toolName: string; effect: string }[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push({ url: String(i), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ policies: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ clients: [CLIENT] }), { status: 200 });
    }));
    const { onSuccess } = renderSection();
    await waitFor(() => expect(screen.getByText("策略自检令牌")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "编辑策略" }));
    await waitFor(() => expect(screen.getByLabelText("工具名")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    fireEvent.change(screen.getByLabelText("工具名"), { target: { value: "work_item.delete" } });
    fireEvent.click(screen.getByRole("button", { name: "添加策略" }));
    fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]!.url).toContain("/api/v1/mcp-clients/c1/policy");
    expect(puts[0]!.body.policies).toEqual([{ toolName: "work_item.delete", effect: "DENY" }]);
    expect(onSuccess).toHaveBeenCalledWith("MCP 工具策略已保存");
  });

  it("没有客户端时显示空态说明", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ clients: [] }), { status: 200 })));
    renderSection();
    await waitFor(() => expect(screen.getByText(/还没有 MCP 客户端/)).toBeTruthy());
  });
});
