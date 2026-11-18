import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkItemEditor } from "../src/client/components/work-item/WorkItemEditor.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("离开新建工作项时保护未保存描述，取消保留草稿，确认后才离开", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ members: [], rows: [] }))));
  vi.stubGlobal("scrollTo", () => {});
  const root = createRootRoute({ component: () => <><Outlet /><DialogHost /></> });
  const edit = createRoute({ getParentRoute: () => root, path: "/edit", component: () => <WorkItemEditor open projectId="p1" onClose={() => {}} /> });
  const home = createRoute({ getParentRoute: () => root, path: "/home", component: () => <h1>主页</h1> });
  const router = createRouter({ routeTree: root.addChildren([edit, home]), history: createMemoryHistory({ initialEntries: ["/edit"] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{/* @ts-expect-error 隔离路由测试 */}<RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.change(await screen.findByRole("textbox", { name: /描述/u }), { target: { value: "还没有保存的截图说明" } });
  act(() => { void router.navigate({ to: "/home" }); });
  await screen.findByText("有未保存的修改。确认放弃修改并关闭？");
  fireEvent.click(screen.getAllByRole("button", { name: "取消", exact: true }).at(-1)!);
  expect(router.state.location.pathname).toBe("/edit");
  expect((screen.getByRole("textbox", { name: /描述/u }) as HTMLTextAreaElement).value).toBe("还没有保存的截图说明");
  act(() => { void router.navigate({ to: "/home" }); });
  fireEvent.click(await screen.findByRole("button", { name: "确认", exact: true }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
});
