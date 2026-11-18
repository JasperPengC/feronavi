import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { ScimSettings } from "../src/client/components/settings/ScimSettings.tsx";
import { InvitePanel } from "../src/client/components/InvitePanel.tsx";
import { TeamPanel } from "../src/client/components/TeamPanel.tsx";
import { OrganizationPage } from "../src/client/routes/OrganizationPage.tsx";
import { MembersPage } from "../src/client/routes/MembersPage.tsx";
import { RoleAdminPage } from "../src/client/routes/RoleAdminPage.tsx";
import { SystemPage } from "../src/client/routes/SystemPage.tsx";
import { IntegrationSettings } from "../src/client/components/settings/IntegrationSettings.tsx";
import { ProjectSettingsDrawer } from "../src/client/components/project/ProjectSettingsDrawer.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale, t } from "../src/client/i18n/index.ts";

const actor: Actor = { memberId: "m1", name: "管理员", username: "admin", permissions: ["setting:manage", "member:invite", "member:manage", "role:manage"], dataScopes: [{ scopeType: "ORG", scopeId: null }], locale: "zh-CN", timezone: "Asia/Shanghai", theme: null, mustChangePassword: false };
const clients: QueryClient[] = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(qc);
  return render(<ActorContext.Provider value={actor}><QueryClientProvider client={qc}>{node}<DialogHost /></QueryClientProvider></ActorContext.Provider>);
}
beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("scrollTo", vi.fn()); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); clients.splice(0).forEach(qc => qc.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("SCIM复制被拒绝时显示失败而不宣称成功，明文仍可手动复制", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => json(init?.method === "POST" ? { token: "scim-once" } : { tokens: [] })));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const onSuccess = vi.fn(), onError = vi.fn();
  mount(<ScimSettings onSuccess={onSuccess} onError={onError} />);
  fireEvent.click(screen.getByRole("button", { name: t("se.scimCreate") }));
  await screen.findByText("scim-once"); onSuccess.mockClear();
  fireEvent.click(screen.getByRole("button", { name: t("se.scimCopy") }));
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(onSuccess).not.toHaveBeenCalled(); expect(screen.getByText("scim-once")).toBeTruthy();
});

it.each([["邀请", InvitePanel, "invite.empty"], ["团队", TeamPanel, "team.empty"]] as const)("%s读取失败不显示空列表，原位重试可恢复", async (_name, Component, emptyKey) => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = String(url);
    if (path.endsWith("/invites") || path.endsWith("/teams")) return failed ? json({ message: "暂时不可用", code: "INTERNAL" }, 503) : json({ invites: [], teams: [] });
    return json({ items: [], roles: [] });
  }));
  mount(<Component />);
  await screen.findByRole("alert"); expect(screen.queryByText(t(emptyKey))).toBeNull(); failed = false;
  fireEvent.click(screen.getByRole("button", { name: t("common.reload") }));
  expect(await screen.findByText(t(emptyKey))).toBeTruthy();
});

it("邀请创建失败显示在抽屉内并保留邮箱，保存中不能关闭", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) : json({ invites: [], items: [], roles: [] })));
  mount(<InvitePanel />);
  fireEvent.click(screen.getByRole("button", { name: t("invite.new") }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: t("invite.email") }), { target: { value: "person@example.test" } });
  fireEvent.click(within(dialog).getByRole("button", { name: t("invite.create") }));
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish(json({ message: "邀请服务暂时不可用", code: "INTERNAL" }, 503)));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("邀请服务暂时不可用");
  expect((within(dialog).getByRole("textbox", { name: t("invite.email") }) as HTMLInputElement).value).toBe("person@example.test");
});

it.each([["/invite/example", "invite.invalid"], ["/intake/example", "pi.invalid"]])("公开入口 %s 将暂时网络错误与失效链接分开，支持重试", async (path, invalidKey) => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("/example")) return failed ? json({ message: "暂时不可用", code: "INTERNAL" }, 503) : json({ valid: true, name: "客户反馈", schema: [] });
    return json({});
  }));
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] })); mount(<RouterProvider router={router} />);
  await screen.findByRole("alert"); expect(screen.queryByText(t(invalidKey))).toBeNull(); failed = false;
  fireEvent.click(screen.getByRole("button", { name: t("common.reload") }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("button", { name: path.startsWith("/invite") ? t("invite.accept") : t("pi.submit") })).toBeTruthy();
});

