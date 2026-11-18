import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleAdminPage } from "../src/client/routes/RoleAdminPage.tsx";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { setLocale } from "../src/client/i18n/index.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

function actor(permissions: string[], scopeType: "ORG" | "TEAM" = "ORG"): Actor {
  return {
    memberId: MEMBER_ID,
    username: "manager",
    name: "组织管理员",
    permissions,
    dataScopes: [{ scopeType, scopeId: scopeType === "ORG" ? null : ORG_ID }],
    mustChangePassword: false,
    locale: "zh-CN",
    theme: null,
    timezone: null,
  };
}

function renderPage(currentActor: Actor) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActorContext.Provider value={currentActor}><RoleAdminPage /></ActorContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setLocale("zh-CN");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/roles/scope-options")) return new Response(JSON.stringify({ scopes: [] }), { status: 200 });
    if (url.includes("/api/v1/role-assignments")) return new Response(JSON.stringify({ assignments: [] }), { status: 200 });
    if (url.includes("/api/v1/roles")) return new Response(JSON.stringify({ roles: [
      { id: "role-admin", key: "ADMIN", name: "管理员", isBuiltin: true, isSystem: true, permissionKeys: ["role:manage"] },
    ] }), { status: 200 });
    if (url.includes("/api/v1/permissions")) return new Response(JSON.stringify({ groups: [
      { group: "平台", permissions: [{ key: "role:manage", group: "平台", description: "管理角色" }] },
    ] }), { status: 200 });
    if (url.includes("/api/v1/members")) return new Response(JSON.stringify({ members: [
      { id: MEMBER_ID, username: "manager", name: "组织管理员", status: "ACTIVE" },
    ] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("角色与权限管理页", () => {
  it("缺少 role:manage 或 ORG 范围时显示受限状态，不加载管理数据", () => {
    const fetchMock = vi.mocked(fetch);
    renderPage(actor(["member:manage"]));
    expect(screen.getByText("当前账号没有组织角色管理权限")).toBeTruthy();
    expect(screen.getByText(/role:manage 权限和 ORG 范围/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("展示服务端权限目录、系统角色只读标记及当前账号真实 grants/permissions", async () => {
    const fetchMock = vi.mocked(fetch);
    renderPage(actor(["role:manage", "org:manage"]));
    await waitFor(() => expect(screen.getByText("角色名称")).toBeTruthy());
    expect(screen.getAllByText("管理员").length).toBeGreaterThan(0);
    // 「系统内置，只读」现在出现两处：角色说明行 + 名称输入框的提示（表单统一后加的可读提示），
    // 断言"至少显示一处"即可，不再假设只有一处。
    expect(screen.getAllByText(/系统内置，只读/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "role:manage" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "成员角色指派" }));
    expect(screen.getByText("org:manage")).toBeTruthy();
    expect(screen.getAllByText("ORG").length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/roles"))).toBe(true);
  });

  it("具备权限但 API 不可用时明确显示管理数据加载错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "FORBIDDEN", message: "权限已变更", details: null }), { status: 403 })));
    renderPage(actor(["role:manage"]));
    await waitFor(() => expect(screen.getByText("角色管理数据加载失败")).toBeTruthy());
  });
});
