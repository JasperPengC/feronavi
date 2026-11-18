import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { MembersPage } from "../src/client/routes/MembersPage.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { ToastHost } from "../src/client/components/ui/Toast.tsx";
import { setLocale, t } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const actor: Actor = { memberId: "admin", username: "admin", name: "管理员", permissions: ["member:invite", "member:manage"], dataScopes: [{ scopeType: "ORG", scopeId: null }], mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai", theme: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function mount(permissions = actor.permissions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<ActorContext.Provider value={{ ...actor, permissions }}><QueryClientProvider client={client}><MembersPage /><DialogHost /><ToastHost /></QueryClientProvider></ActorContext.Provider>);
}
function fill(dialog: HTMLElement) {
  for (const [label, value] of [["姓名", " 新成员 "], ["用户名", " New.Member "], ["邮箱", " New@Example.test "], ["初始密码", "initial-member-password"]]) {
    fireEvent.change(within(dialog).getByLabelText(label!, { exact: false }), { target: { value } });
  }
}
beforeEach(() => {
  setLocale("zh-CN");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("可从空成员目录直接创建，规范化账号字段并刷新目录", async () => {
  let created = false;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const path = String(url);
    if (path.endsWith("/members") && init?.method === "POST") {
      const input = JSON.parse(init.body as string);
      if (input.username !== "new.member" || input.email !== "new@example.test" || input.name !== "新成员" || input.password !== "initial-member-password") return json({ code: "VALIDATION", message: "创建参数错误" }, 400);
      created = true;
      return json({ id: "new", username: input.username }, 201);
    }
    if (path.endsWith("/members")) return json({ members: created ? [{ id: "new", username: "new.member", name: "新成员", email: "new@example.test", status: "ACTIVE", roles: [{ key: "MEMBER", name: "普通成员", scopeType: "ORG" }], load: 0, departmentId: null, positionId: null }] : [] });
    return json({ departments: [], positions: [] });
  }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "创建成员" }));
  const dialog = screen.getByRole("dialog", { name: "创建成员" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  fill(dialog);
  fireEvent.submit(within(dialog).getByRole("form", { name: "创建成员" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建成员" })).toBeNull());
  expect(await screen.findByText("new@example.test")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("新成员");
});

it("无创建权限时不显示入口，但仍可浏览成员目录", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ members: [], departments: [], positions: [] })));
  mount(["member:manage"]);
  await screen.findByRole("heading", { name: "成员", exact: true });
  expect(screen.queryByRole("button", { name: "创建成员" })).toBeNull();
});

it("无效输入在字段旁提示并聚焦，不向服务端提交", async () => {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.method === "POST") writes.push(init.body);
    return json({ members: [], departments: [], positions: [] });
  }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "创建成员" }));
  const dialog = screen.getByRole("dialog", { name: "创建成员" });
  fireEvent.submit(within(dialog).getByRole("form", { name: "创建成员" }));
  expect(within(dialog).getAllByRole("alert").length).toBe(4);
  expect(document.activeElement).toBe(within(dialog).getByLabelText("姓名", { exact: false }));
  expect(writes).toHaveLength(0);
});

it("提交中阻止关闭与重复提交，失败保留输入，退出未保存草稿须确认", async () => {
  let finish!: (response: Response) => void;
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.method === "POST") { writes++; return new Promise<Response>(resolve => { finish = resolve; }); }
    return json({ members: [], departments: [], positions: [] });
  }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "创建成员" }));
  const dialog = screen.getByRole("dialog", { name: "创建成员" });
  fill(dialog);
  fireEvent.submit(within(dialog).getByRole("form", { name: "创建成员" }));
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.submit(within(dialog).getByRole("form", { name: "创建成员" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭", exact: true }));
  expect(screen.getByRole("dialog", { name: "创建成员" })).toBeTruthy();
  expect(writes).toBe(1);
  await act(async () => finish(json({ code: "CONFLICT", message: "用户名已被占用" }, 409)));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("用户名已被占用");
  expect((within(dialog).getByLabelText("姓名", { exact: false }) as HTMLInputElement).value).toBe(" 新成员 ");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消", exact: true }));
  const confirmation = await screen.findByRole("dialog", { name: t("flows.discardDraft") });
  expect(confirmation).toBeTruthy();
  fireEvent.click(within(confirmation).getByRole("button", { name: t("common.cancel"), exact: true }));
});
