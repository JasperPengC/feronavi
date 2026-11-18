/** 审计日志页（Round 25 长任务第 8 项）：列表、筛选参数、受限态 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "admin", name: "管理员", permissions: ["audit:read"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/admin/audit"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `a${n}`, actorId: "m1", actorSnapshot: "admin", action: "auth.login",
  targetType: "MEMBER", targetId: "33333333-3333-3333-3333-333333333333",
  changes: { priority: "LOW" }, ip: "127.0.0.1", severity: "SECURITY",
  createdAt: new Date().toISOString(), ...over,
});

describe("审计日志页", () => {
  it("列表使用可读操作和对象名称，正常安全事件不标红，总数来自接口", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes("/api/v1/audit-entries")) {
        return new Response(JSON.stringify({ items: [row(1), row(2, { action: "role.granted", severity: "BUSINESS", changes: null })], total: 2, page: 1, pageSize: 30 }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "审计日志" })).toBeTruthy());
    await waitFor(() => expect(screen.getByText("登录账号")).toBeTruthy());
    expect(screen.getByText("授予角色")).toBeTruthy();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("成员").length).toBeGreaterThan(0);
    expect(document.querySelector(".audit-table .tag-danger")).toBeNull();
    expect(screen.queryByText(/priority/)).toBeNull();
    expect(screen.getByText("共 2 条")).toBeTruthy();
  });

  it("级别筛选与关键字搜索把条件带到接口（关键字防抖）", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      calls.push(u);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes("/api/v1/audit-entries")) return new Response(JSON.stringify({ items: [row(1)], total: 1, page: 1, pageSize: 30 }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("登录账号")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "安全" }));
    await waitFor(() => expect(calls.some((u) => u.includes("severity=SECURITY"))).toBe(true));
    fireEvent.change(screen.getByLabelText("搜索动作（如 auth.login）…"), { target: { value: "role.granted" } });
    await waitFor(() => expect(calls.some((u) => u.includes("severity=SECURITY") && u.includes("q=role.granted"))).toBe(true), { timeout: 1500 });
  });

  it("日期筛选把 from/to 带到接口；详情抽屉展示完整 changes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      calls.push(u);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes("/api/v1/audit-entries")) return new Response(JSON.stringify({
        items: [row(1, { changes: { priority: "LOW", roleId: "r-1" } })], total: 1, page: 1, pageSize: 30,
      }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("登录账号")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(calls.some((u) => u.includes("from=2026-10-01"))).toBe(true));
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-10-22" } });
    await waitFor(() => expect(calls.some((u) => u.includes("to=2026-10-22T23"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    await waitFor(() => expect(screen.getByText("审计详情")).toBeTruthy());
    const detailJson = document.querySelector(".audit-detail-json")?.textContent ?? "";
    expect(detailJson).toContain("priority");
    expect(detailJson).toContain("roleId");
    expect(screen.getByText("auth.login")).toBeTruthy();
    expect(screen.getByText("33333333-3333-3333-3333-333333333333", { exact: false })).toBeTruthy();
  });

  it("未知动作和对象仍显示原始标识，不能误报为已知操作", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR));
      if (u.includes("/api/v1/audit-entries")) return new Response(JSON.stringify({ items: [row(1, { action: "extension.custom", targetType: "EXTENSION", changes: null })], total: 1 }));
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("extension.custom")).toBeTruthy());
    expect(screen.getByText("EXTENSION")).toBeTruthy();
  });

  it("无权限时给明确受限说明，不渲染空表", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes("/api/v1/auth/me")) return new Response(JSON.stringify(ACTOR), { status: 200 });
      if (u.includes("/api/v1/audit-entries")) return new Response(JSON.stringify({ code: "FORBIDDEN", message: "无权访问该资源", details: null }), { status: 403 });
      return new Response("{}", { status: 404 });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/没有权限查看审计日志/)).toBeTruthy());
    expect(screen.queryByText("没有审计记录")).toBeNull();
  });
});
