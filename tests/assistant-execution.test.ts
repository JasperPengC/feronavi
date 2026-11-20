// @vitest-environment node
import { expect, it } from "vitest";
import {
  assistantModelToolName,
  assistantExecutionState,
  observeAssistantPlan,
} from "../src/server/services/assistant-execution.ts";
it("写工具内部propose别名与读工具名不同，保持原域工具输入", () => {
  expect(
    assistantModelToolName({ name: "workitem.update", kind: "write" }),
  ).toBe("propose_workitem_update");
  expect(assistantModelToolName({ name: "workitem.get", kind: "read" })).toBe(
    "workitem_get",
  );
});
it("没有查计划、工具失败、分页不全都是未知，不能用工作项缺字段当没有计划", () => {
  const observations = [];
  const unknown = assistantExecutionState(["p"], [], observations);
  expect(unknown.plans[0]?.milestones.state).toBe("unverified");
  expect(unknown.plans[0]?.canClaimNoSupportedPlans).toBe(false);
  expect(unknown.confirmation.available).toBe(false);
  observations.push(
    observeAssistantPlan("plan.listMilestones", "p", {
      milestones: [{ id: "m", dueDate: "2026-12-01" }],
    }),
  );
  observations.push(
    observeAssistantPlan("plan.listIterations", "p", {
      iterations: [],
      total: 1,
      page: 1,
    }),
  );
  const partial = assistantExecutionState(["p"], [], observations);
  expect(partial.plans[0]?.milestones).toEqual({ state: "present", count: 1 });
  expect(partial.plans[0]?.iterations.state).toBe("incomplete");
  expect(partial.plans[0]?.canClaimNoSupportedPlans).toBe(false);
  const failed = assistantExecutionState(
    ["p"],
    [],
    [observeAssistantPlan("plan.listMilestones", "p", null)],
  );
  expect(failed.plans[0]?.milestones.state).toBe("failed");
});
it("只有全部受支持计划类别成功空集合才能说明未发现这些计划；已登记proposal才可确认", () => {
  const observations = [
    "plan.listMilestones",
    "plan.listIterations",
    "plan.listReleases",
  ].map((name) =>
    observeAssistantPlan(name, "p", {
      [name === "plan.listMilestones"
        ? "milestones"
        : name === "plan.listIterations"
          ? "iterations"
          : "releases"]: [],
    }),
  );
  expect(
    assistantExecutionState(["p"], [], observations).plans[0]
      ?.canClaimNoSupportedPlans,
  ).toBe(true);
  const proposal = {
    id: "a",
    toolName: "workitem.update",
    status: "pending",
  } as never;
  expect(
    assistantExecutionState(["p"], [proposal], observations).confirmation,
  ).toMatchObject({ available: true, actionIds: ["a"] });
});
