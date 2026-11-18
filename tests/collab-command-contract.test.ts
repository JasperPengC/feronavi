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
    expect(COLLAB_COMMANDS.AUTOMATION).toEqual(["automation.createRule"]);
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
});
