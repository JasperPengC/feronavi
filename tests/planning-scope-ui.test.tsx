import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

vi.mock("../src/client/components/work-item/WorkItemDrawer.tsx", () => ({ WorkItemDrawer: ({ workItemId, onClose }: { workItemId?: string; onClose: () => void }) => workItemId ? <div role="dialog" aria-label="工作项详情"><button onClick={onClose}>关闭详情</button></div> : null }));
vi.mock("../src/client/components/work-item/WorkItemEditor.tsx", () => ({ WorkItemEditor: ({ open, initialPlanning }: { open: boolean; initialPlanning: unknown }) => open ? <div role="dialog" aria-label="新建草稿">{JSON.stringify(initialPlanning)}</div> : null }));
const P = "11111111-1111-4111-8111-111111111111", I = "22222222-2222-4222-8222-222222222222", R = "33333333-3333-4333-8333-333333333333";
const clients: QueryClient[] = [];
const row = { id: "w1", number: 1, key: "TEST-1", title: "范围内任务", type: "TASK", version: 1, priority: "HIGH" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
function mount(path: string, overrides?: (url: URL, init?: RequestInit) => Response | undefined) {
  const requests: URL[] = [], writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"); requests.push(url);
    const override = overrides?.(url, init); if (override) return override;
    if (url.pathname.endsWith("/auth/me")) return json({ memberId: "m1", username: "test", name: "测试", locale: "zh-CN", timezone: "Asia/Shanghai", permissions: ["work_item:read_any"], dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false });
    if (url.searchParams.get("view") === "table") return json({ rows: [row], total: 41, pageSize: 20 });
    if (url.pathname.endsWith("/iterations")) return json([{ id: I, name: "十一月迭代" }]);
    if (url.pathname.endsWith("/releases")) return json([{ id: R, name: "已归档版本", archivedAt: "2026-11-01" }]);
    if (url.pathname.endsWith("/modules") || url.pathname.endsWith("/milestones")) return json([]);
    if (url.pathname.endsWith("/saved-views")) {
      if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return json({ id: "v2" }); }
      return json(url.searchParams.has("projectId") ? [{ id: "v1", name: "版本缺陷", scope: "PROJECT_SHARED", filters: { releaseId: R, typeF: "DEFECT", sortBy: "priority", sortDir: "desc" } }] : []);
    }
    if (url.pathname.endsWith("/board")) return json({ columns: [] });
    if (url.pathname.endsWith("/members")) return json({ members: [] });
    if (url.pathname === `/api/v1/projects/${P}`) return json({ id: P, name: "测试项目", key: "TEST" });
    return json([]);
  }));
  const history = createMemoryHistory({ initialEntries: [path] }), router = makeRouter(history);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc);
  // @ts-expect-error 测试路由的运行时类型与注册表相同
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, history, requests, writes };
}
beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("只读成员能找到计划与版本并浏览，不能看到计划管理操作", async () => {
  mount(`/projects/${P}/milestones?section=release`);
  await screen.findByRole("heading", { name: "计划与版本" });
  expect(screen.getByRole("tab", { name: "版本", exact: true }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("button", { name: /^新建/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "恢复", exact: true })).toBeNull();
});
it("只读成员的空里程碑页提供说明但不提供无权使用的新建按钮", async () => {
  mount(`/projects/${P}/milestones`);
  await screen.findByText("还没有里程碑");
  expect(screen.queryByRole("button", { name: /里程碑/ })).toBeNull();
});

it("分享地址恢复计划、类型、页码与排序，详情关闭后条件保持", async () => {
  const { router, requests } = mount(`/projects/${P}/table?iterationId=${I}&type=TASK&page=2&sortBy=priority&sortDir=desc&item=w1`);
  await screen.findByRole("dialog", { name: "工作项详情" });
  await waitFor(() => expect(requests.filter(u => u.searchParams.get("view") === "table").at(-1)?.searchParams.get("iterationId")).toBe(I));
  const query = requests.filter(u => u.searchParams.get("view") === "table").at(-1)!;
  expect(Object.fromEntries(query.searchParams)).toMatchObject({ page: "2", type: "TASK", sortBy: "priority", sortDir: "desc" });
  await screen.findByRole("button", { name: "迭代", exact: true });
  fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
  await waitFor(() => expect(router.state.location.search).not.toHaveProperty("item"));
  expect(router.state.location.search).toMatchObject({ iterationId: I, page: 2 });
});

it("更换计划清空批选和页码，浏览器后退恢复范围，归档计划可筛选但不预填新建", async () => {
  const { router, history } = mount(`/projects/${P}/table?iterationId=${I}&page=2`);
  await screen.findByText(row.title);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 TEST-1" }));
  expect(screen.getByRole("region", { name: "批量操作" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "版本", exact: true }));
  fireEvent.click(await screen.findByRole("option", { name: /已归档版本/ }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ releaseId: R, iterationId: I }));
  expect(router.state.location.search.page).toBeUndefined();
  expect(screen.queryByRole("region", { name: "批量操作" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建工作项", exact: true }));
  expect(screen.getByRole("dialog", { name: "新建草稿" }).textContent).toContain(I);
  expect(screen.getByRole("dialog", { name: "新建草稿" }).textContent).not.toContain(R);
  await act(async () => { history.back(); });
  await waitFor(() => expect(router.state.location.search).toMatchObject({ iterationId: I, page: 2 }));
  expect(router.state.location.search.releaseId).toBeUndefined();
});

it("保存视图保留计划，应用历史格式的视图替换旧条件", async () => {
  const { router, writes } = mount(`/projects/${P}/table?iterationId=${I}&priority=HIGH`);
  await screen.findByText(row.title);
  fireEvent.click(screen.getByRole("button", { name: "保存当前视图" }));
  const dialog = await screen.findByRole("dialog", { name: "保存当前视图" });
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "当前迭代" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.filters).toMatchObject({ iterationId: I, priority: "HIGH" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "保存视图", exact: true }));
  fireEvent.click(await screen.findByRole("option", { name: /版本缺陷/ }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ releaseId: R, type: "DEFECT", sortBy: "priority", sortDir: "desc" }));
  expect(router.state.location.search.iterationId).toBeUndefined();
  expect(router.state.location.search.priority).toBeUndefined();
  const scopeToggle = screen.getByRole("button", { name: "计划范围", exact: true });
  expect(scopeToggle.textContent).toContain("已归档版本");
  fireEvent.click(scopeToggle);
  expect(scopeToggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(scopeToggle);
  expect(scopeToggle.getAttribute("aria-expanded")).toBe("false");
  expect(router.state.location.search.releaseId).toBe(R);
});

it("未知计划保留查询条件并说明不可用，名称加载失败提供重试", async () => {
  const { router } = mount(`/projects/${P}/table?moduleId=${I}`, url => url.pathname.endsWith("/iterations") ? json({ message: "加载失败" }, 503) : undefined);
  await waitFor(() => expect(screen.getByRole("button", { name: "模块", exact: true }).textContent).toContain("计划不存在或无权访问"));
  expect(router.state.location.search.moduleId).toBe(I);
  expect(screen.getAllByRole("button", { name: "重新载入", exact: true }).length).toBeGreaterThan(0);
});

it("计划页按URL打开归档分组，名称直达范围列表并提供原分组返回", async () => {
  const { router } = mount(`/projects/${P}/milestones?section=release&archived=true`);
  const link = await screen.findByRole("link", { name: "已归档版本", exact: true });
  expect(link.getAttribute("href")).toContain(`releaseId=${R}`);
  fireEvent.click(link);
  await screen.findByText(row.title);
  fireEvent.click(screen.getByRole("link", { name: "返回计划" }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${P}/milestones`));
  expect(router.state.location.search).toMatchObject({ section: "release", archived: true });
  expect(await screen.findByRole("link", { name: "已归档版本", exact: true })).toBeTruthy();
  const tableTab = document.querySelector<HTMLAnchorElement>(`.shell-tab-link[href*="/table"]`)!;
  expect(tableTab.getAttribute("href")).toContain(`releaseId=${R}`);
  fireEvent.click(tableTab);
  await waitFor(() => expect(router.state.location.search.releaseId).toBe(R));
  expect(router.state.location.search.fromArchived).toBe(true);
});
