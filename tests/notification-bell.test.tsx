import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const actor = { memberId: "m1", username: "demo", name: "测试成员", permissions: [], dataScopes: [], mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai" };
const item = { id: "w1", key: "ONE-1", title: "修复登录错误", description: "通知关联的真实工作项详情", projectId: "p1", type: "TASK", priority: null, version: 1 };
const notification = { id: "n1", title: "你有一项新任务", body: item.title, link: "/work-items/w1", category: "ASSIGN", type: "work_item.assigned", readAt: null, itemCount: 1, createdAt: "2026-11-07T10:00:00Z" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function mount(notifications: () => Promise<Response> | Response, path = "/projects") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v1/auth/me") return json(actor);
    if (url.pathname === "/api/v1/notifications") return notifications();
    if (url.pathname === "/api/v1/projects") return json({ items: [] });
    if (url.pathname === "/api/v1/work-items/w1") return json(item);
    if (url.pathname.endsWith("/comments")) return json([]);
    if (url.pathname.endsWith("/links")) return json({ links: [] });
    return json({ items: [], members: [], watchers: [], transfers: [] });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
beforeEach(() => {
  setLocale("zh-CN");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => { cleanup(); clients.splice(0).forEach(qc => qc.clear()); vi.unstubAllGlobals(); });

describe("通知入口反馈与实际事项", () => {
  it("加载中不谎报没有通知", async () => {
    mount(() => new Promise<Response>(() => {}));
    fireEvent.click(await screen.findByRole("button", { name: "通知" }));
    const dialog = within(screen.getByRole("dialog", { name: "通知" }));
    expect(dialog.getByRole("status")).toBeTruthy();
    expect(dialog.queryByText("没有通知")).toBeNull();
  });
  it("加载失败可重试，成功为空后才显示空状态", async () => {
    let failed = true;
    mount(() => failed ? json({ code: "INTERNAL", message: "服务暂时不可用" }, 500) : json({ items: [], unreadCount: 0 }));
    fireEvent.click(await screen.findByRole("button", { name: "通知" }));
    const dialog = within(screen.getByRole("dialog", { name: "通知" }));
    expect(await dialog.findByRole("alert")).toBeTruthy();
    expect(dialog.queryByText("没有通知")).toBeNull();
    failed = false;
    fireEvent.click(dialog.getByRole("button", { name: "重新载入" }));
    expect(await dialog.findByText("没有通知")).toBeTruthy();
    expect(dialog.getByText("收到指派、提及或关注事项的更新时，通知会显示在这里。")).toBeTruthy();
  });
  it("从铃铛进入通知中心并关闭弹层", async () => {
    const router = mount(() => json({ items: [notification], unreadCount: 1 }));
    fireEvent.click(await screen.findByRole("button", { name: "通知，1 条未读" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "通知" })).getByRole("link", { name: "查看全部通知" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/notifications"));
    expect(screen.queryByRole("dialog", { name: "通知" })).toBeNull();
  });
  it.each(["/projects", "/notifications"])("从%s的通知打开工作项详情，不跳到不存在的页面", async path => {
    const router = mount(() => json({ items: [notification], unreadCount: 1 }), path);
    if (path === "/projects") fireEvent.click(await screen.findByRole("button", { name: "通知，1 条未读" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看工作项" }));
    expect(await screen.findByText(item.description)).toBeTruthy();
    expect(router.state.location.pathname).toBe(path);
  });
});
