import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

// jsdom 没有布局/指针拖动，替换外部手势层，只向真实页面投递其 drag-end 事件。
const gesture = vi.hoisted(() => ({ start: (_event: { active: { id: string } }) => {}, end: (_event: { active: { id: string }; over: { id: string } }) => {} }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd, onDragStart }: { children: ReactNode; onDragEnd: typeof gesture.end; onDragStart: typeof gesture.start }) => { gesture.end = onDragEnd; gesture.start = onDragStart; return children; },
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

function renderBoardReply(reply: (url: URL) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const p = url.pathname;
    if (p.endsWith("/auth/me")) return json({ memberId: "m1", username: "demo", name: "测试", permissions: [], locale: "zh-CN", dataScopes: [], mustChangePassword: false });
    if (p.endsWith("/projects")) return json({ items: [] });
    if (p.endsWith("/notifications")) return json({ items: [], unreadCount: 0 });
    if (p.endsWith("/system/status")) return json({ ok: true });
    if (p.endsWith("/work-items/board")) return reply(url);
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/projects/p1/board"] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

const emptyBoard = { columns: [{ stateKey: "todo", name: "待开始", category: "NOT_STARTED", color: "info", items: [], count: 0 }], total: 0 };

it("空看板保留状态列，只显示紧凑提示而不叠加整页空态", async () => {
  renderBoardReply(() => json(emptyBoard));
  await screen.findByText("暂无数据");
  expect(document.querySelector('[data-state-key="todo"]')).toBeTruthy();
  expect(document.querySelector(".ui-state-empty")).toBeNull();
  expect(screen.getAllByRole("button", { name: "新建工作项" })).toHaveLength(2);
});

it("无匹配提示可以清除筛选，恢复空项目提示及工作流列", async () => {
  renderBoardReply(() => json(emptyBoard));
  fireEvent.change(await screen.findByRole("textbox", { name: "搜索编号/标题" }), { target: { value: "未命中" } });
  await screen.findByText("没有匹配项");
  const clear = screen.getAllByRole("button", { name: "清除筛选" }).at(-1)!;
  fireEvent.click(clear);
  await screen.findByText("暂无数据");
  expect((screen.getByRole("textbox", { name: "搜索编号/标题" }) as HTMLInputElement).value).toBe("");
  expect(document.querySelector('[data-state-key="todo"]')).toBeTruthy();
  expect(document.querySelector(".ui-state-empty")).toBeNull();
});

it("刷新失败时只显示错误反馈，不继续显示缓存中的旧看板", async () => {
  let fail = false;
  renderBoardReply(() => fail
    ? new Response(JSON.stringify({ error: { code: "TEST", message: "读取失败" } }), { status: 500, headers: { "content-type": "application/json" } })
    : json({ columns: [{ ...emptyBoard.columns[0], items: [first], count: 1 }], total: 1 }));
  await screen.findByRole("button", { name: first.title });
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "刷新", exact: true }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: first.title })).toBeNull();
  expect(document.querySelector(".board-columns")).toBeNull();
});

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

it("移动失败回滚后在看板内保留错误，允许刷新和关闭", async () => {
  renderBoardReply(() => json({ columns: [
    { ...emptyBoard.columns[0], items: [first], count: 1 },
    { stateKey: "done", name: "已完成", category: "DONE", color: "success", items: [], count: 0 },
  ], total: 1 }));
  const previous = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/transition") && init?.method === "POST") {
      return new Response(JSON.stringify({ code: "FORBIDDEN", message: "当前没有流转权限" }), { status: 403, headers: { "content-type": "application/json" } });
    }
    return previous(input, init);
  }));
  await screen.findByRole("button", { name: first.title });
  await act(async () => { gesture.end({ active: { id: first.id }, over: { id: "done" } }); });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("当前没有流转权限");
  expect(within(alert).getByRole("button", { name: "重新载入" })).toBeTruthy();
  expect(within(document.querySelector('[data-state-key="todo"]') as HTMLElement).getByRole("button", { name: first.title })).toBeTruthy();
  fireEvent.click(within(alert).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("补填字段提交失败时保留抽屉、输入和可读错误", async () => {
  renderBoardReply(() => json({ columns: [
    { ...emptyBoard.columns[0], items: [first], count: 1 },
    { stateKey: "done", name: "已完成", category: "DONE", color: "success", items: [], count: 0 },
  ], total: 1 }));
  const previous = globalThis.fetch;
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/transition") && init?.method === "POST") {
      attempts++;
      return new Response(JSON.stringify(attempts === 1
        ? { code: "BLOCKED_BY_PREREQUISITE", message: "请补充说明", details: { requiredFields: ["resolution"] } }
        : { code: "INTERNAL", message: "暂时无法保存，请重试" }), { status: attempts === 1 ? 409 : 500, headers: { "content-type": "application/json" } });
    }
    return previous(input, init);
  }));
  await screen.findByRole("button", { name: first.title });
  await act(async () => { gesture.end({ active: { id: first.id }, over: { id: "done" } }); });
  const drawer = await screen.findByRole("dialog");
  fireEvent.change(within(drawer).getByLabelText("resolution"), { target: { value: "已确认处理方案" } });
  fireEvent.click(within(drawer).getByRole("button", { name: "提交" }));
  expect((await within(drawer).findByRole("alert")).textContent).toContain("暂时无法保存");
  expect((within(drawer).getByLabelText("resolution") as HTMLTextAreaElement).value).toBe("已确认处理方案");
});

