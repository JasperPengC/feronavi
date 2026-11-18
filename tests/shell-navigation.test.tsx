import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/client/routes/AppShell.tsx";
import { setLocale, t } from "../src/client/i18n/index.ts";
import type { Actor } from "../src/client/lib/actor.ts";
import type { ShellProject } from "../src/client/routes/WorkspaceSwitcher.tsx";

const actor: Actor = {
  memberId: "navigation-test", username: "navigation", name: "导航测试",
  permissions: ["setting:manage", "ai:configure", "integration:manage", "org:manage"],
  dataScopes: [{ scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", theme: "light", timezone: "Asia/Shanghai",
};

const clients: QueryClient[] = [];
const projectId = "11111111-1111-1111-1111-111111111111";

function mockMobileViewport(initial: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    matches: initial,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (query: string) => query === "(max-width: 1024px)" ? media : { matches: false, addEventListener() {}, removeEventListener() {} });
  return (matches: boolean) => {
    media.matches = matches;
    listeners.forEach((listener) => listener({ matches }));
  };
}

function renderNavigation(path = "/projects", permissions = actor.permissions, projects: ShellProject[] = []) {
  const responses: Record<string, unknown> = {
    "/api/v1/auth/me": { ...actor, permissions },
    "/api/v1/organization": { id: "org", name: "测试组织", logoUrl: null, defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" },
    "/api/v1/projects": { items: projects, total: projects.length },
    "/api/v1/system/status": { ok: true, version: "0.1.0", buildVersion: "build-a" },
    "/api/v1/notifications": { items: [], unreadCount: 0 },
    "/api/v1/presence": { online: [], count: 0 },
    "/api/v1/search": { items: [] },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input), "http://localhost").pathname;
    const response = await responses[pathname];
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response ?? {}), {
      status: pathname in responses ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  });

  // 保留真实外壳、权限和路由切换；子页面内容与此次导航回归无关。
  const root = createRootRoute({ component: AppShell });
  const routes = ["/projects", "/projects/$projectId", "/projects/$projectId/wiki", "/projects/$projectId/calendar", "/projects/$projectId/board", "/projects/$projectId/issues", "/issues", "/workbench", "/settings/personal", "/settings/integrations", "/settings/instance"].map((route) =>
    createRoute({ getParentRoute: () => root, path: route, component: () => <p>页面内容</p> }),
  );
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: [path] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, client, responses };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("zh-CN");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", () => {});
});

