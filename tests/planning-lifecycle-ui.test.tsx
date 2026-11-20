import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlanningEntitiesPanel } from "../src/client/components/project/PlanningEntitiesPanel.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { setLocale } from "../src/client/i18n/index.ts";

const clients: QueryClient[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const iteration = { id: "source", projectId: "p1", name: "本轮迭代", startDate: "2026-11-01", endDate: "2026-11-14", carryOver: true, completedAt: null as string | null, archivedAt: null as string | null, pendingWorkItemCount: 2 };
const next = { ...iteration, id: "next", name: "下轮迭代", pendingWorkItemCount: 0 };
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function mount(handler: Handler, kind: "iteration" | "release" = "iteration") {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input), "http://localhost"), init)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><PlanningEntitiesPanel projectId="p1" initialKind={kind} showTabs={false} /><DialogHost /></QueryClientProvider>);
  return client;
}
const row = (name: string) => within(screen.getByText(name, { selector: ".row-name" }).closest("li")!);
async function confirmArchive() {
  const confirmation = await screen.findByRole("dialog", { name: "确认归档？" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "确认", exact: true }));
}

beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("有待结转项时必须选择同项目开放迭代，失败保留选择且成功刷新计划与工作项", async () => {
  let completed = false, writes = 0;
  const bodies: unknown[] = [];
  const client = mount((url, init) => {
    if (url.pathname === "/api/v1/iterations/source/complete") {
      bodies.push(JSON.parse(String(init?.body))); writes++;
      if (writes === 1) return json({ code: "CONFLICT", message: "目标迭代暂时不可用" }, 409);
      completed = true;
      return json({ id: "source", completedAt: "2026-11-19T12:00:00Z", movedCount: 2 });
    }
    return json([
      { ...iteration, completedAt: completed ? "2026-11-19T12:00:00Z" : null }, next,
      { ...next, id: "done", name: "已结束迭代", completedAt: "2026-11-18T12:00:00Z" },
      { ...next, id: "archived", name: "归档迭代", archivedAt: "2026-11-18T12:00:00Z" },
      { ...next, id: "other", projectId: "p2", name: "其他项目迭代" },
    ]);
  });
  client.setQueryData(["board", "p1"], { columns: [] });
  client.setQueryData(["table", "p1"], { rows: [] });
  await screen.findByText(iteration.name);
  fireEvent.click(row(iteration.name).getByRole("button", { name: "结束迭代", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "结束迭代 · 本轮迭代" });
  const submit = within(dialog).getByRole("button", { name: "结束迭代", exact: true });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "结转目标迭代", exact: true }));
  expect(screen.queryByRole("option", { name: "本轮迭代", exact: true })).toBeNull();
  for (const name of ["已结束迭代", "归档迭代", "其他项目迭代"]) expect(screen.queryByRole("option", { name, exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "下轮迭代", exact: true }));
  fireEvent.click(submit);
  await within(dialog).findByRole("alert");
  expect(within(dialog).getByRole("alert").textContent).toContain("目标迭代暂时不可用");
  expect(within(dialog).getByRole("button", { name: "结转目标迭代", exact: true }).textContent).toContain("下轮迭代");
  fireEvent.click(submit);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(bodies).toEqual([{ targetIterationId: "next" }, { targetIterationId: "next" }]);
  expect(row(iteration.name).getByText("已完成")).toBeTruthy();
  expect(row(iteration.name).queryByRole("button", { name: "结束迭代", exact: true })).toBeNull();
  expect(client.getQueryState(["board", "p1"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["table", "p1"])?.isInvalidated).toBe(true);
});

