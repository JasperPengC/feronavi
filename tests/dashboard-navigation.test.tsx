import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const ACTOR = {
  memberId: "m1", username: "demo", name: "测试成员", permissions: ["project:create"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const PROJECTS = [
  { id: "p1", key: "ONE", name: "项目一", workItemCount: 3 },
  { id: "p2", key: "TWO", name: "项目二", workItemCount: 4 },
];
const ITEM = {
  id: "w1", key: "ONE-7", title: "跟进指定的任务", description: "这是工作项详情正文",
  type: "TASK", priority: "HIGH", dueDate: null, version: 1, projectKey: "ONE",
  projectId: "p1", assigneeId: null,
};
const clients: QueryClient[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(qc);
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, qc };
}

function commonResponse(path: string) {
  if (path === "/api/v1/auth/me") return json(ACTOR);
  if (path === "/api/v1/projects") return json({ items: PROJECTS });
  if (path === "/api/v1/system/status") return json({ ok: true, version: "test" });
  if (path === "/api/v1/notifications") return json({ items: [], unreadCount: 0 });
  return null;
}

beforeEach(() => {
  setLocale("zh-CN");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("项目集的默认选择与成员维护", () => {
  function stubPortfolio() {
    let linked = [PROJECTS[0]!];
    const portfolio = () => ({
      id: "pf1", name: "交付组合", createdAt: "2026-11-01", projectCount: linked.length,
      workItemCount: linked.reduce((n, project) => n + project.workItemCount, 0),
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      if (path === "/api/v1/portfolios/pf1/projects" && method === "POST") {
        const { projectId } = JSON.parse(String(init?.body));
        linked = [...linked, PROJECTS.find((project) => project.id === projectId)!];
        return json({ ok: true });
      }
      if (path === "/api/v1/portfolios/pf1/projects/p1" && method === "DELETE") {
        linked = linked.filter((project) => project.id !== "p1");
        return json({ ok: true });
      }
      if (path === "/api/v1/portfolios" && method === "GET") return json({ portfolios: [portfolio()] });
      if (path === "/api/v1/portfolios/pf1" && method === "GET") return json({ ...portfolio(), projects: linked });
      return commonResponse(path) ?? json({ code: "NOT_FOUND", message: "请求目标或方法不正确" }, 404);
    }));
  }

  it("直接向默认显示的项目集加入项目，并更新详情和汇总", async () => {
    stubPortfolio();
    renderAt("/portfolios");
    fireEvent.click(await screen.findByRole("button", { name: "+ TWO" }));
    const side = () => within(document.querySelector(".side-col") as HTMLElement);
    await waitFor(() => expect(side().getByRole("link", { name: "项目二" })).toBeTruthy());
    expect(side().queryByRole("button", { name: "+ TWO" })).toBeNull();
    expect(document.querySelector(".metric-grid")?.textContent).toContain("7");
  });

  it("直接从默认显示的项目集中移出项目，并刷新列表", async () => {
    stubPortfolio();
    renderAt("/portfolios");
    fireEvent.click(await screen.findByRole("button", { name: "移出" }));
    const side = () => within(document.querySelector(".side-col") as HTMLElement);
    await waitFor(() => expect(side().queryByRole("link", { name: "项目一" })).toBeNull());
    expect(side().getByRole("button", { name: "+ ONE" })).toBeTruthy();
    expect(document.querySelector(".metric-grid")?.textContent).toContain("0");
  });

  it("收起默认详情后保持收起，重新查看才打开", async () => {
    stubPortfolio();
    const { qc } = renderAt("/portfolios");
    fireEvent.click(await screen.findByRole("button", { name: "收起" }));
    expect(document.querySelector(".side-col")).toBeNull();
    await act(() => qc.invalidateQueries({ queryKey: ["portfolios"] }));
    expect(document.querySelector(".side-col")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    await waitFor(() => expect(document.querySelector(".side-col")).toBeTruthy());
  });
});

describe("工作台工作项入口", () => {
  it("活动数据从稀疏变为连续后仍可查看趋势，再次清空也不会中断页面", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/v1/workbench") return json({ groups: [], total: 0 });
      if (path === "/api/v1/todos") return json([]);
      if (path === "/api/v1/projects/p1/activity-series") return json({ points: [] });
      return commonResponse(path) ?? json({}, 404);
    }));
    const { qc } = renderAt("/workbench");
    await waitFor(() => expect(qc.getQueryState(["activity-series", "p1"])?.status).toBe("success"));
    const points = Array.from({ length: 7 }, (_, i) => ({ d: `2026-11-0${i + 1}`, n: i + 1 }));
    await act(() => qc.setQueryData(["activity-series", "p1"], { points }));
    expect(await screen.findByRole("img", { name: "7 天：活动 28、新建 0" })).toBeTruthy();
    fireEvent.focus(screen.getByRole("img", { name: "2026-11-03，活动 3，新建 0" }));
    expect(document.querySelector(".chart-hover-tip")?.textContent).toContain("2026-11-03");
    await act(() => qc.setQueryData(["activity-series", "p1"], { points: [] }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "7 天：活动 28、新建 0" })).toBeNull());
    expect(document.querySelector(".workbench-page")).toBeTruthy();
  });

  it.each([
    ["今日关注", ".workbench-attention-list"],
    ["任务分组", ".workbench-groups-grid"],
  ])("从%s直接打开对应详情，关闭后仍在工作台", async (_name, selector) => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/v1/workbench") return json({
        groups: [{ key: "assignedToMe", name: "指派给我的", count: 1, items: [ITEM] }], total: 1,
      });
      if (path === "/api/v1/todos") return json([]);
      if (path === "/api/v1/projects/p1/activity-series") return json({ points: [] });
      if (path === "/api/v1/work-items/w1") return json(ITEM);
      if (path === "/api/v1/work-items/w1/links") return json({ links: [] });
      if (path === "/api/v1/work-items/w1/comments") return json([]);
      if (path === "/api/v1/work-items/w1/transfers") return json({ transfers: [] });
      if (path === "/api/v1/work-items/w1/watchers") return json({ watchers: [] });
      if (path === "/api/v1/members") return json({ members: [] });
      return commonResponse(path) ?? json({}, 404);
    }));
    const { router } = renderAt("/workbench");
    await screen.findByText("指派给我的", { selector: ".workbench-groups-grid span" });
    const area = within(document.querySelector(selector) as HTMLElement);
    fireEvent.click(area.getByRole("button", { name: ITEM.title }));
    const dialog = await screen.findByRole("dialog", { name: ITEM.key });
    await waitFor(() => expect(within(dialog).getByText(ITEM.description)).toBeTruthy());
    expect(router.state.location.pathname).toBe("/workbench");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(area.getByRole("button", { name: ITEM.title })).toBeTruthy();
  });
});

describe("里程碑保存恢复", () => {
  it("保存失败后保留表单并允许取消或重试，成功后可继续新建", async () => {
    const projectId = "11111111-1111-1111-1111-111111111111";
    let fail = true;
    const milestones: { id: string; name: string; description: null; dueDate: null; archivedAt: null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === `/api/v1/projects/${projectId}/milestones`) {
        if (init?.method === "POST") {
          if (fail) { fail = false; return json({ code: "INTERNAL", message: "暂时无法保存，请重试" }, 500); }
          const item = { id: "ms1", name: JSON.parse(String(init.body)).name, description: null, dueDate: null, archivedAt: null };
          milestones.push(item);
          return json(item, 201);
        }
        return json(milestones);
      }
      if (/\/(iterations|releases|modules)$/.test(path)) return json([]);
      return commonResponse(path) ?? json({}, 404);
    }));
    renderAt(`/projects/${projectId}/milestones`);
    fireEvent.click(await screen.findByRole("button", { name: "新建第一个里程碑" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "验收交付" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("暂时无法保存，请重试");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("验收交付");
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByLabelText("名称")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "新建里程碑" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "下一阶段" } });
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