describe("命令面板的键盘和搜索状态", () => {
  it("组合框宣读当前选项，Tab 在搜索框与关闭操作间循环，Esc 归还焦点", async () => {
    const { router } = renderNavigation();
    const opener = await screen.findByRole("button", { name: t("header.searchOrJump") });
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: t("palette.dialog") });
    const input = within(dialog).getByRole("combobox");
    const close = within(dialog).getByRole("button", { name: t("common.close") });
    const options = within(dialog).getAllByRole("option");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.id).not.toBe("");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".shell-main-col")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".shell-sidebar")?.hasAttribute("inert")).toBe(true);
    expect(within(dialog).getAllByRole("button").filter((button) => button !== close).every((button) => button.tabIndex === -1)).toBe(true);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    expect(fireEvent.keyDown(close, { key: "Enter" })).toBe(true);
    expect(router.state.location.pathname).toBe("/projects");
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: t("palette.dialog") })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector(".shell-main-col")?.hasAttribute("inert")).toBe(false);
  });

  it("中文输入法确认候选词时不会执行导航", async () => {
    const { router } = renderNavigation();
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByRole("dialog", { name: t("palette.dialog") })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/projects");
  });

  it("搜索等待时不报无结果，结果到达后仍有可执行的首选项", async () => {
    const { router, responses } = renderNavigation();
    let resolveSearch!: (value: unknown) => void;
    responses["/api/v1/search"] = new Promise((resolve) => { resolveSearch = resolve; });
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: t("palette.dialog") });
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "稍后文档" } });
    expect(await within(dialog).findByText(t("palette.searching"))).toBeTruthy();
    expect(within(dialog).queryByText(t("palette.empty"))).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await act(async () => resolveSearch({ items: [{ type: "page", id: "later-page", title: "稍后文档", projectId, projectKey: "DEMO" }] }));
    const option = await within(dialog).findByRole("option");
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/wiki`));
    expect(router.state.location.search).toMatchObject({ page: "later-page" });
  });

  it("内容搜索失败可重试，已匹配的页面入口仍可用", async () => {
    const { responses } = renderNavigation();
    responses["/api/v1/search"] = new Error("offline");
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: t("palette.dialog") });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "设置" } });
    expect(await within(dialog).findByText(t("palette.searchFailed"))).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "个人偏好" })).toBeTruthy();
    responses["/api/v1/search"] = { items: [] };
    fireEvent.click(within(dialog).getByRole("button", { name: t("palette.retrySearch") }));
    await waitFor(() => expect(within(dialog).queryByText(t("palette.searchFailed"))).toBeNull());
  });

  it("跨项目页面保留侧栏已选项目的命令上下文", async () => {
    localStorage.setItem("feronavi.project", projectId);
    const { router } = renderNavigation("/workbench", actor.permissions, [{ id: projectId, key: "DEMO", name: "已选项目" }]);
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: t("palette.dialog") });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "看板" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: /看板\s*DEMO/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/board`));
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("构建更新入口", () => {
  async function checkStatus(responses: Record<string, unknown>, buildVersion?: string) {
    responses["/api/v1/system/status"] = { ok: true, version: "0.1.0", buildVersion };
    await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  }

  beforeEach(() => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  it("开发环境构建产物变化时不显示更新提醒", async () => {
    vi.stubEnv("PROD", false);
    const { responses } = renderNavigation();
    await screen.findByText("v0.1.0");
    await checkStatus(responses, "build-b");
    expect(screen.queryByText(t("footer.updateAvailable"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("footer.refreshNow") })).toBeNull();
    expect(document.querySelector(".update-banner")).toBeNull();
  });

  it("正式环境仅在构建变化时提供底栏刷新入口，重复检查不占据内容区", async () => {
    vi.stubEnv("PROD", true);
    const { responses } = renderNavigation();
    await screen.findByText("v0.1.0");
    await checkStatus(responses, "build-a");
    expect(screen.queryByRole("button", { name: t("footer.refreshNow") })).toBeNull();
    await checkStatus(responses, "build-b");
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("button", { name: t("footer.refreshNow") })).toBeTruthy();
    await checkStatus(responses, "build-b");
    expect(within(footer).getAllByRole("button", { name: t("footer.refreshNow") })).toHaveLength(1);
    expect(document.querySelector(".update-banner")).toBeNull();
    expect(within(screen.getByRole("main")).getByText("页面内容")).toBeTruthy();
  });

  it("服务端回到当前构建后撤下刷新入口", async () => {
    vi.stubEnv("PROD", true);
    const { responses } = renderNavigation();
    await screen.findByText("v0.1.0");
    await checkStatus(responses, "build-b");
    expect(screen.getByRole("button", { name: t("footer.refreshNow") })).toBeTruthy();
    await checkStatus(responses, "build-a");
    expect(screen.queryByRole("button", { name: t("footer.refreshNow") })).toBeNull();
    expect(screen.getByText("v0.1.0")).toBeTruthy();
  });

  it("缺少构建信息或开发标识不能作为新版本", async () => {
    vi.stubEnv("PROD", true);
    const { responses } = renderNavigation();
    responses["/api/v1/system/status"] = { ok: true, version: "0.1.0", buildVersion: "dev" };
    await screen.findByText("v0.1.0");
    await checkStatus(responses, "build-a");
    expect(screen.queryByRole("button", { name: t("footer.refreshNow") })).toBeNull();
    await checkStatus(responses, "dev");
    await checkStatus(responses);
    expect(screen.queryByRole("button", { name: t("footer.refreshNow") })).toBeNull();
  });
});

describe("设置导航", () => {
  it("从账号菜单进入个人偏好时展开设置分组并显示当前入口", async () => {
    localStorage.setItem("feronavi.nav.v4", JSON.stringify({ settings: false, manage: false }));
    const { router } = renderNavigation();
    fireEvent.click(await screen.findByRole("button", { name: "账户菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "个人偏好" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/personal"));
    const nav = screen.getByRole("navigation", { name: "主导航" });
    await waitFor(() => expect(within(nav).getByRole("button", { name: "设置" }).getAttribute("aria-expanded")).toBe("true"));
    expect(within(nav).getByRole("link", { name: "个人偏好" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("button", { name: "管理" }).getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    ["外观", "个人偏好", "/settings/personal"],
    ["AI", "集成与自动化", "/settings/integrations"],
    ["SMTP", "组织与实例", "/settings/instance"],
  ])("命令面板搜索 %s 会直达对应设置分区", async (query, label, path) => {
    const { router } = renderNavigation();
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "命令面板" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: query } });
    fireEvent.click(await within(dialog).findByRole("button", { name: label }));

    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(screen.queryByRole("dialog", { name: "命令面板" })).toBeNull();
  });

  it("无管理权限时命令面板仍可找个人偏好，不展示 AI 或 SMTP 管理入口", async () => {
    renderNavigation("/projects", []);
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "命令面板" });
    const search = within(dialog).getByRole("combobox");
    fireEvent.change(search, { target: { value: "设置" } });
    expect(within(dialog).getByRole("button", { name: "个人偏好" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "集成与自动化" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "组织与实例" })).toBeNull();
    fireEvent.change(search, { target: { value: "AI" } });
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    fireEvent.change(search, { target: { value: "SMTP" } });
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
  });

  it("只有 API 令牌管理权限时不会显示无可操作内容的集成设置入口", async () => {
    renderNavigation("/projects", ["apikey:manage_any"]);
    await screen.findByRole("button", { name: "账户菜单" });
    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(nav).queryByRole("link", { name: "集成与自动化" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "个人偏好" })).toBeTruthy();
  });
});

