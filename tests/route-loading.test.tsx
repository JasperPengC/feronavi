import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";

const state = vi.hoisted(() => ({ boardLoads: 0 }));
vi.mock("../src/client/routes/BoardPage.tsx", () => {
  state.boardLoads += 1;
  return { BoardPage: () => <h1>延迟加载的看板</h1> };
});
import { makeRouter } from "../src/client/router.tsx";
import { Panel } from "../src/client/components/ui/Panel.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("登录入口不初始化业务页面，导航到看板后才导入", async () => {
  expect(state.boardLoads).toBe(0);
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const body = path.endsWith("/auth/me") ? { memberId: "m1", name: "测试", username: "u", permissions: [], dataScopes: [], locale: "zh-CN", mustChangePassword: false }
      : path.endsWith("/projects") ? { items: [] } : path.endsWith("/organization") ? { name: "测试组织" } : { providers: [], items: [], unreadCount: 0 };
    return new Response(JSON.stringify(body));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/login"] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByRole("heading", { name: "登录", exact: true });
  expect(state.boardLoads).toBe(0);
  await router.navigate({ to: "/projects/$projectId/board", params: { projectId: "p1" } });
  await screen.findByRole("heading", { name: "延迟加载的看板" });
  expect(state.boardLoads).toBe(1);
  qc.clear();
});

it("唯一 Panel 同时承载标题、动作与自定义 HTML 属性", () => {
  let clicked = false;
  render(<Panel title={<span>项目状态</span>} actions={<button onClick={() => { clicked = true; }}>刷新数据</button>} padding="none" aria-label="项目面板">正文</Panel>);
  expect(screen.getByText("项目状态")).toBeTruthy();
  expect(screen.getByRole("region", { name: "项目面板" }).textContent).toContain("正文");
  fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
  expect(clicked).toBe(true);
  expect(screen.getByRole("region", { name: "项目面板" }).className).toContain("ui-panel-padding-none");
});

it("路由加载失败保留明确的重新加载操作", async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("连接中断"); });
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/"] }));
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "重新载入" })).toBeTruthy());
});

it("已初始化实例的根路径将未登录用户带到可见登录表单", async () => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.endsWith("/auth/me")) return new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "请登录" }), { status: 401 });
    return new Response(JSON.stringify(path.endsWith("/setup/state") ? { initialized: true } : { providers: [], name: "测试组织" }));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/"] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByRole("heading", { name: "登录", exact: true });
  expect(screen.getByLabelText(/用户名/)).toBeTruthy();
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search.returnTo).toBe("/projects");
  qc.clear();
});
