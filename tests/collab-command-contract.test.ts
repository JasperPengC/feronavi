import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:5432/unused";
});

import { COLLAB_COMMANDS, WRITE_ACTIONS } from "../src/server/services/collab-command.service.ts";
import { WRITE_TOOLS } from "../src/server/mcp/write-tools.ts";

describe("COMMAND 协作命令契约", () => {
  it("为四类业务资源声明领域写命令并统一确认门禁", () => {
    expect(COLLAB_COMMANDS.WORK_ITEM).toContain("workitem.update");
    expect(COLLAB_COMMANDS.PLAN).toContain("plan.createMilestone");
    expect(COLLAB_COMMANDS.APPROVAL).toEqual(["approval.approve", "approval.reject"]);
    expect(COLLAB_COMMANDS.AUTOMATION).toEqual(["automation.createRule", "automation.updateRule", "automation.disableRule", "automation.deleteRule", "automation.dryRun"]);
    for (const action of [...COLLAB_COMMANDS.WORK_ITEM, ...COLLAB_COMMANDS.PLAN, ...COLLAB_COMMANDS.APPROVAL, ...COLLAB_COMMANDS.AUTOMATION]) {
      expect(WRITE_ACTIONS.has(action)).toBe(true);
    }
  });

  it("REST 与 MCP 共用 collab.command 工具契约", () => {
    const tool = WRITE_TOOLS.find((item) => item.name === "collab.command");
    expect(tool?.kind).toBe("write");
    expect(tool?.inputSchema).toMatchObject({ type: "object" });
    expect((tool?.inputSchema as { required?: string[] }).required).toEqual(expect.arrayContaining([
      "resourceType", "resourceId", "action", "userConfirmed",
    ]));
  });

  it("PLAN 声明四类计划的更新和归档，以及迭代版本完成命令", () => {
    for (const suffix of ["Milestone", "Iteration", "Release", "Module"]) {
      for (const action of ["create", "update", "archive", "unarchive"]) {
        expect(COLLAB_COMMANDS.PLAN).toContain(`plan.${action}${suffix}`);
        expect(WRITE_ACTIONS.has(`plan.${action}${suffix}`)).toBe(true);
      }
    }
    expect(COLLAB_COMMANDS.PLAN).toContain("plan.completeIteration");
    expect(COLLAB_COMMANDS.PLAN).toContain("plan.completeRelease");
  });
});
