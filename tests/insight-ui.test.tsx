/** 洞察页（第十期 W7）：图表渲染、表格兜底、空态、挂件 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";

const ACTOR = {
  memberId: "m1", username: "u", name: "测试", permissions: ["dashboard:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", timezone: "Asia/Shanghai",
};
const P = "33333333-3333-3333-3333-333333333333";
const IT = "44444444-4444-4444-4444-444444444444";
const DASH = "55555555-5555-5555-5555-555555555555";

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => {
    const u = String(i);
    for (const [k, v] of Object.entries(routes)) if (u.includes(k)) return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
}
function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: [`/projects/${P}/insights`] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{/* @ts-expect-error 测试用 */}<RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ITER = { id: IT, name: "迭代 1", startDate: "2026-10-01", endDate: "2026-10-03", status: "ACTIVE", createdAt: "", updatedAt: "" };
const BD = {
  iteration: { id: IT, name: "迭代 1", startDate: "2026-10-01", endDate: "2026-10-03" },
  metric: "remaining = scope - done；scope 为截至当日的迭代内故事点总和，done 为其中已进入终态（TERMINAL）的点数",
  points: [
    { date: "2026-10-01", scope: 8, done: 0, remaining: 8, ideal: 8, source: "live" },
    { date: "2026-10-02", scope: 8, done: 3, remaining: 5, ideal: 4, source: "live" },
    { date: "2026-10-03", scope: 8, done: 5, remaining: 3, ideal: 0, source: "snapshot" },
  ],
};
const CF = {
  iteration: BD.iteration, metric: "每个横条 = 当日已存在且处于该状态类别的工作项数",
  categories: ["NOT_STARTED", "IN_PROGRESS", "TERMINAL"],
  series: [
    { date: "2026-10-01", NOT_STARTED: 2, IN_PROGRESS: 0, TERMINAL: 0, total: 2 },
    { date: "2026-10-02", NOT_STARTED: 1, IN_PROGRESS: 1, TERMINAL: 0, total: 2 },
    { date: "2026-10-03", NOT_STARTED: 1, IN_PROGRESS: 0, TERMINAL: 1, total: 2 },
  ],
};