describe("项目导航上下文", () => {
  it("同名项目视图页签显示项目编号并用完整名称提供悬停提示", async () => {
    const otherId = "22222222-2222-2222-2222-222222222222";
    sessionStorage.setItem("feronavi-workspace-tabs-v1", JSON.stringify([
      { path: `/projects/${projectId}/board`, labelKey: "nav.board" },
      { path: `/projects/${otherId}/board`, labelKey: "nav.board" },
    ]));
    const { router } = renderNavigation(`/projects/${projectId}/board`, actor.permissions, [
      { id: projectId, key: "DEMO", name: "第一个完整项目名称" },
      { id: otherId, key: "NEW", name: "第二个完整项目名称" },
    ]);
    const tabs = within(await screen.findByRole("navigation", { name: "工作区页签" }));
    expect((await tabs.findByRole("link", { name: "DEMO · 看板" })).getAttribute("title")).toBe("第一个完整项目名称 · 看板");
    const other = await tabs.findByRole("link", { name: "NEW · 看板" });
    expect(other.getAttribute("title")).toBe("第二个完整项目名称 · 看板");
    expect(tabs.getByRole("button", { name: "关闭页签 NEW · 看板" })).toBeTruthy();
    fireEvent.click(other);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${otherId}/board`));
  });

  it("页签溢出菜单仍显示项目编号并能打开对应项目", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    const otherId = "22222222-2222-2222-2222-222222222222";
    sessionStorage.setItem("feronavi-workspace-tabs-v1", JSON.stringify([
      { path: `/projects/${projectId}/board`, labelKey: "nav.board" },
      { path: `/projects/${otherId}/board`, labelKey: "nav.board" },
    ]));
    const { router } = renderNavigation(`/projects/${projectId}/board`, actor.permissions, [
      { id: projectId, key: "DEMO", name: "当前项目" },
      { id: otherId, key: "OTHER", name: "另一个完整项目名称" },
    ]);
    const tabs = await screen.findByRole("navigation", { name: "工作区页签" });
    await within(tabs).findByRole("link", { name: "DEMO · 看板" });
    const more = await within(tabs).findByRole("button", { name: /（1）/ });
    fireEvent.click(more);
    const firstItem = screen.getByRole("menuitem", { name: "OTHER · 看板" });
    expect(document.activeElement).toBe(firstItem);
    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "关闭页签 OTHER · 看板" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(more);
    const other = screen.getByRole("menuitem", { name: "OTHER · 看板" });
    expect(other.getAttribute("title")).toBe("另一个完整项目名称 · 看板");
    fireEvent.click(other);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${otherId}/board`));
  });

  it("全局与项目问题命令可区分且搜索重绘不会产生重复键", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { router } = renderNavigation(`/projects/${projectId}/board`, actor.permissions, [{ id: projectId, key: "DEMO", name: "测试项目" }]);
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "命令面板" });
    const search = within(dialog).getByRole("combobox");
    fireEvent.change(search, { target: { value: "问题" } });
    await waitFor(() => expect(dialog.textContent).toContain("DEMO"));
    const projectIssue = await within(dialog).findByRole("button", { name: /项目问题\s*DEMO/ });
    expect(within(dialog).getByRole("button", { name: /问题追踪\s*全部项目/ })).toBeTruthy();
    expect(within(dialog).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(search, { target: { value: "项目问题" } });
    fireEvent.change(search, { target: { value: "问题" } });
    expect(within(dialog).getAllByRole("option")).toHaveLength(2);
    fireEvent.click(projectIssue);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/issues`));

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(within(screen.getByRole("dialog", { name: "命令面板" })).getByRole("button", { name: /问题追踪\s*全部项目/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/issues"));
    expect(consoleError.mock.calls.filter((args) => args.some((message) => String(message).includes("same key")))).toHaveLength(0);
  });

  it("进入日历视图后工作项入口仍标记为当前位置", async () => {
    renderNavigation(`/projects/${projectId}/calendar`);
    const nav = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(nav).getByRole("link", { name: "工作项" }).getAttribute("aria-current")).toBe("page");
  });

  it("项目缓存更新后切换器同步最新列表与当前项目名称", async () => {
    localStorage.setItem("feronavi.project", projectId);
    const { client, responses } = renderNavigation("/workbench", actor.permissions, [{ id: projectId, key: "DEMO", name: "原项目名称" }]);
    const switcher = await screen.findByRole("button", { name: "切换当前项目" });
    await waitFor(() => expect(switcher.textContent).toContain("原项目名称"));

    responses["/api/v1/projects"] = { items: [
      { id: projectId, key: "DEMO", name: "已改名项目" },
      { id: "22222222-2222-2222-2222-222222222222", key: "NEW", name: "新建项目" },
    ], total: 2 };
    await act(async () => { await client.invalidateQueries({ queryKey: ["projects"] }); });

    await waitFor(() => expect(switcher.textContent).toContain("已改名项目"));
    fireEvent.click(switcher);
    const menu = screen.getByRole("menu", { name: "切换当前项目" });
    expect(within(menu).getByRole("menuitemradio", { name: /DEMO.*已改名项目/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { name: /NEW.*新建项目/ })).toBeTruthy();
    expect(within(menu).queryByRole("menuitemradio", { name: /原项目名称/ })).toBeNull();
  });

  it("命令面板打开文档搜索结果时保留命中文档 ID", async () => {
    const { router, responses } = renderNavigation();
    responses["/api/v1/search"] = { items: [{ type: "page", id: "target-page", key: "", title: "目标文档", projectId, projectKey: "DEMO" }] };
    await screen.findByRole("button", { name: "账户菜单" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "命令面板" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "目标" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: /目标文档/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/wiki`));
    expect(router.state.location.search).toMatchObject({ page: "target-page" });
  });
});

