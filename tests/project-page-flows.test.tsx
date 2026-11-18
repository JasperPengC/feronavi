import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale, t } from "../src/client/i18n/index.ts";
import { toISODate } from "../src/client/components/DatePicker.tsx";

const clients: QueryClient[] = [];
const actor = { memberId: "m1", name: "测试", username: "demo", locale: "zh-CN", timezone: "Asia/Shanghai",
  permissions: ["project:create", "milestone:manage", "idea:submit", "idea:vote", "idea:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false };
const item = { id: "w1", key: "ONE-1", title: "关联任务", description: "详情正文", projectId: "p1", type: "TASK",
  version: 1, priority: "HIGH", dueDate: null, assigneeId: null, projectKey: "ONE" };
const milestone = { id: "ms1", projectId: "p1", name: "交付节点", description: null, startDate: null, dueDate: null,
  progressMode: "COUNT", progressValue: null, completedAt: null, archivedAt: null };
const detail = { milestone, project: { id: "p1", key: "ONE", name: "项目一" }, relatedWorkItems: [item], progressUpdates: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;
function mount(path: string, handle: Handler) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const response = handle(url, init);
    if (response) return response;
    const p = url.pathname;
    if (p.endsWith("/auth/me")) return json(actor);
    if (p.endsWith("/projects")) return json({ items: [] });
    if (p.endsWith("/system/status")) return json({ ok: true, version: "test" });
    if (p.endsWith("/notifications")) return json({ items: [], unreadCount: 0 });
    if (p.endsWith("/members")) return json({ members: [] });
    if (p.endsWith("/transfers")) return json({ transfers: [] });
    if (p.endsWith("/watchers")) return json({ watchers: [] });
    if (p.endsWith("/work-items/w1")) return json(item);
    if (p.endsWith("/workbench")) return json({ groups: [], total: 0 });
    if (p.endsWith("/portfolios")) return json({ portfolios: [] });
    if (p.endsWith("/dashboards")) return json({ dashboards: [] });
    if (p.endsWith("/dev-activity")) return json({ members: [], note: "" });
    if (/\/(todos|milestones|iterations|releases|modules|comments|attachments|labels|activity)$/.test(p)) return json([]);
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return { qc, router };
}
beforeEach(() => {
  setLocale("zh-CN");
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => { cleanup(); clients.splice(0).forEach((qc) => qc.clear()); vi.unstubAllGlobals(); });

describe("项目日常页面的失败恢复", () => {
  it.each([
    ["项目列表", "/projects", "/api/v1/projects", { items: [] }],
    ["工作台", "/workbench", "/api/v1/workbench", { groups: [], total: 0 }],
    ["看板", "/projects/p1/board", "/api/v1/projects/p1/work-items/board", { columns: [], total: 0 }],
    ["日历", "/projects/p1/calendar", "/api/v1/projects/p1/work-items", { days: [], unscheduled: 0 }],
    ["时间线", "/projects/p1/timeline", "/api/v1/projects/p1/work-items", { rows: [] }],
    ["里程碑", "/projects/p1/milestones", "/api/v1/projects/p1/milestones", []],
    ["里程碑详情", "/projects/p1/milestones/ms1", "/api/v1/milestones/ms1/detail", detail],
    ["想法", "/projects/p1/ideas", "/api/v1/projects/p1/ideas", { items: [], total: 0 }],
  ])("%s区分请求失败并在原页重试", async (_name, route, endpoint, success) => {
    let attempts = 0;
    const { router } = mount(String(route), (url) => {
      if (url.pathname !== endpoint) return;
      return ++attempts === 1 ? json({ code: "INTERNAL", message: "暂时无法读取项目数据" }, 503) : json(success);
    });
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("暂时无法读取项目数据");
    fireEvent.click(within(error).getByRole("button", { name: "重新载入" }));
    await waitFor(() => expect(screen.queryByText("暂时无法读取项目数据")).toBeNull());
    expect(attempts).toBeGreaterThan(1);
    expect(router.state.location.pathname).toBe(route);
  });
});

describe("关联对象与长列表入口", () => {
  it.each(["milestone", "idea", "activity"])("%s的关联工作项可原地打开并返回", async (kind) => {
    const path = kind === "milestone" ? "/projects/p1/milestones/ms1" : `/projects/p1/${kind === "idea" ? "ideas" : "activity"}`;
    const { router } = mount(path, (url) => {
      if (url.pathname.endsWith("/milestones/ms1/detail")) return json(detail);
      if (url.pathname.endsWith("/ideas")) return json({ items: [{ id: "i1", title: "反馈想法", description: "说明", score: "1", status: "PLANNED", promotedWorkItemId: "w1" }], total: 1 });
      if (url.pathname.endsWith("/activity")) return json({ items: [{ id: "a1", targetType: "WORK_ITEM", targetId: "w1", summary: "更新关联任务", action: "work_item.updated", createdAt: "2026-11-05T01:00:00Z" }], total: 1 });
    });
    const label = kind === "idea" ? t("ideas.viewWorkItem") : kind === "activity" ? "更新关联任务" : "关联任务";
    fireEvent.click(await screen.findByRole("button", { name: label }));
    const drawer = await screen.findByRole("dialog", { name: "ONE-1" });
    await waitFor(() => expect(drawer.textContent).toContain("详情正文"));
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe(path);
  });

  it("项目集能找到并添加第七个之后的候选项目", async () => {
    const projects = Array.from({ length: 9 }, (_, i) => ({ id: `p${i + 1}`, key: `P${i + 1}`, name: `项目${i + 1}`, workItemCount: 0 }));
    let linked: typeof projects = [];
    mount("/portfolios", (url, init) => {
      if (url.pathname === "/api/v1/projects") return json({ items: projects });
      if (url.pathname === "/api/v1/portfolios") return json({ portfolios: [{ id: "pf1", name: "交付组合", projectCount: linked.length, workItemCount: 0 }] });
      if (url.pathname === "/api/v1/portfolios/pf1") return json({ id: "pf1", name: "交付组合", projects: linked });
      if (url.pathname === "/api/v1/portfolios/pf1/projects" && init?.method === "POST") {
        linked = projects.filter((p) => p.id === JSON.parse(String(init.body)).projectId);
        return json({ ok: true });
      }
    });
    fireEvent.change(await screen.findByRole("textbox", { name: t("pf.searchProjects") }), { target: { value: "项目9" } });
    fireEvent.click(screen.getByRole("button", { name: "+ P9" }));
    expect(await screen.findByRole("link", { name: "项目9" })).toBeTruthy();
  });

  it("日历第四项可以从更多列表打开，关闭详情返回当天列表", async () => {
    const date = `${toISODate(new Date()).slice(0, 7)}-05`;
    const entries = [1, 2, 3, 4].map((n) => ({ ...item, id: n === 4 ? "w1" : `other${n}`, key: `ONE-${n}`, title: `当天任务${n}` }));
    mount("/projects/p1/calendar", (url) => url.searchParams.get("view") === "calendar" ? json({ days: [{ date, count: 4, items: entries }], unscheduled: 0 }) : undefined);
    fireEvent.click(await screen.findByRole("button", { name: t("cal.moreItems", { n: 1 }) }));
    const list = await screen.findByRole("dialog");
    fireEvent.click(within(list).getByRole("button", { name: /当天任务4/ }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("详情正文"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("当天任务4"));
  });

  it("未排期列表使用服务端筛选和分页，可打开后续页的工作项", async () => {
    mount("/projects/p1/calendar", (url) => {
      if (url.searchParams.get("view") === "calendar") return json({ days: [], unscheduled: 31 });
      if (url.searchParams.get("view") === "table" && url.searchParams.get("unscheduled") === "true") {
        const page = Number(url.searchParams.get("page") ?? 1);
        return json({ rows: page === 2 ? [item] : [{ ...item, id: "first", title: "首批待排期" }], total: 31, page, pageSize: 30 });
      }
    });
    fireEvent.click(await screen.findByRole("button", { name: t("cal.unscheduled") }));
    await screen.findByText("首批待排期");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /下一页/ }));
    fireEvent.click(await screen.findByRole("button", { name: /关联任务/ }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("详情正文"));
  });
});

it("洞察可切换到第二个迭代，主图表随选择更新", async () => {
  mount("/projects/p1/insights", (url) => {
    if (url.pathname.endsWith("/iterations")) return json([{ id: "it1", name: "第一轮" }, { id: "it2", name: "第二轮" }]);
    if (url.pathname.includes("/burndown")) return json({ iteration: { id: "it2", name: "第二轮", startDate: "2026-11-01", endDate: "2026-11-05" }, metric: url.pathname.includes("it2") ? "第二轮图表口径" : "第一轮图表口径", points: [] });
    if (url.pathname.includes("cumulative-flow")) return json({ iteration: { id: "it2", name: "第二轮", startDate: "2026-11-01", endDate: "2026-11-05" }, metric: "流图", categories: [], series: [] });
  });
  fireEvent.click(await screen.findByRole("button", { name: "迭代", exact: true }));
  fireEvent.click(screen.getByRole("option", { name: "第二轮" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "迭代", exact: true }).textContent).toContain("第二轮"));
  expect(await screen.findByRole("button", { name: "燃尽图口径" })).toBeTruthy();
});

it("时间线把离轨道起点较远的条只向右移动一天", async () => {
  const from = new Date(); from.setDate(1);
  const to = new Date(); to.setMonth(to.getMonth() + 2);
  const dayWidth = 10;
  const days = Math.round((Date.parse(toISODate(to)) - Date.parse(toISODate(from))) / 86400000);
  const patches: unknown[] = [];
  mount("/projects/p1/timeline", (url, init) => {
    if (url.searchParams.get("view") === "timeline") return json({ rows: [{ kind: "milestone", id: "ms1", name: "交付", bars: [{ ...item, startDate: "2026-11-20", dueDate: "2026-11-23" }] }] });
    if (url.pathname.endsWith("/work-items/w1")) {
      if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return json({ ...item, version: 2 }); }
      return json({ ...item, startDate: "2026-11-20", dueDate: "2026-11-23" });
    }
  });
  const bar = await screen.findByRole("button", { name: /ONE-1 · 关联任务/ });
  const track = bar.parentElement!;
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 100, width: days * dayWidth } as DOMRect);
  vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({ left: 290, width: 30 } as DOMRect);
  const start = new Event("dragstart", { bubbles: true }); Object.defineProperty(start, "clientX", { value: 295 });
  const drop = new Event("drop", { bubbles: true }); Object.defineProperty(drop, "clientX", { value: 305 });
  fireEvent(bar, start); fireEvent(track, drop);
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({ startDate: "2026-11-21", dueDate: "2026-11-24", version: 1 });
});