describe("洞察页", () => {
  it("渲染燃尽图与累积流（含 aria 标签与口径说明）", async () => {
    stub({
      "/api/v1/auth/me": ACTOR,
      [`/projects/${P}/iterations`]: [ITER],
      [`/iterations/${IT}/burndown`]: BD,
      [`/iterations/${IT}/cumulative-flow`]: CF,
      "/api/v1/dashboards": { dashboards: [] },
    });
    renderPage();
    // ⚠️ 卡片标题是**立即渲染**的、图表要等数据 —— 必须等到 SVG 出现再断言
    // （jsdom 不把 <svg role="img"> 暴露给 getByRole，这里按 aria-label 查，断言意图不变）
    await waitFor(() => expect(document.querySelector('svg[aria-label^="燃尽图"]')).toBeTruthy());
    const chart = document.querySelector('svg[aria-label^="燃尽图"]')!;
    expect(chart.getAttribute("aria-label")).toContain("末日剩余 3 点");
    await waitFor(() => expect(document.querySelector('svg[aria-label^="累积流图"]')).toBeTruthy());
    expect(document.querySelector('svg[aria-label^="累积流图"]')).toBeTruthy();
    // 口径走 info 提示，点击后显示；不再是页面上的大段说明
    fireEvent.pointerEnter(screen.getByRole("button", { name: "燃尽图口径" }));
    expect(screen.getByText(/remaining = scope - done/)).toBeTruthy();
    fireEvent.blur(screen.getByRole("button", { name: "燃尽图口径" }));
    // 表格兜底
    expect(screen.getAllByText("查看数据表").length).toBe(2);
    // 数据来源标注现在放在 info 提示里
    fireEvent.pointerEnter(screen.getByRole("button", { name: "数据来源说明" }));
    expect(screen.getByText(/含实时推算点/)).toBeTruthy();
  });

  it("没有迭代时给出可执行的空态（而不是空白图）", async () => {
    stub({ "/api/v1/auth/me": ACTOR, [`/projects/${P}/iterations`]: [], "/api/v1/dashboards": { dashboards: [] } });
    renderPage();
    await waitFor(() => expect(screen.getByText(/还没有迭代/)).toBeTruthy());
    expect(screen.getByText(/请先创建迭代/)).toBeTruthy();
  });

  it("迭代没有工作项时显示说明，不渲染没有数据的图表", async () => {
    stub({
      "/api/v1/auth/me": ACTOR,
      [`/projects/${P}/iterations`]: [ITER],
      [`/iterations/${IT}/burndown`]: { ...BD, points: BD.points.map((point) => ({ ...point, scope: 0, done: 0, remaining: 0, ideal: 0 })) },
      [`/iterations/${IT}/cumulative-flow`]: { ...CF, series: CF.series.map((point) => ({ ...point, NOT_STARTED: 0, IN_PROGRESS: 0, TERMINAL: 0, total: 0 })) },
      "/api/v1/dashboards": { dashboards: [] },
    });
    renderPage();
    await waitFor(() => expect(document.querySelectorAll(".insight-chart-empty")).toHaveLength(2));
    expect(document.querySelector('svg[aria-label^="燃尽图"]')).toBeNull();
    expect(document.querySelector('svg[aria-label^="累积流图"]')).toBeNull();
    expect([...document.querySelectorAll(".insight-chart-empty")].every((element) => Boolean(element.textContent?.trim()))).toBe(true);
  });

  it("仪表盘：只保留一个面板，六类挂件都用真实数据渲染（无未实现占位）", async () => {
    const W = (id: string, type: string) => ({ id, dashboardId: DASH, type, config: {}, sortOrder: 0 });
    const widgets = [
      W("w-bd", "BURNDOWN"), W("w-cf", "CUMULATIVE_FLOW"), W("w-count", "COUNT"),
      W("w-pie", "PIE"), W("w-list", "LIST"), W("w-heat", "ACTIVITY_HEATMAP"),
    ];
    stub({
      "/api/v1/auth/me": ACTOR,
      [`/projects/${P}/iterations`]: [ITER],
      [`/iterations/${IT}/burndown`]: BD,
      [`/iterations/${IT}/cumulative-flow`]: CF,
      // ⚠️ 明细路由放在详情之前：fetch 桩按"包含"匹配，否则会被 /dashboards/<id> 抢走
      [`/api/v1/dashboards/${DASH}/widgets/w-bd/data`]: BD,   // 后端对燃尽直接返回图表对象（无 data 包裹）
      [`/api/v1/dashboards/${DASH}/widgets/w-cf/data`]: CF,   // 同上
      [`/api/v1/dashboards/${DASH}/widgets/w-count/data`]: { type: "COUNT", metric: "工作项总数", data: { total: 7 } },
      [`/api/v1/dashboards/${DASH}/widgets/w-pie/data`]: { type: "PIE", metric: "按优先级分组", data: { slices: [{ label: "高", value: 2 }, { label: "低", value: 1 }] } },
      [`/api/v1/dashboards/${DASH}/widgets/w-list/data`]: { type: "LIST", metric: "最近 8 条", data: { rows: [{ key: "FINOK-1", title: "示例任务", priority: "高" }] } },
      [`/api/v1/dashboards/${DASH}/widgets/w-heat/data`]: { type: "ACTIVITY_HEATMAP", metric: "按创建日期", data: { cells: [{ date: "2026-10-01", value: 2 }, { date: "2026-10-02", value: 1 }] } },
      [`/api/v1/dashboards/${DASH}`]: { id: DASH, name: "默认洞察", projectId: P, isDefault: true, widgets },
      "/api/v1/dashboards": { dashboards: [{ id: DASH, name: "默认洞察", projectId: P, isDefault: true }] },
    });
    renderPage();
    // 页面上**只有一个**仪表盘面板（此前重复了两套，一套能渲染、一套写"尚未实现"）
    fireEvent.click(await screen.findByRole("tab", { name: "仪表盘", exact: true }));
    expect(await screen.findAllByRole("heading", { name: "仪表盘", exact: true })).toHaveLength(1);
    // 六类挂件都渲染真实内容
    await waitFor(() => expect(screen.getByText("7")).toBeTruthy());              // COUNT
    expect(screen.getByText("示例任务")).toBeTruthy();                             // LIST
    expect(screen.getAllByText("高").length).toBeGreaterThan(0);                  // PIE
    expect(document.querySelector('svg[aria-label^="燃尽图"]')).toBeTruthy();     // BURNDOWN
    expect(document.querySelector('svg[aria-label^="累积流图"]')).toBeTruthy();    // CUMULATIVE_FLOW
    expect(document.querySelector('[aria-label="2026-10-01 · 2"]')).toBeTruthy(); // ACTIVITY_HEATMAP
    // 不再有"尚未实现 / 待渲染"占位
    expect(screen.queryByText(/尚未实现/)).toBeNull();
    expect(screen.queryByText(/待渲染/)).toBeNull();
    expect(screen.queryByRole("button", { name: "移除", exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "配置组件", exact: true }));
    expect(screen.getAllByRole("button", { name: "移除", exact: true })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "完成配置", exact: true }));
    expect(screen.queryByRole("button", { name: "移除", exact: true })).toBeNull();
    expect(screen.getByText("示例任务")).toBeTruthy();
  });
});
