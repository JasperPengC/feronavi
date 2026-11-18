/** 项目活动页（Round 25 长任务第 4 项）：真实活动列表、分页、空态 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试", permissions: ["activity:read"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "33333333-3333-3333-3333-333333333333";

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/activity`] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function item(n: number, summary: string) {
  return {
    id: `a${n}`, actorId: "m1", targetType: "MILESTONE", targetId: "t1",
    action: "plan.milestone.created", summary, createdAt: new Date().toISOString(),
  };
}

describe("项目活动页", () => {
  it("渲染服务端预渲染摘要、事件代码与总数", async () => {
    const page1 = { items: [item(1, "张三 创建了里程碑「Beta」"), item(2, "李四 更新了 FINOK-1")], total: 2, page: 1, pageSize: 30 };
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes(`/projects/${P}/activity`)) return new Response(JSON.stringify(page1), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("项目活动")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/创建了里程碑/)).toBeTruthy());
    expect(screen.getByText(/更新了 FINOK-1/)).toBeTruthy();
    expect(screen.getAllByText("plan.milestone.created").length).toBe(2);
    // 总数来自接口，不是前端数条数
    expect(screen.getByText(/共 2 条/)).toBeTruthy();
  });

  it("分页：下一页请求 page=2 并替换列表", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      calls.push(u);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes(`/projects/${P}/activity`)) {
        const page = /[?&]page=(\d+)/.exec(u)?.[1] ?? "1";
        return new Response(JSON.stringify({
          items: [item(Number(page) * 10, `第 ${page} 页的事件`)], total: 60, page: Number(page), pageSize: 30,
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/第 1 页的事件/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(screen.getByText(/第 2 页的事件/)).toBeTruthy());
    expect(calls.some((u) => u.includes("page=2"))).toBe(true);
  });

  it("类别筛选与关键字搜索会把条件带到接口（且关键字做防抖）", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      calls.push(u);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes(`/projects/${P}/activity`)) {
        const category = /[?&]category=([^&]+)/.exec(u)?.[1];
        const keyword = /[?&]q=([^&]+)/.exec(u)?.[1];
        return new Response(JSON.stringify({
          items: [item(1, category === "comment" && keyword ? `命中 ${decodeURIComponent(keyword)}` : "全部活动")],
          total: 1, page: 1, pageSize: 30,
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("全部活动")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(calls.some((u) => u.includes("category=comment"))).toBe(true));

    fireEvent.change(screen.getByLabelText("搜索活动摘要…"), { target: { value: "FINOK" } });
    await waitFor(() => expect(calls.some((u) => u.includes("category=comment") && u.includes("q=FINOK"))).toBe(true), { timeout: 1500 });
    await waitFor(() => expect(screen.getByText(/命中 FINOK/)).toBeTruthy());
    expect(screen.getByText(/命中 FINOK/)).toBeTruthy();
  });

  it("筛选后无结果时给出「没有匹配的活动」而不是项目空态", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes(`/projects/${P}/activity`)) {
        const filtered = u.includes("category=") || u.includes("q=");
        return new Response(JSON.stringify({ items: filtered ? [] : [item(1, "全部活动")], total: filtered ? 0 : 1, page: 1, pageSize: 30 }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("全部活动")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(screen.getByText("没有匹配的活动")).toBeTruthy());
    expect(screen.getByText(/换个关键词或筛选条件/)).toBeTruthy();
  });

  it("空态给出什么操作会产生活动", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes(`/projects/${P}/activity`)) return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 30 }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("这个项目还没有活动记录")).toBeTruthy());
    expect(screen.getByText(/创建工作项、建里程碑、发公告等操作/)).toBeTruthy();
  });

  it("日期范围筛选把 from/to 带到接口，并可清除", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      calls.push(u);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes(`/projects/${P}/activity`)) {
        return new Response(JSON.stringify({ items: [item(1, "近期活动")], total: 1, page: 1, pageSize: 30 }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("近期活动")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(calls.some((u) => u.includes("from=2026-10-01"))).toBe(true));
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-10-22" } });
    await waitFor(() => expect(calls.some((u) => u.includes("to=2026-10-22"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "清除日期" }));
    await waitFor(() => expect((screen.getByLabelText("起始日期") as HTMLInputElement).value).toBe(""));
  });
});
