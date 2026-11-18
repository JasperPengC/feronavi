/** 问题追踪页（Round 64 对标 P1）：统计卡/筛选/列表/行渲染 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "demo", name: "管理员",
  permissions: ["work_item:create", "work_item:update_any"], dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "11111111-1111-1111-1111-111111111111";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

describe("问题追踪页", () => {
  it("只为仍待处理且已过截止日的问题标记逾期", async () => {
    const today = new Date().toLocaleDateString("en-CA");
    const cases = [
      { title: "待处理的过期问题", statusCategory: "IN_PROGRESS", dueDate: "2020-01-01" },
      { title: "今天到期", statusCategory: "NOT_STARTED", dueDate: today },
      { title: "未来到期", statusCategory: "IN_PROGRESS", dueDate: "2999-01-01" },
      { title: "没有截止日期", statusCategory: "NOT_STARTED", dueDate: null },
      ...["DONE", "TERMINAL", "CANCELLED"].map((statusCategory) => ({ title: statusCategory, statusCategory, dueDate: "2020-01-01" })),
    ];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return json(ACTOR);
      if (u.includes("/issues/stats")) return json({ total: 7, open: 4, done: 2, cancelled: 1, p0: 0, overdue: 1, donePercent: 29, trend: [], severity: {} });
      if (u.includes("/issues?")) return json({ total: cases.length, items: cases.map((item, index) => ({ ...item, id: `i${index}`, key: `FINOK-${index}`, statusName: item.statusCategory, createdAt: "2026-01-01T00:00:00.000Z" })) });
      return json({ items: [], online: [], count: 0 });
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/issues`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await screen.findByRole("button", { name: /待处理的过期问题/ });
    for (const [index, item] of cases.entries()) {
      const row = screen.getByRole("button", { name: new RegExp(item.title) }).closest("tr")!;
      expect(within(row).queryByText("已逾期") !== null).toBe(index === 0);
    }
  });

  it("渲染统计卡、状态页签与缺陷列表", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return json(ACTOR);
      if (u.includes("/api/v1/notifications")) return json({ items: [], unreadCount: 0 });
      if (u.includes("/api/v1/presence")) return json({ online: [], count: 0 });
      if (u.includes("/issues/stats")) return json({
        total: 3, open: 2, done: 1, cancelled: 0, p0: 1, overdue: 1, donePercent: 33,
        trend: Array.from({ length: 14 }, (_, i) => ({ date: `10-${String(i + 1).padStart(2, "0")}`, created: i === 13 ? 2 : 0, resolved: i === 13 ? 1 : 0 })),
        severity: { S1: 1, S2: 1, S3: 1, S4: 0, none: 0 },
      });
      if (u.includes("/issues?")) return json({ total: 2, items: [
        { id: "i1", key: "FINOK-1", title: "登录接口 500", severity: "S1", priority: "URGENT", statusName: "处理中", statusCategory: "IN_PROGRESS", assigneeName: "演示管理员", dueDate: "2020-01-01", createdAt: "2026-10-20T00:00:00.000Z" },
        { id: "i2", key: "FINOK-2", title: "列表分页错乱", severity: "S2", priority: "HIGH", statusName: "新建", statusCategory: "NOT_STARTED", assigneeName: null, dueDate: null, createdAt: "2026-10-20T00:00:00.000Z" },
      ] });
      return json({});
    }));
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/issues`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByText(/登录接口 500/).length).toBeGreaterThan(0));
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.getByText("FINOK-1")).toBeTruthy();
    expect(screen.getAllByText("S1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("处理中")).toBeTruthy();
    expect(screen.getAllByText("未完成").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "展开趋势与分布" }));
    expect(screen.getByText("近 14 天缺陷趋势")).toBeTruthy();
    expect(screen.getByText("严重度分布")).toBeTruthy();
  });

  it("提交中反复提交表单只登记一个问题，并保留等待反馈", async () => {
    let finish!: (response: Response) => void;
    const createRequest = new Promise<Response>((resolve) => { finish = resolve; });
    const fetcher = vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return json(ACTOR);
      if (u.includes("/work-items") && init?.method === "POST") return createRequest;
      if (u.includes("/issues/stats")) return json({ total: 0, open: 0, done: 0, p0: 0, overdue: 0, donePercent: 0, trend: [], severity: {} });
      if (u.includes("/issues?")) return json({ items: [], total: 0 });
      if (u.includes("/members")) return json({ members: [] });
      return json({ items: [], online: [], count: 0 });
    });
    vi.stubGlobal("fetch", fetcher);
    const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/issues`] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "登记问题" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "登记问题" });
    const title = within(dialog).getByLabelText(/标题/);
    fireEvent.change(title, { target: { value: "避免重复登记" } });
    const form = title.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const countPosts = () => fetcher.mock.calls.filter(([u, init]) => String(u).includes("/work-items") && init?.method === "POST").length;
    await waitFor(() => expect(countPosts()).toBe(1));
    expect((within(dialog).getByRole("button", { name: "创建" }) as HTMLButtonElement).disabled).toBe(true);
    finish(json({ id: "new-issue" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "登记问题" })).toBeNull());
    expect(countPosts()).toBe(1);
  });
});
