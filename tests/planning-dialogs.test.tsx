import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { makeRouter } from "../src/client/router.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const milestone = { id: "ms1", name: "发布验收", description: "现有说明", dueDate: "2026-12-10", archivedAt: null };
const iteration = { id: "it1", name: "移动端验收迭代与交付阶段", startDate: "2026-11-01", endDate: "2026-11-14", archivedAt: null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const discard = "有未保存的修改。确认放弃修改并关闭？";
type Handler = (path: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function mount(handler: Handler = () => undefined) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const response = handler(path, init);
    if (response) return response;
    if (path.endsWith("/auth/me")) return json({ memberId: "m1", username: "demo", name: "测试", permissions: ["milestone:manage"], dataScopes: [], locale: "zh-CN", mustChangePassword: false });
    if (path.endsWith("/projects")) return json({ items: [] });
    if (path.endsWith("/notifications")) return json({ items: [], unreadCount: 0 });
    if (path.endsWith("/system/status")) return json({ ok: true });
    if (path.endsWith("/milestones")) return json([milestone]);
    if (path.endsWith("/iterations")) return json([iteration]);
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(qc);
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/projects/p1/milestones"] }));
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

beforeEach(() => {
  setLocale("zh-CN");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("里程碑表单捕获焦点并循环 Tab，未改动时 Escape 关闭且焦点返回入口", async () => {
  // jsdom 不做布局，只模拟可见性以验证 Modal 的键盘事件边界。
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
  mount();
  const trigger = await screen.findByRole("button", { name: "新建里程碑", exact: true });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "新建里程碑", exact: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  const close = within(dialog).getByRole("button", { name: "关闭", exact: true });
  const cancel = within(dialog).getByRole("button", { name: "取消", exact: true });
  cancel.focus(); fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("编辑已有里程碑不误判草稿；改动后 Esc、遮罩均先确认，取消保留输入", async () => {
  mount();
  const names = await screen.findAllByRole("link", { name: milestone.name, exact: true });
  const row = names.map((name) => name.closest("tr")).find(Boolean)!;
  fireEvent.click(within(row).getByRole("button", { name: "编辑", exact: true }));
  let dialog = await screen.findByRole("dialog", { name: "编辑里程碑", exact: true });
  expect((within(dialog).getByLabelText("名称") as HTMLInputElement).value).toBe(milestone.name);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(within(row).getByRole("button", { name: "编辑", exact: true }));
  dialog = await screen.findByRole("dialog", { name: "编辑里程碑", exact: true });
  fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "保留修改" } });
  fireEvent.keyDown(dialog, { key: "Escape" });
  const confirmation = await screen.findByRole("dialog", { name: discard });
  fireEvent.click(within(confirmation).getByRole("button", { name: "取消", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: discard })).toBeNull());
  expect((within(dialog).getByLabelText("名称") as HTMLInputElement).value).toBe("保留修改");
  fireEvent.mouseDown(dialog.parentElement!);
  fireEvent.click(within(await screen.findByRole("dialog", { name: discard })).getByRole("button", { name: "确认", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("保存期间不能关闭、改值或重复提交，失败后保留草稿并允许重试", async () => {
  let finish: ((response: Response) => void) | undefined;
  let writes = 0;
  mount((path, init) => path.endsWith("/milestones") && init?.method === "POST"
    ? (++writes === 1 ? new Promise<Response>((resolve) => { finish = resolve; }) : json(milestone, 201)) : undefined);
  fireEvent.click(await screen.findByRole("button", { name: "新建里程碑", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "新建里程碑", exact: true });
  fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "待保存" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect((within(dialog).getByLabelText("名称") as HTMLInputElement).disabled || !!within(dialog).getByLabelText("名称").closest("fieldset:disabled")).toBe(true);
  expect((within(dialog).getByRole("button", { name: "取消", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭", exact: true }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.mouseDown(dialog.parentElement!);
  fireEvent.submit(dialog.querySelector("form")!);
  expect(screen.getByRole("dialog", { name: "新建里程碑", exact: true })).toBe(dialog);
  expect(screen.queryByRole("dialog", { name: discard })).toBeNull();
  expect(writes).toBe(1);
  await act(async () => { finish?.(json({ code: "INTERNAL", message: "保存暂时失败" }, 503)); });
  await screen.findByText("保存暂时失败");
  expect((within(dialog).getByLabelText("名称") as HTMLInputElement).value).toBe("待保存");
  fireEvent.click(within(dialog).getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toBe(2);
});

it("里程碑未保存时站内导航可以取消，确认后才离开", async () => {
  const router = mount();
  fireEvent.click(await screen.findByRole("button", { name: "新建里程碑", exact: true }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "导航前草稿" } });
  act(() => { void router.navigate({ to: "/projects" }); });
  fireEvent.click(within(await screen.findByRole("dialog", { name: discard })).getByRole("button", { name: "取消", exact: true }));
  expect(router.state.location.pathname).toBe("/projects/p1/milestones");
  expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("导航前草稿");
  act(() => { void router.navigate({ to: "/projects" }); });
  fireEvent.click(within(await screen.findByRole("dialog", { name: discard })).getByRole("button", { name: "确认", exact: true }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
});

it("计划实体和容量读取失败显示实际错误，可原位重试且读取前不能保存容量", async () => {
  let planReads = 0, capacityReads = 0;
  mount((path) => {
    if (path.endsWith("/iterations")) return ++planReads === 1 ? json({ code: "INTERNAL", message: "迭代读取暂时失败" }, 503) : json([iteration]);
    if (path.endsWith("/it1/capacity")) return ++capacityReads === 1 ? json({ code: "INTERNAL", message: "容量读取暂时失败" }, 503) : json({ members: [{ memberId: "m1", name: "成员甲", username: "demo", capacityPoints: 8, capacityHours: null, loggedPoints: 0 }] });
  });
  fireEvent.click(await screen.findByRole("tab", { name: "迭代", exact: true }));
  const error = await screen.findByText("迭代读取暂时失败");
  expect(document.querySelector(".plan-entities")?.textContent).not.toContain("还没有");
  fireEvent.click(within(error.closest('[role="alert"]')!).getByRole("button", { name: "重新载入", exact: true }));
  await screen.findByText(iteration.name);
  fireEvent.click(screen.getByRole("button", { name: "容量", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: `容量 · ${iteration.name}` });
  await within(dialog).findByText("容量读取暂时失败");
  expect((within(dialog).getByRole("button", { name: "保存", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "重新载入", exact: true }));
  const points = await within(dialog).findByLabelText("成员甲 容量点数");
  await waitFor(() => expect((points as HTMLInputElement).value).toBe("8"));
  expect((within(dialog).getByRole("button", { name: "保存", exact: true }) as HTMLButtonElement).disabled).toBe(false);
});
