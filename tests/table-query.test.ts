import { afterEach, expect, it, vi } from "vitest";
import { boardQuerySchema, listWorkItemsQuerySchema } from "../src/shared/schemas/work-item.ts";
import { tableView } from "../src/client/lib/planning-api.ts";

afterEach(() => vi.unstubAllGlobals());

it("四个计划条件同时传到服务端，不因查询解析而退化成全部工作项", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ rows: [], total: 0 })));
  vi.stubGlobal("fetch", fetcher);
  const plans = { iterationId: "11111111-1111-4111-8111-111111111111", releaseId: "22222222-2222-4222-8222-222222222222", moduleId: "33333333-3333-4333-8333-333333333333", milestoneId: "44444444-4444-4444-8444-444444444444" };
  await tableView("p1", plans);
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(listWorkItemsQuerySchema.parse(Object.fromEntries(url.searchParams))).toMatchObject(plans);
  expect(listWorkItemsQuerySchema.safeParse({ view: "table", iterationId: "invalid" }).success).toBe(false);
});

it("表格查询保留类型、优先级、排序与分页，不会悄悄丢掉筛选条件", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 20 })));
  vi.stubGlobal("fetch", fetcher);
  await tableView("project-id", { page: 1, pageSize: 20, type: "DEFECT", priority: "HIGH", sortBy: "priority", sortDir: "desc" });
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(listWorkItemsQuerySchema.parse(Object.fromEntries(url.searchParams))).toMatchObject({
    view: "table", type: "DEFECT", priority: "HIGH", page: 1, pageSize: 20, sortBy: "priority", sortDir: "desc",
  });
});

it("表格排序只能使用允许的字段", () => {
  expect(listWorkItemsQuerySchema.safeParse({ view: "table", sortBy: "unknown_column" }).success).toBe(false);
});

it("未排期过滤不会在查询解析时丢失，也不会把false当成true", () => {
  expect(listWorkItemsQuerySchema.parse({ view: "table", unscheduled: "true", page: "2" })).toMatchObject({ unscheduled: true, page: 2 });
  expect(listWorkItemsQuerySchema.parse({ unscheduled: "false" })).toMatchObject({ unscheduled: false });
});

it("看板检索和优先级由服务器过滤，非法优先级被拒绝", () => {
  expect(boardQuerySchema.parse({ q: "  登录  ", priority: "HIGH", pageSizePerColumn: "25" })).toMatchObject({ q: "登录", priority: "HIGH", pageSizePerColumn: 25 });
  expect(boardQuerySchema.safeParse({ priority: "INVALID" }).success).toBe(false);
});
