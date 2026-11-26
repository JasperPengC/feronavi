import { expect, it } from "vitest";
import { parsePlanningSearch, parseTableSearch, tableFilterState } from "../src/client/lib/work-item-table-search.ts";

it("规范化非法页码和排序，保留非法计划条件交API拒绝而不扩大范围", () => {
  expect(parseTableSearch({ page: -2, sortBy: "DROP", sortDir: "x", iterationId: ["a"], releaseId: "invalid", type: "unknown", unscheduled: "false" })).toEqual({ iterationId: "invalid", releaseId: "invalid" });
  expect(parseTableSearch({ page: "2", sortBy: "dueDate", sortDir: "desc", typeF: "TASK", prioF: "HIGH", unscheduled: "true" })).toEqual({ page: 2, sortBy: "dueDate", sortDir: "desc", type: "TASK", priority: "HIGH", unscheduled: true });
});
it("API与保存视图只携带筛选，详情和返回位置不污染查询缓存", () => {
  expect(tableFilterState({ iterationId: "i1", page: 2, item: "w1", fromPlan: "iteration", fromArchived: true })).toEqual({ iterationId: "i1", page: 2 });
  expect(parsePlanningSearch({ section: "release", archived: "true" })).toEqual({ section: "release", archived: true });
  expect(parsePlanningSearch({ section: "wrong", archived: "false" })).toEqual({});
});