it.each([{ carryOver: true, pendingWorkItemCount: 0 }, { carryOver: false, pendingWorkItemCount: 2 }])("无需结转目标的迭代可以结束：%j", async (state) => {
  const bodies: unknown[] = [];
  mount((url, init) => {
    if (url.pathname.endsWith("/complete")) { bodies.push(JSON.parse(String(init?.body))); return json({ id: "source", completedAt: "2026-11-19T12:00:00Z", movedCount: 0 }); }
    return json([{ ...iteration, ...state }]);
  });
  await screen.findByText(iteration.name);
  fireEvent.click(row(iteration.name).getByRole("button", { name: "结束迭代", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "结束迭代 · 本轮迭代" });
  const submit = within(dialog).getByRole("button", { name: "结束迭代", exact: true });
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(bodies).toEqual([{}]);
});

it("没有可用的结转目标时提示新建迭代并禁止提交", async () => {
  mount(() => json([iteration, { ...next, completedAt: "2026-11-18T12:00:00Z" }]));
  await screen.findByText(iteration.name);
  fireEvent.click(row(iteration.name).getByRole("button", { name: "结束迭代", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "结束迭代 · 本轮迭代" });
  expect(within(dialog).getByRole("alert").textContent).toContain("没有可用的结转目标，请先新建同项目迭代");
  expect((within(dialog).getByRole("button", { name: "结束迭代", exact: true }) as HTMLButtonElement).disabled).toBe(true);
});

it("版本完成期间阻止关闭和重复提交，服务端拒绝后可重试成功", async () => {
  let finish: ((response: Response) => void) | undefined;
  let writes = 0, completed = false;
  mount((url) => {
    if (url.pathname.endsWith("/complete")) {
      writes++;
      if (writes === 1) return new Promise(resolve => { finish = resolve; });
      completed = true;
      return json({ id: "release", completedAt: "2026-11-19T12:00:00Z", movedCount: 0 });
    }
    return json([{ id: "release", projectId: "p1", name: "首个版本", completedAt: completed ? "2026-11-19T12:00:00Z" : null, archivedAt: null, pendingWorkItemCount: 0 }]);
  }, "release");
  await screen.findByText("首个版本");
  fireEvent.click(row("首个版本").getByRole("button", { name: "完成版本", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "完成版本 · 首个版本" });
  fireEvent.click(within(dialog).getByRole("button", { name: "完成版本", exact: true }));
  await waitFor(() => expect(writes).toBe(1));
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭", exact: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect((within(dialog).getByRole("button", { name: "完成版本", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish?.(json({ code: "BLOCKED_BY_PREREQUISITE", message: "版本仍有未完成工作项" }, 409)));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("版本仍有未完成工作项");
  expect(writes).toBe(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "完成版本", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(row("首个版本").getByText("已完成")).toBeTruthy();
  expect(row("首个版本").queryByRole("button", { name: "完成版本", exact: true })).toBeNull();
  expect(writes).toBe(2);
});

it.each(["iteration", "release"] as const)("%s 归档失败可见，成功进入已归档列表；恢复失败可重试且成功返回当前列表", async (kind) => {
  let archived = false, archiveCalls = 0, restoreCalls = 0;
  mount((url) => {
    if (url.pathname.endsWith("/archive")) {
      if (++archiveCalls === 1) return json({ code: "CONFLICT", message: "归档暂时失败" }, 409);
      archived = true; return json({ ok: true });
    }
    if (url.pathname.endsWith("/unarchive")) {
      if (++restoreCalls === 1) return json({ code: "CONFLICT", message: "恢复暂时失败" }, 409);
      archived = false; return json({ ok: true });
    }
    return json(archived && url.searchParams.get("archived") !== "true" ? [] : [{ ...iteration, completedAt: "2026-11-18T12:00:00Z", archivedAt: archived ? "2026-11-19T12:00:00Z" : null, pendingWorkItemCount: 0 }]);
  }, kind);
  await screen.findByText(iteration.name);
  fireEvent.click(row(iteration.name).getByRole("button", { name: "归档", exact: true }));
  await confirmArchive();
  expect((await screen.findByRole("alert")).textContent).toContain("归档暂时失败");
  fireEvent.click(row(iteration.name).getByRole("button", { name: "归档", exact: true }));
  await confirmArchive();
  await waitFor(() => expect(screen.queryByText(iteration.name, { selector: ".row-name" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "已归档", exact: true }));
  await screen.findByText(iteration.name, { selector: ".row-name" });
  expect(row(iteration.name).queryByRole("button", { name: "编辑", exact: true })).toBeNull();
  fireEvent.click(row(iteration.name).getByRole("button", { name: "恢复", exact: true }));
  expect((await screen.findByRole("alert")).textContent).toContain("恢复暂时失败");
  fireEvent.click(row(iteration.name).getByRole("button", { name: "恢复", exact: true }));
  await waitFor(() => expect(screen.queryByText(iteration.name, { selector: ".row-name" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "当前", exact: true }));
  await screen.findByText(iteration.name, { selector: ".row-name" });
  expect(row(iteration.name).getByText("已完成")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
