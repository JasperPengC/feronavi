import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/client/routes/AppShell.tsx";
import { LoginPage } from "../src/client/routes/LoginPage.tsx";
import { authNavigationSearch } from "../src/client/lib/auth-navigation.ts";
import { ChangePasswordPage } from "../src/client/routes/ChangePasswordPage.tsx";
import { setLocale, t } from "../src/client/i18n/index.ts";
import type { Actor } from "../src/client/lib/actor.ts";
import { apiGet, apiPost, apiStreamPost, apiUpload } from "../src/client/lib/api.ts";
import { DraftNavigationGuard } from "../src/client/components/ui/DraftNavigationGuard.tsx";

const projectId = "11111111-1111-1111-1111-111111111111";
const actor: Actor = {
  memberId: "navigation-test", username: "navigation", name: "导航测试", permissions: [],
  dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false,
  locale: "zh-CN", theme: "light", timezone: "Asia/Shanghai",
};
const clients: QueryClient[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

function renderAuth(path: string, options: { signedIn?: boolean; mustChangePassword?: boolean; rejectLogin?: boolean; rejectLogout?: boolean; sessionStatus?: number; guard?: "dirty" | "saving"; loginMemberId?: string } = {}) {
  const state = { signedIn: false, mustChangePassword: false, rejectLogin: false, rejectLogout: false, sessionStatus: 403, memberId: actor.memberId, loginMemberId: actor.memberId, ...options };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(input), "http://localhost").pathname;
    if (pathname === "/api/v1/auth/login") {
      if (state.rejectLogin) return json({ code: "UNAUTHORIZED", message: "用户名或密码错误" }, 401);
      state.signedIn = true;
      state.memberId = state.loginMemberId;
      return json({ ok: true });
    }
    if (pathname === "/api/v1/auth/password/change" && init?.method === "POST") {
      state.signedIn = false;
      state.mustChangePassword = false;
      return json({ ok: true });
    }
    if (pathname === "/api/v1/auth/logout") {
      if (state.rejectLogout) return json({ code: "INTERNAL", message: "退出失败，请重试" }, 500);
      state.signedIn = false;
      return json({ ok: true });
    }
    if (pathname === "/api/v1/auth/me") return state.signedIn
      ? json({ ...actor, memberId: state.memberId, mustChangePassword: state.mustChangePassword })
      : json({ code: "UNAUTHORIZED", message: "请先登录" }, 401);
    if (pathname === "/api/v1/private-page" || pathname === "/api/v1/auth/2fa/setup") return state.signedIn
      ? json({ code: "FORBIDDEN", message: "无权访问该资源" }, 403)
      : json({ code: "FORBIDDEN", message: "未登录或会话已失效" }, state.sessionStatus);
    if (pathname === "/api/v1/organization") return json({ name: "测试组织" });
    if (pathname === "/api/v1/setup/state") return json({ initialized: true, passwordResetEnabled: false });
    if (pathname.endsWith("/providers")) return json({ providers: [] });
    if (pathname === "/api/v1/projects") return json({ items: [{ id: projectId, key: "TEST", name: "测试项目" }], total: 1 });
    if (pathname === "/api/v1/notifications") return json({ items: [], unreadCount: 0 });
    if (pathname === "/api/v1/presence") return json({ online: [], count: 0 });
    if (pathname === "/api/v1/system/status") return json({ ok: true, version: "test" });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  const root = createRootRoute({ component: Outlet });
  const login = createRoute({ getParentRoute: () => root, path: "/login", component: LoginPage, validateSearch: authNavigationSearch });
  const changePassword = createRoute({ getParentRoute: () => root, path: "/change-password", component: ChangePasswordPage, validateSearch: authNavigationSearch });
  const app = createRoute({ getParentRoute: () => root, id: "_app", component: AppShell });
  const destinations = ["/projects", "/projects/$projectId/wiki", "/projects/$projectId/table"].map((route) =>
    createRoute({ getParentRoute: () => app, path: route, component: () => <><DraftNavigationGuard dirty={state.guard === "dirty"} saving={state.guard === "saving"} message="尚有未保存的内容" /><p>目标页面</p></> }),
  );
  const router = createRouter({ routeTree: root.addChildren([login, changePassword, app.addChildren(destinations)]),
    history: createMemoryHistory({ initialEntries: [path] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, client, state, fetchMock };
}

async function signIn() {
  fireEvent.change(await screen.findByLabelText(/用户名/), { target: { value: "navigation" } });
  fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: "valid-password" } });
  fireEvent.click(screen.getByRole("button", { name: "登录", exact: true }));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("zh-CN");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => {
  // Toast 的存储在组件外；关闭已出现的消息，避免下一个用例继承。
  document.querySelectorAll<HTMLButtonElement>(".ui-toast-close").forEach((button) => fireEvent.click(button));
  cleanup(); clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  localStorage.clear(); sessionStorage.clear();
});

