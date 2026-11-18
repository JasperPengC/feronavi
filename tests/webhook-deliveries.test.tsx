/** Webhook 投递记录（Round 25 长任务第 21 项）：列表展示死信/尝试/响应码，重放调用后端并刷新 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebhookSettings } from "../src/client/components/settings/WebhookSettings.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

const ENDPOINT = { id: "e1", name: "验收端点", url: "https://example.com/hook", events: ["work_item.created"], isActive: true };
const DEAD = { id: "d1", event: "work_item.created", status: "DEAD", attempts: 5, responseCode: 500, error: "boom", createdAt: new Date().toISOString(), nextRetryAt: null };

function renderSection(onSuccess = vi.fn(), onError = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><WebhookSettings onSuccess={onSuccess} onError={onError} /></QueryClientProvider>);
  return { onSuccess, onError };
}

describe("Webhook 投递记录", () => {
  it("展开后显示死信状态/尝试次数/响应码，死信可重放并刷新列表", async () => {
    const posts: string[] = [];
    let deliveryCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes("/api/v1/webhook-deliveries/") && init?.method === "POST") {
        posts.push(u);
        return new Response(JSON.stringify({ ok: true, status: "SUCCEEDED" }), { status: 200 });
      }
      if (u.includes("/deliveries")) {
        deliveryCalls++;
        return new Response(JSON.stringify({ deliveries: [DEAD] }), { status: 200 });
      }
      if (u.includes("/api/v1/webhooks")) return new Response(JSON.stringify({ endpoints: [ENDPOINT] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    const { onSuccess } = renderSection();
    await waitFor(() => expect(screen.getByText("验收端点")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "投递记录" }));
    await waitFor(() => expect(screen.getByText("已死信")).toBeTruthy());
    expect(screen.getByText("尝试 5 次")).toBeTruthy();
    expect(screen.getByText("响应 500")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重放" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toContain("/api/v1/webhook-deliveries/d1/replay");
    await waitFor(() => expect(deliveryCalls).toBeGreaterThanOrEqual(2));
    expect(onSuccess).toHaveBeenCalledWith("已重放投递");
  });

  it("没有投递记录时显示空态", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/deliveries")) return new Response(JSON.stringify({ deliveries: [] }), { status: 200 });
      if (u.includes("/api/v1/webhooks")) return new Response(JSON.stringify({ endpoints: [ENDPOINT] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderSection();
    await waitFor(() => expect(screen.getByText("验收端点")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "投递记录" }));
    await waitFor(() => expect(screen.getByText("还没有投递记录。")).toBeTruthy());
  });
});
