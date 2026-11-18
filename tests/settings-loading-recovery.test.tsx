import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { StorageSettings } from "../src/client/components/settings/StorageSettings.tsx";
import { RetentionSettings } from "../src/client/components/settings/RetentionSettings.tsx";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const ACTOR = {
  memberId: "m1", username: "admin", name: "管理员", permissions: ["setting:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const SETTINGS = { settings: [
  { key: "storage.kind", value: "s3" },
  { key: "storage.s3.endpoint", value: "https://files.example.test" },
  { key: "storage.s3.bucket", value: "existing-bucket" },
  { key: "audit.retentionDays", value: 90 },
  { key: "activity.retentionDays", value: 60 },
  { key: "export.retentionHours", value: 48 },
] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function renderWithQueries(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(qc);
  render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
  return qc;
}

beforeEach(() => {
  setLocale("zh-CN");
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("实例设置的读取保护", () => {
  it.each([
    ["附件存储", StorageSettings, "保存", { "storage.kind": "s3", "storage.s3.bucket": "existing-bucket" }],
    ["留存期", RetentionSettings, "保存留存期", { "audit.retentionDays": 90, "activity.retentionDays": 60, "export.retentionHours": 48 }],
  ] as const)("%s读取中或失败时不能保存默认值，重试后保存服务端原值", async (_name, Component, saveLabel, expected) => {
    let finishRead!: (response: Response) => void;
    let readCount = 0;
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));
        return json(SETTINGS);
      }
      readCount += 1;
      return readCount === 1 ? new Promise<Response>((resolve) => { finishRead = resolve; }) : json(SETTINGS);
    }));
    renderWithQueries(<Component onSuccess={vi.fn()} onError={vi.fn()} />);
    const save = screen.getByRole("button", { name: saveLabel }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(writes).toHaveLength(0);
    await act(async () => { finishRead(json({ code: "INTERNAL", message: "暂时无法读取配置" }, 503)); });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject(expected);
  });
});

describe("系统概览状态的可信度", () => {
  it("检查未完成或失败时不报全部通过，刷新成功后恢复", async () => {
    let finishOps!: (response: Response) => void;
    let opsCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/v1/auth/me") return json(ACTOR);
      if (path === "/api/v1/system/status") return json({ ok: true, version: "test" });
      if (path === "/api/v1/system/migrations") return json({ applied: 1, files: 1, consistent: true, externalDatabase: false, notes: [], upgradeFlow: [] });
      if (path === "/api/v1/system/operations") {
        opsCount += 1;
        if (opsCount === 1) return new Promise<Response>((resolve) => { finishOps = resolve; });
        return json({ jobs: {}, webhooks: { endpoints: 0, pending: 0, retrying: 0, dead: 0 },
          integrations: { active: 0, total: 0 }, featureFlags: { enabled: 0, total: 0 },
          mcp: { clients: 0, calls: 0 }, knowledge: { queries30d: 0 } });
      }
      if (path === "/api/v1/knowledge/ai-status") return json({ configured: false });
      if (path === "/api/v1/auth/2fa") return json({ enabled: false });
      if (path === "/api/v1/system/ipgeo") return json({ available: false });
      if (path === "/api/v1/system/update-check") return json({ configured: false });
      if (path === "/api/v1/projects") return json({ items: [] });
      if (path === "/api/v1/notifications") return json({ items: [], unreadCount: 0 });
      return json({});
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: ["/system"] }));
    renderWithQueries(<RouterProvider router={router} />);
    await screen.findByRole("button", { name: "刷新状态" });
    expect(screen.queryByText("所有系统检查通过")).toBeNull();
    await act(async () => { finishOps(json({ code: "INTERNAL", message: "检查服务暂时不可用" }, 503)); });
    await screen.findByRole("alert");
    expect(screen.queryByText("所有系统检查通过")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    expect(await screen.findByText("所有系统检查通过")).toBeTruthy();
  });
});
