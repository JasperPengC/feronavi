import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const items = Array.from({ length: 65 }, (_, i) => ({
  id: `item-${i + 1}`, key: `TEST-${i + 1}`, title: `工作项 ${i + 1}`, type: "TASK",
  priority: "MEDIUM", dueDate: null, version: 1, projectKey: "TEST",
}));
const groups = [
  { key: "assignedToMe", name: "指派给我的", count: 4, items: items.slice(0, 4) },
  { key: "createdByMe", name: "我创建的", count: 65, items: items.slice(0, 8) },
  { key: "overdue", name: "已逾期", count: 18, items: items.slice(0, 8) },
  { key: "dueSoon", name: "7 天内到期", count: 0, items: [] },
];

function renderWorkbench(path = "/workbench") {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const group = groups.find((entry) => url.pathname === `/api/v1/workbench/groups/${entry.key}`);
    const page = Number(url.searchParams.get("page") ?? 1);
    const body = group ? { ...group, items: items.slice((page - 1) * 50, page * 50), page, pageSize: 50 }
      : url.pathname === "/api/v1/workbench" ? { groups, total: 65 }
      : url.pathname === "/api/v1/auth/me" ? { memberId: "m1", username: "tester", name: "测试", permissions: [], dataScopes: [], mustChangePassword: false, locale: "zh-CN", theme: "light", timezone: "Asia/Shanghai" }
      : url.pathname === "/api/v1/todos" ? []
      : { items: [], name: "测试组织", providers: [], unreadCount: 0 };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

beforeEach(() => {
  setLocale("zh-CN"); localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });

it("四组标题提供独立列表链接，列表翻页覆盖超过 50 项的数据", async () => {
  const router = renderWorkbench();
  await screen.findByText("我创建的");
  const cards = document.querySelector(".workbench-groups-grid")!;
  expect(within(cards as HTMLElement).getAllByRole("link")).toHaveLength(4);
  expect(within(cards as HTMLElement).queryByRole("button", { name: /显示其余/ })).toBeNull();
  const link = screen.getByRole("link", { name: "查看全部：我创建的" });
  expect(link.getAttribute("href")).toBe("/workbench/createdByMe");
  fireEvent.click(link);
  await screen.findByRole("heading", { name: "我创建的" });
  expect(router.state.location.pathname).toBe("/workbench/createdByMe");
  const list = await screen.findByRole("region", { name: "我创建的" });
  expect(within(list).getByRole("button", { name: "工作项 50", exact: true })).toBeTruthy();
  expect(within(list).queryByRole("button", { name: "工作项 51", exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /下一页/ }));
  await screen.findByRole("button", { name: "工作项 65", exact: true });
  expect(within(screen.getByRole("region", { name: "我创建的" })).queryByRole("button", { name: "工作项 50", exact: true })).toBeNull();
  expect(router.state.location.search).toMatchObject({ page: 2 });
});

it("完整列表的分页深链可直接打开，并能返回工作台", async () => {
  const router = renderWorkbench("/workbench/createdByMe?page=2");
  const list = await screen.findByRole("region", { name: "我创建的" });
  await within(list).findByRole("button", { name: "工作项 65", exact: true });
  fireEvent.click(screen.getByRole("link", { name: "返回工作台" }));
  await screen.findByText("我创建的");
  expect(router.state.location.pathname).toBe("/workbench");
});
