import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale } from "../src/client/i18n/index.ts";
import { WorkItemEditor } from "../src/client/components/work-item/WorkItemEditor.tsx";

beforeEach(() => setLocale("zh-CN"));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("后台刷新工作项不会覆盖正在编辑的草稿，保存仍使用打开时版本", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "PATCH" ? { id: "w1" } : { members: [], rows: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const affectedKeys = [["issues", "global"], ["issue-stats", "p1"], ["calendar-unscheduled", "p1", 1], ["project-activity", "p1"]];
  for (const key of affectedKeys) qc.setQueryData(key, {});
  const item = { id: "w1", projectId: "p1", type: "TASK", title: "原始标题", description: "", priority: "HIGH", assigneeId: null, dueDate: null, version: 1 };
  const view = (version: number) => <QueryClientProvider client={qc}><WorkItemEditor open projectId="p1" workItem={{ ...item, version }} onClose={() => {}} /></QueryClientProvider>;
  const { rerender } = render(view(1));
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "我的草稿" } });
  rerender(view(2));
  expect((screen.getByLabelText(/标题/) as HTMLInputElement).value).toBe("我的草稿");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  const sent = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")![1]!;
  expect(JSON.parse(String(sent.body))).toMatchObject({ title: "我的草稿", version: 1 });
  await waitFor(() => {
    for (const key of affectedKeys) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
  }, { timeout: 1500 });
});
