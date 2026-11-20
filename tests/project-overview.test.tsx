/** 项目概览页（Round 62 对标 P0）：指标/信息/活动/成员渲染 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "demo", name: "管理员",
  permissions: ["work_item:read_any", "activity:read"], dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "11111111-1111-1111-1111-111111111111";
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const defaultColumns = [
  { stateKey: "TODO", name: "待办", category: "TODO", items: [], count: 3 },
  { stateKey: "DONE", name: "完成", category: "DONE", items: [], count: 1 },
];
function stub(columns = defaultColumns) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    if (u.includes("/api/v1/auth/me")) return json(ACTOR);
    if (u.includes("/api/v1/notifications")) return json({ items: [], unreadCount: 0 });
    if (u.includes("/api/v1/presence")) return json({ online: [], count: 0 });
    if (u.includes("/api/v1/projects?") || u.endsWith("/api/v1/projects")) return json({ items: [{
      id: P, key: "FINOK", name: "结项终验", description: "项目描述",
      status: { key: "PLANNED", name: "已规划", category: "PLANNED", color: "info" },
      lead: { id: "m1", name: "演示管理员" }, archivedAt: null, workItemCount: columns.reduce((sum, column) => sum + column.count, 0),
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
    }] });
    if (u.includes("/work-items/board")) return json({ columns });
    if (u.includes("/milestones")) return json([
      { id: "ms1", name: "结项里程碑", dueDate: "2026-12-01", archivedAt: null },
    ]);
    if (u.includes("/iterations")) return json([]);
    if (u.includes("/projects/" + P + "/members")) return json({ members: [
      { id: "m1", username: "demo", name: "演示管理员", role_key: "ADMIN", role_name: "管理员" },
    ] });
    if (u.includes("/activity")) return json({ items: [
      { id: "a1", action: "work_item.created", summary: "演示管理员 创建了工作项", createdAt: "2026-10-20T10:00:00.000Z" },
    ], total: 1, page: 1, pageSize: 8 });
    return json({}, 404);
  }));
}
function renderPage(columns = defaultColumns) {
  stub(columns);
  const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}`] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}

describe("项目概览页", () => {
  it("真实工作流TERMINAL的完成、关闭及取消项不计入未完成，并使用完整count而非当前分页items", async () => {
    renderPage([
      { stateKey: "TODO", name: "待办", category: "NOT_STARTED", items: [], count: 7 },
      { stateKey: "IN_PROGRESS", name: "进行中", category: "IN_PROGRESS", items: [], count: 4 },
      { stateKey: "DONE", name: "已完成", category: "TERMINAL", items: [], count: 12 },
      { stateKey: "CLOSED", name: "已关闭", category: "TERMINAL", items: [], count: 10 },
      { stateKey: "CANCELLED", name: "已取消", category: "TERMINAL", items: [], count: 6 },
    ]);
    await waitFor(() => expect(screen.getByText("项目信息")).toBeTruthy());
    const open = screen.getByText("未完成").closest(".metric-card");
    expect(open).toBeTruthy();
    await waitFor(() => expect(within(open as HTMLElement).getByText("11")).toBeTruthy());
    expect(screen.getByText("39")).toBeTruthy();
  });
  it("渲染项目名称、指标、信息、活动、成员、临期里程碑", async () => {
    renderPage();
    // 外壳的工作区切换器也会显示当前项目名，不能只等「结项终验」——否则会在页面数据还没加载完时
    // 就提前断言（真实测试竞态）。这里等页面自身的「项目信息」区块出现。
    await waitFor(() => expect(screen.getByText("项目信息")).toBeTruthy());
    expect(screen.getAllByText(/结项终验/).length).toBeGreaterThan(0);
    const overviewTab = within(screen.getByRole("navigation", { name: "工作区页签" })).getByRole("link", { name: "FINOK · 概览" });
    expect(overviewTab.getAttribute("href")).toBe(`/projects/${P}`);
    expect(overviewTab.getAttribute("aria-current")).toBe("page");
    expect(overviewTab.getAttribute("title")).toBe("结项终验 · 概览");
    expect(overviewTab.textContent).toBe("概览");
    const header = screen.getByRole("heading", { name: "结项终验", level: 1 }).closest("header")!;
    expect(header.textContent).not.toContain("项目描述");
    expect(header.textContent).toContain("已规划");
    const description = screen.getByText("项目说明").closest("details")!;
    expect(description.hasAttribute("open")).toBe(false);
    expect(within(description).getByText("项目描述")).toBeTruthy();
    expect(screen.getByText("最近活动")).toBeTruthy();
    expect(screen.getByText(/演示管理员 创建了工作项/)).toBeTruthy();
    expect(screen.getByText("结项里程碑")).toBeTruthy();
    expect(screen.getByText("项目成员")).toBeTruthy();
    // 未完成 = TODO 3（DONE 不计）
    expect(screen.getByText("3")).toBeTruthy();
  });
});