it("组织分区支持方向键导航，岗位操作不混入 tablist", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ departments: [], positions: [], members: [] })));
  mount(<OrganizationPage />);
  const members = await screen.findByRole("tab", { name: /成员/ });
  const positions = screen.getByRole("tab", { name: /职位/ });
  members.focus();
  fireEvent.keyDown(members, { key: "ArrowRight" });
  expect(document.activeElement).toBe(positions);
  expect(positions.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").id).toBe(positions.getAttribute("aria-controls"));
  const add = screen.getByRole("button", { name: t("org.addPosition") });
  expect(add.closest('[role="tablist"]')).toBeNull();
  fireEvent.keyDown(positions, { key: "Home" });
  expect(document.activeElement).toBe(members);
  expect(screen.getByRole("tabpanel").id).toBe(members.getAttribute("aria-controls"));
  expect(screen.queryByRole("button", { name: t("org.addPosition") })).toBeNull();
});

it("组织新建保存中不能关闭，失败在抽屉内并可重试", async () => {
  let finish!: (response: Response) => void;
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.method === "POST") { writes++; return writes === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : json({ id: "d1" }); }
    return json({ departments: [], positions: [], members: [] });
  }));
  mount(<OrganizationPage />);
  fireEvent.click(await screen.findByRole("button", { name: t("org.addDepartment") }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: t("org.name") }), { target: { value: "体验团队" } });
  fireEvent.click(within(dialog).getByRole("button", { name: t("common.save") }));
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.keyDown(document, { key: "Escape" }); expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish(json({ code: "INTERNAL", message: "组织服务不可用" }, 503)));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("组织服务不可用");
  expect((within(dialog).getByRole("textbox", { name: t("org.name") }) as HTMLInputElement).value).toBe("体验团队");
  fireEvent.click(within(dialog).getByRole("button", { name: t("common.save") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(writes).toBe(2);
});

it("项目设置关闭可取消放弃，后台项目刷新保留当前输入", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => json(String(url).includes("statuses") ? [] : { members: [] })));
  const project = { id: "p1", name: "原名称", description: "原描述", lead: null, status: null };
  const onClose = vi.fn();
  const mounted = mount(<ProjectSettingsDrawer open project={project} onClose={onClose} onSaved={vi.fn()} />);
  const name = screen.getByRole("textbox", { name: t("common.name") });
  fireEvent.change(name, { target: { value: "未保存名称" } });
  fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
  await screen.findByText(t("flows.discardDraft"));
  fireEvent.click(screen.getAllByRole("button", { name: t("common.cancel") }).at(-1)!);
  expect(onClose).not.toHaveBeenCalled(); expect((name as HTMLInputElement).value).toBe("未保存名称");
  const qc = clients.at(-1)!;
  mounted.rerender(<ActorContext.Provider value={actor}><QueryClientProvider client={qc}><ProjectSettingsDrawer open project={{ ...project, name: "后台新名称" }} onClose={onClose} onSaved={vi.fn()} /><DialogHost /></QueryClientProvider></ActorContext.Provider>);
  expect((screen.getByRole("textbox", { name: t("common.name") }) as HTMLInputElement).value).toBe("未保存名称");
});