describe("移动端导航", () => {
  it("收起时隔离屏幕外链接，打开后限制焦点并在关闭时回到入口", async () => {
    mockMobileViewport(true);
    renderNavigation();
    const opener = await screen.findByRole("button", { name: "打开导航" });
    const sidebar = document.querySelector(".shell-sidebar")!;
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".shell-scrim")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();

    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "主导航" });
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(document.querySelector(".shell-main-col")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "关闭导航" }));

    const last = within(dialog).getByRole("button", { name: "平台" });
    const first = within(dialog).getByRole("link", { name: "Feronavi" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".shell-main-col")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("窄屏显示完整导航，回到桌面时仍保留原来的折叠偏好", async () => {
    localStorage.setItem("feronavi-sidebar", "collapsed");
    const setMobile = mockMobileViewport(false);
    renderNavigation();
    await screen.findByRole("button", { name: "账户菜单" });
    expect(document.querySelector(".shell")?.classList.contains("sidebar-collapsed")).toBe(true);

    act(() => setMobile(true));
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    expect(document.querySelector(".shell")?.classList.contains("sidebar-collapsed")).toBe(false);
    const nav = within(screen.getByRole("dialog", { name: "主导航" }));
    expect(nav.getByRole("link", { name: "个人偏好" })).toBeTruthy();

    act(() => setMobile(false));
    expect(document.querySelector(".shell")?.classList.contains("sidebar-collapsed")).toBe(true);
    expect(document.querySelector(".shell-sidebar")?.hasAttribute("inert")).toBe(false);
    expect(localStorage.getItem("feronavi-sidebar")).toBe("collapsed");
  });

  it("可从手机导航抽屉切换项目并在到达后关闭抽屉", async () => {
    mockMobileViewport(true);
    const { router } = renderNavigation("/projects", actor.permissions, [{ id: projectId, key: "DEMO", name: "手机项目" }]);
    fireEvent.click(await screen.findByRole("button", { name: "打开导航" }));
    const nav = screen.getByRole("dialog", { name: "主导航" });
    fireEvent.click(within(nav).getByRole("button", { name: "切换当前项目" }));
    fireEvent.click(await within(nav).findByRole("menuitemradio", { name: /DEMO.*手机项目/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}`));
    expect(screen.queryByRole("dialog", { name: "主导航" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    const switcher = within(screen.getByRole("dialog", { name: "主导航" })).getByRole("button", { name: "切换当前项目" });
    expect(switcher.textContent).toContain("手机项目");
  });
});
