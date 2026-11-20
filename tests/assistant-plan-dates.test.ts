// @vitest-environment node
import { expect, it } from "vitest";
import { projectAssistantToolResult } from "../src/server/services/assistant-projection.ts";
const clock = { asOfDate: "2026-11-15", timeZone: "UTC" };
function project(
  name = "plan.listMilestones",
  key = "milestones",
  node: Record<string, unknown> = {},
) {
  return projectAssistantToolResult(
    name,
    { [key]: [{ id: "node", completedAt: null, archivedAt: null, ...node }] },
    clock,
  ) as Record<
    string,
    {
      dateFacts: {
        deadlineDate: string | null;
        relation: string;
        completed: boolean | null;
        archived: boolean | null;
        nodeOverdue: boolean | null;
      };
    }[]
  > & { scheduleAssessment: { scope: string; projectBehindSchedule: string } };
}
it.each([
  ["2026-11-14", "past", true],
  ["2026-11-15", "today", false],
  ["2026-11-16", "future", false],
  [null, "unknown", null],
  ["2026-02-30", "unknown", null],
  ["2026-11-15T00:00:00Z", "unknown", null],
  ["invalid", "unknown", null],
])(
  "节点截止%s按UTC日严格判断，截止当天未逾期",
  (dueDate, relation, nodeOverdue) => {
    const result = project(undefined, undefined, { dueDate });
    expect(result.milestones[0]?.dateFacts).toMatchObject({
      relation,
      nodeOverdue,
      deadlineDate: relation === "unknown" ? null : dueDate,
    });
    expect(result.scheduleAssessment).toMatchObject({
      scope: "node_only",
      projectBehindSchedule: "unknown",
    });
  },
);
it.each([
  ["plan.listMilestones", "milestones", "dueDate"],
  ["plan.listIterations", "iterations", "endDate"],
  ["plan.listReleases", "releases", "releaseDate"],
])("%s按真实DTO截止字段而非其它同名日期判断", (tool, key, field) => {
  const result = project(tool, key, {
    dueDate: "2026-11-16",
    endDate: "2026-11-16",
    releaseDate: "2026-11-16",
    [field]: "2026-11-14",
  });
  expect(result[key][0]?.dateFacts).toMatchObject({
    relation: "past",
    nodeOverdue: true,
    deadlineDate: "2026-11-14",
  });
});
it.each([
  [
    { completedAt: "2026-11-14T12:00:00Z" },
    { completed: true, archived: false, nodeOverdue: false },
  ],
  [
    { completedAt: new Date("2026-11-14T12:00:00Z") },
    { completed: true, nodeOverdue: false },
  ],
  [
    { archivedAt: "2026-11-14T12:00:00Z" },
    { completed: false, archived: true, nodeOverdue: false },
  ],
  [{ completedAt: undefined }, { completed: null, nodeOverdue: null }],
  [{ completedAt: "invalid" }, { completed: null, nodeOverdue: null }],
])("已完成/归档不算当前未结项逾期，缺失生命周期不猜测", (fields, expected) => {
  expect(
    project(undefined, undefined, { dueDate: "2026-11-14", ...fields })
      .milestones[0]?.dateFacts,
  ).toMatchObject(expected);
});
it("节点事实不能由全项目完成率泛化整体落后，完整工作项页也没有节点覆盖证明", () => {
  const result = projectAssistantToolResult(
    "workitem.list",
    {
      items: [{ statusCategory: "NOT_STARTED" }],
      page: 1,
      pageSize: 50,
      total: 1,
    },
    clock,
  ) as { planBaseline: { projectBehindSchedule: string } };
  expect(result.planBaseline.projectBehindSchedule).toBe("unknown");
});

it("截止当天即便生命周期字段缺失也确定尚未逾期", () => {
  expect(
    project(undefined, undefined, {
      dueDate: "2026-11-15",
      completedAt: undefined,
      archivedAt: undefined,
    }).milestones[0]?.dateFacts.nodeOverdue,
  ).toBe(false);
});
