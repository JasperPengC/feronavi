// @vitest-environment node
import { expect, it } from "vitest";
import {
  collectAssistantResources,
  assistantContextReadTools,
  ASSISTANT_CONTEXT_READ_TOOLS,
  projectAssistantToolResult,
} from "../src/server/services/assistant-projection.ts";
it("项目上下文工作流新旧字段都保留策略证据且重复别名只记录一次", () => {
  expect(assistantContextReadTools({ workflow: { workflows: [] } })).toEqual(["meta.workflow"]);
  expect(assistantContextReadTools({ workflows: { workflows: [] } })).toEqual(["meta.workflow"]);
  expect(assistantContextReadTools({ workflow: {}, workflows: {} })).toEqual(["meta.workflow"]);
  expect(assistantContextReadTools({ workflow: { unavailable: true } })).toEqual([]);
  expect(new Set(ASSISTANT_CONTEXT_READ_TOOLS).size).toBe(ASSISTANT_CONTEXT_READ_TOOLS.length);
  expect(collectAssistantResources("project.context", {
    iterations: [{ id: "i", projectId: "p" }], modules: [{ id: "m", projectId: "p" }],
  }, "p")).toEqual([{ kind: "iteration", id: "i" }, { kind: "module", id: "m" }]);
});
it("列表精简保留精确状态/日期/分页，只有完整页才标记完整统计", () => {
  const result = projectAssistantToolResult(
    "workitem.list",
    {
      items: [
        {
          id: "1",
          key: "A-1",
          title: "one",
          statusCategory: "TERMINAL",
          dueDate: "2020-01-01",
          version: 1,
          description: "sensitive rich payload",
        },
        {
          id: "2",
          key: "A-2",
          title: "two",
          statusCategory: "IN_PROGRESS",
          dueDate: "2020-01-01",
          version: 2,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    },
    { asOfDate: "2026-11-16", timeZone: "UTC" },
  ) as Record<string, unknown>;
  expect(result.statistics).toEqual({
    complete: true,
    terminalOnPage: 1,
    unfinishedOnPage: 1,
    unknownCategoryOnPage: 0,
    overdueUnfinishedOnPage: 1,
    asOfDate: "2026-11-16",
    timeZone: "UTC",
  });
  expect(JSON.stringify(result)).not.toContain("sensitive rich payload");
  expect(result.total).toBe(2);
  const partial = projectAssistantToolResult(
    "workitem.list",
    {
      items: [{ id: "1", statusCategory: "TERMINAL" }],
      total: 39,
      page: 1,
      pageSize: 1,
    },
    { asOfDate: "2026-11-16", timeZone: "UTC" },
  ) as { statistics: { complete: boolean } };
  expect(partial.statistics.complete).toBe(false);
});
it("项目详情不把大量工作流重复送模型，显式工具仍可查询完整元数据", () => {
  const result = projectAssistantToolResult("project.get", {
    id: "p",
    name: "Project",
    workflows: [{ states: ["huge"] }],
    statusDefs: [{}],
  });
  expect(result).toEqual({
    id: "p",
    name: "Project",
    note: "项目元信息；工作项事实请查workitem.list，工作流详情请查meta.workflow。",
  });
});
it("里程碑详情嵌套工作项必须按真实资源结构收集，知识页不受UI引用20条上限影响", async () => {
  const { collectAssistantResources } =
    await import("../src/server/services/assistant-projection.ts");
  const result = collectAssistantResources(
    "plan.getMilestone",
    {
      milestone: { id: "m", projectId: "p" },
      workItems: [{ id: "w", projectId: "p" }],
    },
    "p",
  );
  expect(result).toEqual([
    { kind: "milestone", id: "m" },
    { kind: "workItem", id: "w" },
  ]);
  const pages = collectAssistantResources(
    "knowledge.search",
    { hits: Array.from({ length: 25 }, (_, i) => ({ pageId: `page-${i}` })) },
    "p",
  );
  expect(pages).toHaveLength(25);
  expect(pages[24]).toEqual({ kind: "page", id: "page-24" });
});
it("工作项完整页也没有核验项目计划存在性，不能拿complete=true推断没有基准", () => {
  const result = projectAssistantToolResult("workitem.list", {
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
  }) as { statistics: { complete: boolean }; planBaseline: { state: string } };
  expect(result.statistics.complete).toBe(true);
  expect(result.planBaseline.state).toBe("unverified");
});
it("工作项详情保留原始事实并提示受权限工具补齐可读状态", () => {
  const value = { workItem: { id: "w", statusId: "s", workflowId: "f" } };
  const result = projectAssistantToolResult(
    "workitem.get",
    value,
  ) as typeof value & { note: string };
  expect(result.workItem).toEqual(value.workItem);
  expect(result.note).toContain("meta.workflow");
  expect(result.note).toContain("补查失败须明确未知");
});
it.each([
  [
    "page.list",
    { pages: [{ id: "p1", projectId: "p" }] },
    [{ kind: "page", id: "p1" }],
  ],
  [
    "page.revisions",
    { revisions: [{ id: "revision", pageId: "p1" }] },
    [{ kind: "page", id: "p1" }],
  ],
  [
    "workitem.comments",
    { comments: [{ id: "c1" }] },
    [{ kind: "comment", id: "c1" }],
  ],
  [
    "workitem.children",
    { parent: { id: "w1" }, children: [{ id: "w2" }] },
    [
      { kind: "workItem", id: "w1" },
      { kind: "workItem", id: "w2" },
    ],
  ],
  [
    "plan.getIteration",
    { id: "i1", projectId: "p" },
    [{ kind: "iteration", id: "i1" }],
  ],
  [
    "plan.getRelease",
    { id: "r1", projectId: "p" },
    [{ kind: "release", id: "r1" }],
  ],
  [
    "plan.listModules",
    { modules: [{ id: "m1", projectId: "p" }] },
    [{ kind: "module", id: "m1" }],
  ],
  [
    "plan.getModule",
    { id: "m1", projectId: "p" },
    [{ kind: "module", id: "m1" }],
  ],
])("扩展业务读取%s保留可重新授权的资源身份", (name, value, expected) => {
  expect(collectAssistantResources(name as string, value, "p")).toEqual(
    expected,
  );
});
it("新业务证据覆盖依赖对端、想法转化和项目上下文内嵌资源", () => {
  expect(
    collectAssistantResources(
      "workitem.relations",
      { blocks: [{ id: "relation", relatedWorkItemId: "peer" }] },
      "p",
    ),
  ).toEqual([{ kind: "workItem", id: "peer" }]);
  expect(
    collectAssistantResources(
      "idea.get",
      { id: "idea", projectId: "p", promotedWorkItemId: "promoted" },
      "p",
    ),
  ).toEqual([
    { kind: "idea", id: "idea" },
    { kind: "workItem", id: "promoted" },
  ]);
  expect(
    collectAssistantResources(
      "project.context",
      {
        workItems: { items: [{ id: "w", projectId: "p" }] },
        iterations: { iterations: [{ id: "i", projectId: "p" }] },
      },
      "p",
    ),
  ).toEqual([
    { kind: "workItem", id: "w" },
    { kind: "iteration", id: "i" },
  ]);
});
it("里程碑进展详情以真实relatedWorkItems字段保留历史ACL引用", () => {
  expect(
    collectAssistantResources(
      "plan.milestoneDetail",
      {
        milestone: { id: "m", projectId: "p" },
        relatedWorkItems: [{ id: "w", projectId: "p" }],
      },
      "p",
    ),
  ).toEqual([
    { kind: "milestone", id: "m" },
    { kind: "workItem", id: "w" },
  ]);
});
it("闭环结果保留真实计数并显式标记截断，避免大集合撑爆会话", async () => {
  const { summarizeAssistantClosureValue } =
    await import("../src/server/services/assistant-projection.ts");
  const result = summarizeAssistantClosureValue({
    items: Array.from({ length: 103 }, (_, n) => ({ title: `任务${n}` })),
    total: 103,
    date: new Date("2026-11-16T00:00:00Z"),
  }) as {
    items: { items: unknown[]; total: number; truncated: boolean };
    total: number;
    date: string;
  };
  expect(result.total).toBe(103);
  expect(result.items.total).toBe(103);
  expect(result.items.items).toHaveLength(40);
  expect(result.items.truncated).toBe(true);
  expect(result.date).toBe("2026-11-16T00:00:00.000Z");
});