it("隐藏空列依据服务端总数，拖动期间恢复空目标列", async () => {
  renderBoardReply(() => json({ columns: [
    { ...emptyBoard.columns[0], items: [first], count: 1 },
    { stateKey: "queued", name: "未加载列", category: "NOT_STARTED", color: "info", items: [], count: 3 },
    { stateKey: "done", name: "已完成", category: "TERMINAL", color: "success", items: [], count: 0 },
  ], total: 4 }));
  await screen.findByRole("button", { name: first.title });
  fireEvent.click(screen.getByRole("checkbox", { name: "隐藏空列" }));
  expect(document.querySelector('[data-state-key="done"]')).toBeNull();
  expect(document.querySelector('[data-state-key="queued"]')).toBeTruthy();
  await act(async () => { gesture.start({ active: { id: first.id } }); });
  expect(document.querySelector('[data-state-key="done"]')).toBeTruthy();
});

it("整个结果为空时隐藏空列仍保留工作流与清除筛选入口", async () => {
  renderBoardReply(() => json(emptyBoard));
  await screen.findByText("暂无数据");
  fireEvent.click(screen.getByRole("checkbox", { name: "隐藏空列" }));
  expect(document.querySelector('[data-state-key="todo"]')).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索编号/标题" }), { target: { value: "无结果" } });
  await screen.findByText("没有匹配项");
  expect(screen.getAllByRole("button", { name: "清除筛选" }).length).toBeGreaterThan(0);
});

const workflowChoices = [
  { id: "11111111-1111-4111-8111-111111111111", name: "任务流程", appliesToType: "TASK" },
  { id: "22222222-2222-4222-8222-222222222222", name: "任务备用流程", appliesToType: "TASK" },
  { id: "33333333-3333-4333-8333-333333333333", name: "需求流程", appliesToType: "REQUIREMENT" },
];

it("类型与工作流同时筛选首屏和下一页，切换类型清除不适用工作流", async () => {
  renderBoardReply(url => {
    const scoped = url.searchParams.get("type") === "TASK" && url.searchParams.get("workflowId") === workflowChoices[0]!.id;
    return json({ workflows: workflowChoices, columns: [{ ...emptyBoard.columns[0], items: scoped ? [first] : [], count: scoped ? 2 : 0 }], total: scoped ? 2 : 0 });
  });
  const previous = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/board/columns/todo")) {
      const scoped = url.searchParams.get("type") === "TASK" && url.searchParams.get("workflowId") === workflowChoices[0]!.id && url.searchParams.get("offset") === "1";
      return json({ items: scoped ? [extra] : [], count: 2 });
    }
    return previous(input, init);
  }));
  await waitFor(() => expect(screen.getByRole("button", { name: "工作流", exact: true })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "类型", exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "任务", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "工作流", exact: true }));
  expect(screen.queryByRole("option", { name: "需求流程", exact: true })).toBeNull();
  fireEvent.click(await screen.findByRole("option", { name: "任务流程", exact: true }));
  await screen.findByRole("button", { name: first.title });
  fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
  await screen.findByRole("button", { name: extra.title });
  fireEvent.click(screen.getByRole("button", { name: "类型", exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "需求", exact: true }));
  expect(await screen.findByRole("button", { name: "工作流", exact: true })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("button", { name: extra.title })).toBeNull());
});

it("工作流切换后拒绝旧分页结果，保留新工作流卡片", async () => {
  let finish: ((response: Response) => void) | undefined;
  const current = { ...first, id: "w3", title: "备用工作流首项" };
  renderBoardReply(url => {
    const alternate = url.searchParams.get("workflowId") === workflowChoices[1]!.id;
    return json({ workflows: workflowChoices, columns: [{ ...emptyBoard.columns[0], items: [alternate ? current : first], count: alternate ? 1 : 2 }], total: alternate ? 1 : 2 });
  });
  const previous = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/board/columns/todo")
    ? new Promise<Response>(resolve => { finish = resolve; }) : previous(input, init)));
  await screen.findByRole("button", { name: first.title });
  fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "工作流", exact: true }));
  fireEvent.click(await screen.findByRole("option", { name: "任务备用流程", exact: true }));
  await screen.findByRole("button", { name: current.title });
  await act(async () => { finish?.(json({ items: [extra], count: 2 })); });
  expect(screen.queryByRole("button", { name: extra.title })).toBeNull();
});