describe("登录返回原页面", () => {
  it("已登录账号直接进入登录页切换账号后清除原账号缓存", async () => {
    const { client, router } = renderAuth("/projects", { signedIn: true, loginMemberId: "second-account" });
    await screen.findByText("目标页面");
    client.setQueryData(["private-page-data"], { content: "原账号正文" });
    await router.navigate({ to: "/login" });
    await screen.findByRole("heading", { name: "登录" });
    await signIn();
    await screen.findByText("目标页面");
    expect(client.getQueryData(["actor"])).toMatchObject({ memberId: "second-account" });
    expect(client.getQueryData(["private-page-data"])).toBeUndefined();
  });

  it.each([
    { transition: "logout", pendingBody: false }, { transition: "expired", pendingBody: false },
    { transition: "expired", pendingBody: true },
  ])("$transition 后旧发布请求（pendingBody=$pendingBody）的成功回调不会回填新会话缓存", async ({ transition, pendingBody }) => {
    const { client, state, fetchMock } = renderAuth("/projects", { signedIn: true });
    await screen.findByText("目标页面");
    let finishOldRequest!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finishOldRequest = resolve; });
    let finishBody!: (payload: unknown) => void;
    const body = new Promise<unknown>((resolve) => { finishBody = resolve; });
    const oldResponse = json({ content: "旧账号私有正文" });
    const parseBody = vi.spyOn(oldResponse, "json").mockImplementation(() => body);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname === "/api/v1/pages/old-private-page" ? response : fetchMock(input, init));
    const cacheKey = ["page", "old-private-page"];
    const onSuccess = vi.fn((data: unknown) => { client.setQueryData(cacheKey, data); });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => apiPost("/api/v1/pages/old-private-page", { content: "旧账号私有正文" }), onSuccess,
    });
    const outcome = mutation.execute(undefined).then(() => null, (error: unknown) => error);
    await waitFor(() => expect(mutation.state.status).toBe("pending"));
    if (pendingBody) {
      finishOldRequest(oldResponse);
      await waitFor(() => expect(parseBody).toHaveBeenCalled());
    }
    if (transition === "logout") {
      fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
      fireEvent.click(screen.getByRole("menuitem", { name: t("header.logout") }));
    } else {
      state.signedIn = false;
      await expect(apiGet("/api/v1/private-page")).rejects.toMatchObject({ status: 403 });
    }
    await screen.findByRole("heading", { name: "登录" });
    await signIn();
    await screen.findByText("目标页面");
    client.setQueryData(cacheKey, { content: "新会话数据" });
    if (pendingBody) finishBody({ content: "旧账号私有正文" });
    else finishOldRequest(json({ content: "旧账号私有正文" }));
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getQueryData(cacheKey)).toEqual({ content: "新会话数据" });
  });

  it.each(["dirty", "saving"] as const)("会话过期时登录拦截能通过 %s 导航保护", async (guard) => {
    const { router, state } = renderAuth("/projects", { signedIn: true, guard });
    await screen.findByText("目标页面");
    state.signedIn = false;
    await expect(apiGet("/api/v1/private-page")).rejects.toMatchObject({ status: 403 });
    await screen.findByRole("heading", { name: "登录" });
    expect(router.state.location.search).toMatchObject({ returnTo: "/projects" });
  });
  it.each([401, 403])("旧会话迟到的 %s 不会让重新登录后的新会话退出", async (status) => {
    const { client, fetchMock } = renderAuth("/projects", { signedIn: true });
    await screen.findByText("目标页面");
    let finishOldRequest!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finishOldRequest = resolve; });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname === "/api/v1/late-request" ? response : fetchMock(input, init));
    const oldRequest = apiGet("/api/v1/late-request");
    fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("header.logout") }));
    await screen.findByRole("heading", { name: "登录" });
    await signIn();
    await screen.findByText("目标页面");
    client.setQueryData(["new-session-data"], { title: "新会话" });
    finishOldRequest(json({ code: "FORBIDDEN", message: "未登录或会话已失效" }, status));
    await expect(oldRequest).rejects.toMatchObject({ status });
    expect(screen.getByText("目标页面")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "登录" })).toBeNull();
    expect(client.getQueryData(["new-session-data"])).toEqual({ title: "新会话" });
  });

  it.each([401, 403])("缓存身份仍有效时，业务接口 %s 会拦截失效会话并清除缓存", async (sessionStatus) => {
    const target = `/projects/${projectId}/table?item=expired-item#details`;
    const { router, client, state } = renderAuth(target, { signedIn: true, sessionStatus });
    await screen.findByText("目标页面");
    client.setQueryData(["private-page-data"], { title: "旧会话数据" });
    state.signedIn = false;
    await expect(apiGet("/api/v1/private-page")).rejects.toMatchObject({ status: sessionStatus });
    await screen.findByRole("heading", { name: "登录" });
    expect(router.state.location.search).toMatchObject({ returnTo: target });
    expect(client.getQueryData(["private-page-data"])).toBeUndefined();
    await signIn();
    await screen.findByText("目标页面");
    expect(router.state.location.href).toBe(target);
  });

  it.each(["json", "upload", "stream", "security"])("%s 写请求同样拦截失效会话", async (kind) => {
    const { router, state } = renderAuth("/projects", { signedIn: true });
    await screen.findByText("目标页面");
    state.signedIn = false;
    const request = kind === "upload" ? apiUpload("/api/v1/private-page", new FormData())
      : kind === "stream" ? apiStreamPost("/api/v1/private-page", {})
      : kind === "security" ? apiPost("/api/v1/auth/2fa/setup", {}) : apiPost("/api/v1/private-page", {});
    await expect(request).rejects.toMatchObject({ status: 403 });
    await screen.findByRole("heading", { name: "登录" });
    expect(router.state.location.search).toMatchObject({ returnTo: "/projects" });
  });

  it("普通权限拒绝保留登录状态和页面缓存", async () => {
    const { router, client } = renderAuth("/projects", { signedIn: true });
    await screen.findByText("目标页面");
    client.setQueryData(["private-page-data"], { title: "可见数据" });
    await expect(apiGet("/api/v1/private-page")).rejects.toMatchObject({ status: 403 });
    expect(router.state.location.pathname).toBe("/projects");
    expect(client.getQueryData(["private-page-data"])).toEqual({ title: "可见数据" });
    expect(screen.queryByRole("heading", { name: "登录" })).toBeNull();
  });

  it("本地2FA挑战后可输入动态码并携带remember再次登录", async () => {
    const { router } = renderAuth("/login");
    let signedIn = false;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/v1/auth/login") {
        const body = JSON.parse(String(init?.body)); bodies.push(body);
        if (!body.totpCode) return json({ code: "FORBIDDEN", message: "需要双因素验证码", details: { twoFactorRequired: true } }, 403);
        signedIn = true; return json({ ok: true });
      }
      if (path === "/api/v1/auth/me") return signedIn ? json(actor) : json({ code: "UNAUTHORIZED" }, 401);
      if (path.endsWith("/providers")) return json({ providers: [] });
      return json({ initialized: true, name: "测试组织" });
    }));
    await signIn();
    const code = await screen.findByLabelText("双因素动态验证码");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "登录", exact: true }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(bodies[1]).toMatchObject({ username: "navigation", totpCode: "123456", remember: false });
  });
  it.each([
    [`/projects/${projectId}/wiki?page=target-page#section-2`, { page: "target-page" }, "section-2"],
    [`/projects/${projectId}/table?item=target-work-item&view=mine`, { item: "target-work-item", view: "mine" }, ""],
  ])("保留未登录深链 %s 的查询参数和锚点", async (target, search, hash) => {
    const { router } = renderAuth(target);
    await screen.findByRole("heading", { name: "登录" });
    expect(router.state.location.search).toMatchObject({ returnTo: target });
    await signIn();
    await screen.findByText("目标页面");
    expect(router.state.location.pathname).toBe(target.split(/[?#]/)[0]);
    expect(router.state.location.search).toMatchObject(search);
    expect(router.state.location.hash).toBe(hash);
    expect(within(document.querySelector(".ui-toast-host")!).getByText("登录成功")).toBeTruthy();
  });

  it("强制改密、重新登录后仍返回最初工作项，并明确显示改密完成", async () => {
    const target = `/projects/${projectId}/table?item=target-item#details`;
    const { router, client } = renderAuth(target, { mustChangePassword: true });
    await signIn();
    await screen.findByRole("heading", { name: "修改密码" });
    expect(router.state.location.search).toMatchObject({ returnTo: target });
    client.setQueryData(["private-before-password-change"], { title: "旧会话缓存" });
    fireEvent.change(screen.getByLabelText(/当前密码/), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText(/^新密码/), { target: { value: "new-password-12" } });
    fireEvent.change(screen.getByLabelText(/确认新密码/), { target: { value: "new-password-12" } });
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await screen.findByRole("heading", { name: "登录" });
    expect(screen.getByRole("status").textContent).toBe("密码已修改，请重新登录");
    expect(client.getQueryData(["private-before-password-change"])).toBeUndefined();
    await signIn();
    await screen.findByText("目标页面");
    expect(router.state.location.pathname).toBe(`/projects/${projectId}/table`);
    expect(router.state.location.search).toMatchObject({ item: "target-item" });
    expect(router.state.location.hash).toBe("details");
  });

  it.each(["https://example.com/", "//example.com/", "/\\example.com/", "/%5cexample.com/", "/login?returnTo=/login", "/change-password", "/api/v1/auth/logout", "/projects/../../login", "/projects\n/anything"])(
    "拒绝不安全或认证循环的返回地址 %s", async (target) => {
      const { router } = renderAuth(`/login?${new URLSearchParams({ returnTo: target })}`);
      await signIn();
      await screen.findByText("目标页面");
      expect(router.state.location.pathname).toBe("/projects");
    },
  );

  it("登录失败作为警告宣读且保留用户名与返回目标", async () => {
    const target = `/projects/${projectId}/wiki?page=target-page`;
    const { router } = renderAuth(`/login?${new URLSearchParams({ returnTo: target })}`, { rejectLogin: true });
    await signIn();
    expect((await screen.findByRole("alert")).textContent).toBe("用户名或密码错误");
    expect((screen.getByLabelText(/用户名/) as HTMLInputElement).value).toBe("navigation");
    expect(router.state.location.search).toMatchObject({ returnTo: target });
    expect(router.state.location.pathname).toBe("/login");
  });

  it("企业登录回调后消费当前标签页的待返回目标", async () => {
    const target = `/projects/${projectId}/wiki?page=sso-page#sso-heading`;
    sessionStorage.setItem("feronavi.auth.sso-return", JSON.stringify({ returnTo: target, startedAt: Date.now() }));
    const { router } = renderAuth("/projects", { signedIn: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/wiki`));
    expect(router.state.location.search).toMatchObject({ page: "sso-page" });
    expect(router.state.location.hash).toBe("sso-heading");
    expect(sessionStorage.getItem("feronavi.auth.sso-return")).toBeNull();
  });

  it("过期的企业登录返回记录不会覆盖当前页面", async () => {
    sessionStorage.setItem("feronavi.auth.sso-return", JSON.stringify({ returnTo: `/projects/${projectId}/wiki`, startedAt: Date.now() - 11 * 60_000 }));
    const { router } = renderAuth("/projects", { signedIn: true });
    await screen.findByText("目标页面");
    expect(router.state.location.pathname).toBe("/projects");
    expect(sessionStorage.getItem("feronavi.auth.sso-return")).toBeNull();
  });

  it("退出成功后清除旧账号缓存", async () => {
    const { router, client } = renderAuth("/projects", { signedIn: true });
    fireEvent.click(await screen.findByRole("button", { name: "账户菜单" }));
    client.setQueryData(["private-account-data"], { title: "旧账号数据" });
    fireEvent.click(screen.getByRole("menuitem", { name: t("header.logout") }));
    await screen.findByRole("heading", { name: "登录" });
    expect(client.getQueryData(["private-account-data"])).toBeUndefined();
    expect(client.getQueryData(["actor"])).toBeUndefined();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("退出失败保留会话并提供可宣读的错误", async () => {
    const { router } = renderAuth("/projects", { signedIn: true, rejectLogout: true });
    fireEvent.click(await screen.findByRole("button", { name: "账户菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("header.logout") }));
    expect((await screen.findByRole("alert")).textContent).toContain("退出失败，请重试");
    expect(router.state.location.pathname).toBe("/projects");
  });
});
