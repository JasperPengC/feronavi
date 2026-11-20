// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolCtx } from "../src/server/mcp/tools.ts";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
vi.mock("../src/server/services/work-item.service.ts", () => ({
  getWorkItem: async () => ({ projectId: "project", reporterId: "owner" }),
}));
vi.mock("../src/server/services/relation.service.ts", () => ({
  listRelations: async () => ({
    blocks: [{ id: "owned" }],
    blockedBy: [],
    others: [],
  }),
  removeRelation: async () => {},
}));
import { WORK_PLANNING_TOOLS } from "../src/server/mcp/work-planning-tools.ts";
import { unlinkRelation } from "../src/server/services/mcp-work-planning.service.ts";
const ctx = {
  actor: {
    memberId: "owner",
    permissions: new Set(["work_item:update_any"]),
    grants: [{ roleKey: "TEST", scopeType: "ORG", scopeId: null }],
  },
} as unknown as ToolCtx;
const validator = new AjvJsonSchemaValidator();
function accepts(name: string, args: object) {
  const tool = WORK_PLANNING_TOOLS.find((tool) => tool.name === name)!;
  expect(tool, name).toBeDefined();
  return validator.getValidator(tool.inputSchema)(args).valid;
}
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("工作项与计划 MCP 契约", () => {
  it("工具名唯一且全部拒绝额外字段", () => {
    expect(new Set(WORK_PLANNING_TOOLS.map((t) => t.name)).size).toBe(
      WORK_PLANNING_TOOLS.length,
    );
    for (const tool of WORK_PLANNING_TOOLS)
      expect(
        validator.getValidator(tool.inputSchema)({ unknown: true }).valid,
        tool.name,
      ).toBe(false);
  });
  it("transfer 必须提供有界整数版本", () => {
    expect(
      accepts("workitem.transfer", {
        workItemId: id,
        assigneeId: null,
        version: 1,
      }),
    ).toBe(true);
    for (const version of [0, -1, 1.2, "1", 2147483648])
      expect(
        accepts("workitem.transfer", {
          workItemId: id,
          assigneeId: null,
          version,
        }),
      ).toBe(false);
  });
  it("容量恰好设置一种单位并限制范围", () => {
    const base = { iterationId: id, memberId: id };
    expect(
      accepts("plan.setIterationCapacity", { ...base, capacityPoints: 3 }),
    ).toBe(true);
    for (const fields of [
      {},
      { capacityPoints: 1, capacityHours: 2 },
      { capacityPoints: -1 },
      { capacityHours: 1000000 },
    ])
      expect(accepts("plan.setIterationCapacity", { ...base, ...fields })).toBe(
        false,
      );
  });
  it("更新计划只暴露领域允许的精确字段", () => {
    expect(
      accepts("plan.updateIteration", { iterationId: id, carryOver: true }),
    ).toBe(true);
    expect(
      accepts("plan.updateIteration", {
        iterationId: id,
        description: "unsupported",
      }),
    ).toBe(false);
    expect(accepts("plan.updateModule", { moduleId: id, parentId: null })).toBe(
      true,
    );
  });
  it("个人排序拒绝重复和过多 ID", () => {
    expect(accepts("savedView.reorder", { savedViewIds: [id] })).toBe(true);
    expect(accepts("savedView.reorder", { savedViewIds: [id, id] })).toBe(
      false,
    );
    expect(
      accepts("savedView.reorder", { savedViewIds: Array(201).fill(id) }),
    ).toBe(false);
  });
  it("进展不允许纯空白内容", () => {
    expect(
      accepts("workitem.addProgressUpdate", { workItemId: id, summary: " " }),
    ).toBe(false);
    expect(
      accepts("workitem.addProgressUpdate", {
        workItemId: id,
        summary: "已完成",
      }),
    ).toBe(true);
  });
  it("unlink 拒绝同项目其他工作项的关系 ID", async () => {
    await expect(
      unlinkRelation(ctx.actor, id, "unrelated"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      unlinkRelation(ctx.actor, id, "owned"),
    ).resolves.toBeUndefined();
  });
  it("unlink 仍要求编辑权限", async () => {
    await expect(
      unlinkRelation({ ...ctx.actor, permissions: new Set() }, id, "owned"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
