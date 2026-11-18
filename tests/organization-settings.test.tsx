/** 组织信息设置（Round 25 第 51 项）：回显 + 保存 PATCH 请求体 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizationSettings } from "../src/client/components/settings/OrganizationSettings.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

describe("组织信息设置", () => {
  it("回显组织信息，保存时发送 PATCH 请求体", async () => {
    const patches: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: "o1", name: "新组织名", logoUrl: null, defaultLocale: "en-US", defaultTimezone: "UTC" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "o1", name: "Feronavi 组织", logoUrl: null, defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSuccess = vi.fn();
    render(<QueryClientProvider client={qc}><OrganizationSettings onSuccess={onSuccess} onError={vi.fn()} /></QueryClientProvider>);
    await waitFor(() => expect((screen.getByLabelText("组织名称") as HTMLInputElement).value).toBe("Feronavi 组织"));
    fireEvent.change(screen.getByLabelText("组织名称"), { target: { value: "新组织名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存组织信息" }));
    await waitFor(() => expect(patches.length).toBe(1));
    expect(patches[0]).toMatchObject({ name: "新组织名", logoUrl: null, defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("组织信息已保存"));
  });
});