it("集成配置无效JSON与保存错误显示在当前弹窗，取消不丢草稿", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "POST" ? json({ code: "INTERNAL", message: "暂时无法保存集成" }, 503) : json({ integrations: [], items: [] })));
  mount(<IntegrationSettings onSuccess={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: `+ ${t("se.intgAdd")}` }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: t("se.intgName") }), { target: { value: "仓库连接" } });
  fireEvent.change(within(dialog).getByLabelText(t("se.intgToken")), { target: { value: "test-token" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: t("se.intgConfig") }), { target: { value: "{bad" } });
  fireEvent.click(within(dialog).getByRole("button", { name: t("se.intgNew") }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain(t("se.intgConfigInvalid"));
  fireEvent.change(within(dialog).getByRole("textbox", { name: t("se.intgConfig") }), { target: { value: "{}" } });
  fireEvent.click(within(dialog).getByRole("button", { name: t("se.intgNew") }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("暂时无法保存集成"));
  expect((within(dialog).getByRole("textbox", { name: t("se.intgName") }) as HTMLInputElement).value).toBe("仓库连接");
});

it("角色草稿切换时可取消，未生效权限不能勾选", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (String(url).endsWith("/permissions")) return json({ groups: [{ group: "项目", permissions: [{ key: "project:delete", group: "项目", description: "删除项目（预留）" }] }] });
    if (String(url).endsWith("/roles")) return json({ roles: [{ id: "r1", name: "业务成员", key: "CUSTOM", permissionKeys: [], isBuiltin: false, isSystem: false }, { id: "r2", name: "其他角色", key: "OTHER", permissionKeys: [], isBuiltin: false, isSystem: false }] });
    return json({ members: [], assignments: [] });
  }));
  mount(<RoleAdminPage />);
  const input = await screen.findByRole("textbox", { name: t("rbac.name") });
  await waitFor(() => expect((input as HTMLInputElement).value).toBe("业务成员"));
  expect((screen.getByRole("button", { name: t("common.save") }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox", { name: "project:delete" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByText("删除项目（预留）")).toBeNull();
  fireEvent.change(input, { target: { value: "角色草稿" } });
  expect((screen.getByRole("button", { name: t("common.save") }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("tab", { name: t("rbac.assignments") }));
  expect(screen.queryByRole("textbox", { name: t("rbac.name") })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: t("rbac.roleList") }));
  expect((screen.getByRole("textbox", { name: t("rbac.name") }) as HTMLInputElement).value).toBe("角色草稿");
  fireEvent.click(screen.getByText("其他角色"));
  await screen.findByText(t("flows.discardDraft"));
  fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
  expect((input as HTMLInputElement).value).toBe("角色草稿");
});

it("系统导出创建失败后可原位重试，卸载清理轮询", async () => {
  window.history.replaceState(null, "", "/system?tab=data");
  let writes = 0;
  const clear = vi.spyOn(globalThis, "clearInterval");
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).endsWith("/system/exports") && init?.method === "POST") return ++writes === 1 ? json({ code: "INTERNAL", message: "导出暂时不可用" }, 503) : json({ id: "export1" });
    if (String(url).endsWith("/system/migrations")) return json({ applied: 1, files: 1, consistent: true, notes: [], upgradeFlow: [] });
    return json({ ok: true, configured: false, jobs: {}, webhooks: { endpoints: 0, pending: 0, retrying: 0, dead: 0 }, integrations: { active: 0, total: 0 }, featureFlags: { enabled: 0, total: 0 }, mcp: { clients: 0, calls: 0 }, knowledge: { queries30d: 0 } });
  }));
  const mounted = mount(<SystemPage />);
  fireEvent.click(await screen.findByRole("button", { name: t("sys.exportStart") }));
  await screen.findByText(/导出暂时不可用/u);
  fireEvent.click(screen.getByRole("button", { name: t("sys.exportStart") }));
  await waitFor(() => expect(writes).toBe(2));
  await screen.findByText(t("sys.exportGenerating")); mounted.unmount(); expect(clear).toHaveBeenCalled();
  window.history.replaceState(null, "", "/");
});

it("成员归属保存失败显示在当前抽屉并保留选择", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "PATCH") return json({ code: "INTERNAL", message: "部门保存失败，请重试" }, 503);
    if (String(url).endsWith("/members")) return json({ members: [{ id: "m2", name: "业务成员", username: "member", email: "member@example.test", status: "ACTIVE", roles: [], load: 0, departmentId: null, positionId: null }], metric: "assigned" });
    return json({ departments: [{ id: "d1", name: "产品部" }], positions: [] });
  }));
  mount(<MembersPage />);
  fireEvent.click(await screen.findByRole("button", { name: t("org.assign") }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: t("org.department") }));
  fireEvent.click(await screen.findByRole("option", { name: "产品部" }));
  fireEvent.click(within(dialog).getByRole("button", { name: t("common.save") }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("部门保存失败，请重试");
  expect(within(dialog).getByRole("button", { name: t("org.department") }).textContent).toContain("产品部");
});
