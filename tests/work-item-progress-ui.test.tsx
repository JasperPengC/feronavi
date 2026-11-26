import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActorContext, type Actor } from "../src/client/lib/actor.ts";
import { DefectProgressPanel } from "../src/client/components/work-item/DefectProgressPanel.tsx";
import { WorkItemDrawer } from "../src/client/components/work-item/WorkItemDrawer.tsx";
import { DialogHost } from "../src/client/components/Dialog.tsx";
import { LocalDraftContext, useLocalDraftScope } from "../src/client/components/ui/LocalDraftScope.tsx";
import { invalidateResourceBatch } from "../src/client/lib/query-keys.ts";
import { setLocale } from "../src/client/i18n/index.ts";

const actor: Actor = { memberId: "m1", username: "dev", name: "开发者", permissions: [], dataScopes: [], mustChangePassword: false, locale: "zh-CN", theme: null, timezone: "Asia/Shanghai" };
const initial = { id: "u1", summary: "Agent已完成接口", nextSteps: "验收页面", blockers: "等待测试数据", authorId: "m1", authorName: "开发者", createdAt: "2026-11-26T01:00:00Z" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const clients: QueryClient[] = [];
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); });

function DraftHarness({ children, onLeave }: { children: React.ReactNode; onLeave: () => void }) {
  const scope = useLocalDraftScope();
  return <LocalDraftContext.Provider value={scope.register}>{children}<button onClick={() => void scope.leave(onLeave)}>返回父项</button></LocalDraftContext.Provider>;
}
function setup(options: { failRead?: boolean; failWrite?: boolean; waitWrite?: Promise<void>; readonly?: boolean; drawerType?: string; rows?: typeof initial[] } = {}) {
  let rows = options.rows ?? [initial], failRead = options.failRead;
  const writes: { method: string; body: Record<string, unknown> | null }[] = [];
  const onLeave = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); writes.push({ method: "POST", body });
      await options.waitWrite;
      if (options.failWrite) return json({ code: "FORBIDDEN", message: "进展写入失败" }, 403);
      rows = [{ ...initial, ...body, id: "u-new" }, ...rows]; return json(rows[0], 201);
    }
    if (init?.method === "DELETE") { writes.push({ method: "DELETE", body: null }); rows = rows.filter(x => !path.endsWith(x.id)); return json({ ok: true }); }
    if (path.endsWith("/progress-updates")) return failRead ? json({ code: "FORBIDDEN", message: "进展暂时无法读取" }, 403) : json({ updates: rows });
    if (path === "/api/v1/work-items/w1") return json({ id: "w1", key: "FN-1", projectId: "p1", type: options.drawerType ?? "TASK", title: "当前任务", version: 1, assigneeId: "m1" });
    if (path.endsWith("/children")) return json({ children: [] });
    if (path.endsWith("/comments")) return json([]);
    if (path.endsWith("/links")) return json({ links: [] });
    if (path.endsWith("/approvals")) return json({ approvals: [] });
    return json({});
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(qc);
  render(<ActorContext.Provider value={actor}><QueryClientProvider client={qc}><DraftHarness onLeave={onLeave}>
    {options.drawerType ? <WorkItemDrawer workItemId="w1" onClose={onLeave} /> : <DefectProgressPanel workItemId="w1" assigneeId={options.readonly ? "other" : "m1"} />}
  </DraftHarness><DialogHost /></QueryClientProvider></ActorContext.Provider>);
  return { writes, onLeave, qc, allowRead: () => { failRead = false; }, addRemote: () => { rows = [{ ...initial, id: "remote", summary: "Agent最新回写" }, ...rows]; } };
}

it.each(["TASK", "SUBTASK", "REQUIREMENT", "DEFECT"])("%s详情能看到Agent结构化进展", async type => {
  setup({ drawerType: type });
  const panel = await screen.findByRole("region", { name: "处理进展" });
  expect(await within(panel).findByText("Agent已完成接口")).toBeTruthy();
  expect(within(panel).getByText(/验收页面/)).toBeTruthy();
  expect(within(panel).getByText(/等待测试数据/)).toBeTruthy();
});

it("读取失败显示错误和重试，不伪装为空记录", async () => {
  const { allowRead } = setup({ failRead: true });
  await screen.findByText("进展暂时无法读取");
  expect(screen.queryByText("还没有进展记录。")).toBeNull();
  allowRead(); fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
  await screen.findByText("Agent已完成接口");
});

it("保存中只写一次且不允许离开，成功后回读记录并清空草稿", async () => {
  let resolve!: () => void; const waitWrite = new Promise<void>(r => { resolve = r; });
  const { writes, onLeave } = setup({ waitWrite });
  fireEvent.click(screen.getByRole("button", { name: "记录进展" }));
  fireEvent.change(screen.getByLabelText(/本阶段进展/), { target: { value: "  完成联调  " } });
  fireEvent.click(screen.getByRole("button", { name: "保存进展" }));
  fireEvent.click(screen.getByRole("button", { name: "保存进展" }));
  expect(screen.getByRole("button", { name: "保存进展" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "返回父项" }));
  expect(onLeave).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  expect(writes).toHaveLength(1); expect(writes[0]?.body).toMatchObject({ summary: "完成联调", nextSteps: null, blockers: null });
  await act(async () => resolve()); await screen.findByText("完成联调");
  fireEvent.click(screen.getByRole("button", { name: "记录进展" }));
  expect(screen.getByLabelText(/本阶段进展/)).toHaveProperty("value", "");
});

it("失败保留输入，离开与取消均保护草稿，明确确认才清空", async () => {
  setup({ failWrite: true });
  fireEvent.click(screen.getByRole("button", { name: "记录进展" }));
  fireEvent.change(screen.getByLabelText(/本阶段进展/), { target: { value: "未完成分析" } });
  fireEvent.click(screen.getByRole("button", { name: "保存进展" }));
  await screen.findByText("进展写入失败");
  expect(screen.getByLabelText(/本阶段进展/)).toHaveProperty("value", "未完成分析");
  fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText(/本阶段进展/)).toHaveProperty("value", "未完成分析");
  fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "确认", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "记录进展" }));
  expect(screen.getByLabelText(/本阶段进展/)).toHaveProperty("value", "");
});

it("只读协作者不能添加，仍能删除自己历史记录且须确认", async () => {
  const { writes } = setup({ readonly: true });
  await screen.findByText("Agent已完成接口");
  expect(screen.queryByRole("button", { name: "记录进展" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  const dialog = await screen.findByRole("dialog");
  expect(writes).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认" }));
  await screen.findByText("还没有进展记录。");
  expect(writes).toHaveLength(1);
});

it("只读协作者不能删除他人记录", async () => {
  setup({ readonly: true, rows: [{ ...initial, authorId: "other" }] });
  await screen.findByText("Agent已完成接口");
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
});

it("默认最近3条，展开完整历史后可收起；Agent更新刷新已打开面板", async () => {
  const { qc, addRemote } = setup({ rows: Array.from({ length: 5 }, (_, i) => ({ ...initial, id: `u${i}`, summary: `进展${i}` })) });
  await screen.findByText("进展0");
  expect(screen.queryByText("进展3")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开全部 5 条" }));
  expect(screen.getByText("进展4")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "收起历史" }));
  expect(screen.queryByText("进展3")).toBeNull();
  addRemote(); await act(async () => invalidateResourceBatch(qc, [{ domain: "workitem", projectId: "p1", resourceType: "WORK_ITEM", resourceId: "w1" }]));
  await screen.findByText("Agent最新回写");
});
