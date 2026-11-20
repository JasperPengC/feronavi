// @vitest-environment node
import { expect, it } from "vitest";
import { projectAssistantToolResult } from "../src/server/services/assistant-projection.ts";
const date = { asOfDate: "2026-11-15", timeZone: "UTC" };
interface Node {
  name: string;
  lifecycleFacts: { completion: string; archival: string; statement: string };
  dateFacts: { relation: string; nodeOverdue: boolean | null };
}
function result(tool: string, key: string, nodes: Record<string, unknown>[]) {
  return (
    projectAssistantToolResult(tool, { [key]: nodes }, date) as Record<
      string,
      Node[]
    >
  )[key];
}
it("今天到期未完成的里程碑与已完成迭代/版本逐节点表述，不把共同未逾期等同共同完成", () => {
  const milestone = result("plan.listMilestones", "milestones", [
    { name: "M1", dueDate: "2026-11-15", completedAt: null, archivedAt: null },
  ])[0]!;
  const iteration = result("plan.listIterations", "iterations", [
    {
      name: "Sprint14",
      endDate: "2026-11-15",
      completedAt: "2026-11-15T10:00:00Z",
      archivedAt: null,
    },
  ])[0]!;
  const release = result("plan.listReleases", "releases", [
    {
      name: "1.4",
      releaseDate: "2026-11-15",
      completedAt: "2026-11-15T10:00:00Z",
      archivedAt: null,
    },
  ])[0]!;
  expect(milestone.lifecycleFacts).toMatchObject({
    completion: "open",
    archival: "active",
  });
  expect(milestone.lifecycleFacts.statement).toBe(
    "M1：未完成；未归档；今天到期，尚未逾期。",
  );
  for (const node of [iteration, release]) {
    expect(node.lifecycleFacts.completion).toBe("completed");
    expect(node.lifecycleFacts.statement).toContain(
      `${node.name}：已完成；未归档；今天到期，尚未逾期。`,
    );
  }
  for (const node of [milestone, iteration, release])
    expect(node.dateFacts.nodeOverdue).toBe(false);
});
it("同一列表混合生命周期与日期状态不会跨节点传播，归档也不等于完成", () => {
  const nodes = result("plan.listMilestones", "milestones", [
    {
      name: "未结项",
      dueDate: "2026-11-14",
      completedAt: null,
      archivedAt: null,
    },
    {
      name: "已结项",
      dueDate: "2026-11-14",
      completedAt: "2026-11-14T10:00:00Z",
      archivedAt: null,
    },
    {
      name: "仅归档",
      dueDate: "2026-11-16",
      completedAt: null,
      archivedAt: "2026-11-15T10:00:00Z",
    },
    { name: "未知", dueDate: null },
  ]);
  expect(nodes.map((n) => n.lifecycleFacts.completion)).toEqual([
    "open",
    "completed",
    "open",
    "unknown",
  ]);
  expect(nodes.map((n) => n.lifecycleFacts.archival)).toEqual([
    "active",
    "active",
    "archived",
    "unknown",
  ]);
  expect(nodes[0]?.lifecycleFacts.statement).toBe(
    "未结项：未完成；未归档；截止日期已过，当前节点逾期。",
  );
  expect(nodes[1]?.lifecycleFacts.statement).toBe(
    "已结项：已完成；未归档；截止日期已过，当前不计未结项逾期。",
  );
  expect(nodes[2]?.lifecycleFacts.statement).toBe(
    "仅归档：未完成；已归档；未来到期。",
  );
  expect(nodes[3]?.lifecycleFacts.statement).toBe(
    "未知：完成情况未知；归档情况未知；截止日期未知。",
  );
});
