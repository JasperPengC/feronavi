import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const project = { id: "p1", key: "NAV", name: "视图导航项目", workItemCount: 2 };
const items = [
  { id: "high", key: "NAV-1", number: 1, title: "需要优先处理", priority: "HIGH", assigneeId: null, version: 1 },
  { id: "low", key: "NAV-2", number: 2, title: "可以稍后处理", priority: "LOW", assigneeId: null, version: 1 },
];
let client: QueryClient;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  setLocale("zh-CN");
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    if (path === "/api/v1/auth/me") return json({ memberId: "m1", username: "demo", name: "演示管理员", permissions: [], dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai" });
    if (path === "/api/v1/projects") return json({ items: [project] });
    if (path === "/api/v1/projects/p1") return json(project);
    if (path === "/api/v1/projects/p1/work-items/board") {
      const priority = url.searchParams.get("priority");
      const matches = priority ? items.filter((item) => item.priority === priority) : items;
      return json({ columns: [{ stateKey: "TODO", name: "待办", category: "NOT_STARTED", color: "neutral", items: matches, count: matches.length, truncated: false }], total: matches.length });
    }
    if (path === "/api/v1/projects/p1/work-items") {
      if (url.searchParams.get("view") === "calendar") return json({ days: [], unscheduled: 2 });
      if (url.searchParams.get("view") === "timeline") return json({ rows: [] });
      return json({ items: [], total: 0, page: 1, pageSize: 50 });
    }
    if (path === "/api/v1/projects/p1/members") return json({ members: [] });
    if (path === "/api/v1/saved-views") return json([]);
    if (path === "/api/v1/notifications") return json({ items: [], unreadCount: 0 });
    if (path === "/api/v1/system/status") return json({ ok: true, version: "test" });
    return json({}, 404);
  }));
});

afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
  setLocale("zh-CN");
});

function renderBoard() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/projects/p1/board"] }));
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("工作项视图间导航", () => {
  it("可从看板直接进入日历，再依次切回表格、时间线和看板", async () => {
    const router = renderBoard();
    for (const [label, route] of [["日历", "calendar"], ["表格", "table"], ["时间线", "timeline"], ["看板", "board"]]) {
      const switcher = await screen.findByRole("group", { name: "工作项", exact: true });
      fireEvent.click(within(switcher).getByRole("link", { name: label, exact: true }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/p1/${route}`));
      await waitFor(() => expect(screen.getByRole("group", { name: "工作项", exact: true }).querySelector('[aria-current="page"]')?.textContent).toBe(label));
      expect(within(screen.getByRole("main")).getByRole("heading", { name: /视图导航项目/ })).toBeTruthy();
    }
  });

  it("可按中文优先级筛选工作项并清除筛选", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "需要优先处理", exact: true });
    fireEvent.click(screen.getByRole("button", { name: "优先级", exact: true }));
    fireEvent.click(screen.getByRole("option", { name: "高", exact: true }));
    await screen.findByRole("button", { name: "需要优先处理", exact: true });
    expect(screen.queryByRole("button", { name: "可以稍后处理", exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选", exact: true }));
    await screen.findByRole("button", { name: "可以稍后处理", exact: true });
  });
});
