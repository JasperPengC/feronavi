/** 功能开关设置（Round 25 长任务第 23 项）：列表启停、添加开关、错误透传 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeatureFlagSettings } from "../src/client/components/settings/FeatureFlagSettings.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function renderSection(onSuccess = vi.fn(), onError = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><FeatureFlagSettings onSuccess={onSuccess} onError={onError} /></QueryClientProvider>);
  return { onSuccess, onError };
}

const ROW = { key: "ui.experiment.a", enabled: true, config: { rollout: 10 } };

describe("功能开关设置", () => {
  it("列表显示 key/状态，点停用发送 PUT 并刷新", async () => {
    const puts: { url: string; body: unknown }[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (init?.method === "PUT") {
        puts.push({ url: u, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ key: ROW.key, enabled: false, config: {} }), { status: 200 });
      }
      listCalls++;
      return new Response(JSON.stringify({ flags: [ROW] }), { status: 200 });
    }));
    const { onSuccess } = renderSection();
    await waitFor(() => expect(screen.getByText("ui.experiment.a")).toBeTruthy());
    expect(screen.getByText("已启用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]!.url).toContain("/api/v1/feature-flags/ui.experiment.a");
    expect(puts[0]!.body).toEqual({ enabled: false });
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    expect(onSuccess).toHaveBeenCalledWith("开关「ui.experiment.a」已保存");
  });

  it("添加新开关发送 enabled=true；无开关时显示空态", async () => {
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ key: "ui.new.flag", enabled: true, config: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ flags: [] }), { status: 200 });
    }));
    renderSection();
    await waitFor(() => expect(screen.getByText("还没有功能开关。")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("开关 key"), { target: { value: "ui.new.flag" } });
    fireEvent.click(screen.getByRole("button", { name: "添加开关" }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ enabled: true });
  });
});
