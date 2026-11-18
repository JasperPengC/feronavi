import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

// jsdom 没有布局/指针拖动，替换外部手势层，只向真实页面投递其 drag-end 事件。
const gesture = vi.hoisted(() => ({ end: (_event: { active: { id: string }; over: { id: string } }) => {} }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: typeof gesture.end }) => { gesture.end = onDragEnd; return children; },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  PointerSensor: class {}, KeyboardSensor: class {}, useSensor: () => ({}), useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));
const clients: QueryClient[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const first = { id: "w1", key: "P-1", number: 1, title: "搜索命中首项", priority: "HIGH", assigneeId: null, version: 1 };
const extra = { ...first, id: "w2", key: "P-2", number: 2, title: "搜索命中后页", version: 3 };
beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("scrollTo", vi.fn()); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); clients.splice(0).forEach((qc) => qc.clear()); vi.unstubAllGlobals(); });

it("服务端搜索和优先级带入下一页，追加卡片仍可移动并更新目标列", async () => {
  let moved = false;
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const p = url.pathname;
    if (p.endsWith("/auth/me")) return json({ memberId: "m1", username: "demo", name: "测试", permissions: [], locale: "zh-CN", dataScopes: [], mustChangePassword: false });
    if (p.endsWith("/projects")) return json({ items: [] });
    if (p.endsWith("/notifications")) return json({ items: [], unreadCount: 0 });
    if (p.endsWith("/system/status")) return json({ ok: true });
    if (p.endsWith("/work-items/board")) {
      const filtered = url.searchParams.get("q") === "搜索命中" && url.searchParams.get("priority") === "HIGH";
      return json({ columns: [
        { stateKey: "todo", name: "待开始", category: "NOT_STARTED", color: "info", items: filtered ? [first] : [], count: filtered ? (moved ? 1 : 2) : 0 },
        { stateKey: "done", name: "已完成", category: "DONE", color: "success", items: moved ? [{ ...extra, version: 4 }] : [], count: moved ? 1 : 0 },
      ], total: filtered ? 2 : 0 });
    }
    if (p.endsWith("/board/columns/todo")) {
      const valid = url.searchParams.get("q") === "搜索命中" && url.searchParams.get("priority") === "HIGH" && url.searchParams.get("offset") === "1";
      return json({ items: valid ? [extra] : [], count: 2 });
    }
    if (p.endsWith("/w2/transition") && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body))); moved = true; return json({ version: 4, status: { key: "done" } });
    }
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/projects/p1/board"] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.change(await screen.findByRole("textbox", { name: "搜索编号/标题" }), { target: { value: "搜索命中" } });
  fireEvent.click(screen.getByRole("button", { name: "优先级", exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "高", exact: true }));
  await screen.findByRole("button", { name: first.title });
  fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
  await screen.findByRole("button", { name: extra.title });
  await act(async () => { gesture.end({ active: { id: "w2" }, over: { id: "done" } }); });
  const target = document.querySelector('[data-state-key="done"]') as HTMLElement;
  await waitFor(() => expect(within(target).getByRole("button", { name: extra.title })).toBeTruthy());
  expect(writes).toEqual([{ toStateKey: "done", version: 3, fields: {} }]);
  expect(within(document.querySelector('[data-state-key="todo"]') as HTMLElement).queryByRole("button", { name: extra.title })).toBeNull();
});

it("切换筛选后，旧加载更多请求不能把卡片追加到新结果", async () => {
  let finishOldPage: ((response: Response) => void) | undefined;
  const current = { ...first, id: "w3", key: "P-3", title: "新筛选首项" };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const p = url.pathname;
    if (p.endsWith("/auth/me")) return json({ memberId: "m1", username: "demo", name: "测试", permissions: [], locale: "zh-CN", dataScopes: [], mustChangePassword: false });
    if (p.endsWith("/projects")) return json({ items: [] });
    if (p.endsWith("/notifications")) return json({ items: [], unreadCount: 0 });
    if (p.endsWith("/system/status")) return json({ ok: true });
    if (p.endsWith("/work-items/board")) {
      const filtered = url.searchParams.get("priority") === "HIGH";
      return json({ columns: [{ stateKey: "todo", name: "待开始", category: "NOT_STARTED", color: "info", items: [filtered ? current : first], count: filtered ? 1 : 2 }], total: filtered ? 1 : 2 });
    }
    if (p.endsWith("/board/columns/todo")) return new Promise<Response>((resolve) => { finishOldPage = resolve; });
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/projects/p1/board"] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByRole("button", { name: first.title });
  fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
  await waitFor(() => expect(finishOldPage).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "优先级", exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "高", exact: true }));
  await screen.findByRole("button", { name: current.title });
  await act(async () => { finishOldPage?.(json({ items: [extra], count: 2 })); });
  expect(screen.queryByRole("button", { name: extra.title })).toBeNull();
  expect(screen.getByRole("button", { name: current.title })).toBeTruthy();
});
