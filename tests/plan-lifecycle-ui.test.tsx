import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlanningEntitiesPanel } from "../src/client/components/project/PlanningEntitiesPanel.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
vi.mock("../src/client/lib/actor.ts", () => ({ useCan: () => true }));

let client: QueryClient;
const rows = [{ id: "source", name: "本轮迭代", carryOver: true, completedAt: null }, { id: "next", name: "下一轮", completedAt: null }, { id: "closed", name: "已结束的迭代", completedAt: "2026-11-15T00:00:00Z" }];
beforeEach(() => { setLocale("zh-CN"); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it("结束迭代选择同项目未结束目标，失败保留选择，成功后显示已结束", async () => {
  let completed = false, calls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/source/complete")) {
      expect(JSON.parse(String(init!.body))).toEqual({ targetIterationId: "next" });
      if (++calls === 1) return new Response(JSON.stringify({ code: "INTERNAL", message: "结束失败，请重试" }), { status: 503 });
      completed = true; return new Response(JSON.stringify({ id: "source", completedAt: "2026-11-15T00:00:00Z" }));
    }
    return new Response(JSON.stringify(rows.map((row) => row.id === "source" && completed ? { ...row, completedAt: "2026-11-15T00:00:00Z" } : row)));
  }));
  render(<RouterContextProvider router={createRouter({ routeTree: createRootRoute(), history: createMemoryHistory({ initialEntries: ["/"] }) })}><QueryClientProvider client={client}><PlanningEntitiesPanel projectId="p1" showTabs={false} /></QueryClientProvider></RouterContextProvider>);
  const source = (await screen.findByText("本轮迭代")).closest("li")!;
  fireEvent.click(within(source).getByRole("button", { name: "结束迭代", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "结束迭代 · 本轮迭代" });
  fireEvent.click(within(dialog).getByRole("button", { name: "结转目标迭代" }));
  expect(screen.queryByRole("option", { name: "已结束的迭代" })).toBeNull();
  fireEvent.click(await screen.findByRole("option", { name: "下一轮" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "结束迭代", exact: true }));
  await within(dialog).findByText("结束失败，请重试");
  expect(within(dialog).getByRole("button", { name: "结转目标迭代" }).textContent).toContain("下一轮");
  fireEvent.click(within(dialog).getByRole("button", { name: "结束迭代", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(within(source).getByText("已完成")).toBeTruthy();
  expect(within(source).queryByRole("button", { name: "结束迭代", exact: true })).toBeNull();
});

it("版本提供完成与归档入口，未结束项不伪装已完成", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: "release", name: "版本一", completedAt: null }]))));
  render(<RouterContextProvider router={createRouter({ routeTree: createRootRoute(), history: createMemoryHistory({ initialEntries: ["/"] }) })}><QueryClientProvider client={client}><PlanningEntitiesPanel projectId="p1" initialKind="release" showTabs={false} /></QueryClientProvider></RouterContextProvider>);
  const row = (await screen.findByText("版本一")).closest("li")!;
  expect(within(row).getByRole("button", { name: "完成版本", exact: true })).toBeTruthy();
  expect(within(row).getByRole("button", { name: "归档", exact: true })).toBeTruthy();
  expect(within(row).queryByText("已完成")).toBeNull();
});

it("归档列表可恢复，错误可见且成功后记录回到当前列表", async () => {
  let archived = true, restores = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/old/unarchive")) {
      if (++restores === 1) return new Response(JSON.stringify({ code: "INTERNAL", message: "恢复暂时失败" }), { status: 503 });
      archived = false; return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify(url.includes("archived=true") || !archived ? [{ id: "old", name: "旧迭代", archivedAt: archived ? "2026-11-15T00:00:00Z" : null }] : []));
  }));
  render(<RouterContextProvider router={createRouter({ routeTree: createRootRoute(), history: createMemoryHistory({ initialEntries: ["/"] }) })}><QueryClientProvider client={client}><PlanningEntitiesPanel projectId="p1" showTabs={false} /></QueryClientProvider></RouterContextProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "已归档", exact: true }));
  const row = (await screen.findByText("旧迭代")).closest("li")!;
  fireEvent.click(within(row).getByRole("button", { name: "恢复", exact: true }));
  await screen.findByText("恢复暂时失败");
  expect(within(row).getByText("旧迭代")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: "恢复", exact: true }));
  await waitFor(() => expect(screen.queryByText("旧迭代")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "当前", exact: true }));
  const restoredRow = (await screen.findByText("旧迭代")).closest("li")!;
  expect(within(restoredRow).getByRole("button", { name: "归档", exact: true })).toBeTruthy();
});
