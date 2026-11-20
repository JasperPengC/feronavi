// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
import { ALL_TOOLS as COLLABORATION_TOOLS } from "../src/server/application/capabilities/tools.ts";
const validator = new AjvJsonSchemaValidator();
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function valid(name: string, args: object) {
  const tool = COLLABORATION_TOOLS.find((tool) => tool.name === name)!;
  expect(tool, name).toBeDefined();
  return validator.getValidator(tool.inputSchema)({ ...args, ...(tool.kind === "write" ? { userConfirmed: true } : {}), ...((tool.inputSchema.required as string[] | undefined)?.includes("projectId") ? { projectId: uuid } : {}) }).valid;
}
describe("协作 MCP 输入与范围契约", () => {
  it("所有工具拒绝隐藏字段且工具名称唯一", () => {
    expect(new Set(COLLABORATION_TOOLS.map((t) => t.name)).size).toBe(
      COLLABORATION_TOOLS.length,
    );
    for (const tool of COLLABORATION_TOOLS)
      expect(
        validator.getValidator(tool.inputSchema)({ hidden: true }).valid,
        tool.name,
      ).toBe(false);
  });
  it("关注渠道只能是有界去重的正式渠道", () => {
    expect(
      valid("workitem.follow", {
        workItemId: uuid,
        channels: ["IN_APP", "EMAIL"],
      }),
    ).toBe(true);
    expect(
      valid("workitem.follow", { workItemId: uuid, channels: ["SMS"] }),
    ).toBe(false);
    expect(
      valid("workitem.follow", {
        workItemId: uuid,
        channels: ["EMAIL", "EMAIL"],
      }),
    ).toBe(false);
  });
  it("工时必须为有界正整数且日期格式正确", () => {
    const base = { workItemId: uuid, loggedDate: "2026-11-15" };
    expect(valid("timeLog.create", { ...base, minutes: 30 })).toBe(true);
    for (const minutes of [0, -1, 1.5, "30", 2147483648])
      expect(valid("timeLog.create", { ...base, minutes })).toBe(false);
    expect(
      valid("timeLog.create", { ...base, minutes: 1, loggedDate: "tomorrow" }),
    ).toBe(false);
  });
  it("偏好工具只作用于本人且主题密度有明确枚举", () => {
    expect(
      COLLABORATION_TOOLS.find((tool) => tool.name === "prefs.get")?.scope,
    ).toBe("identity");
    expect(
      COLLABORATION_TOOLS.find((tool) => tool.name === "prefs.update")?.scope,
    ).toBe("identity");
    expect(valid("prefs.update", { memberId: uuid, theme: "dark" })).toBe(
      false,
    );
    expect(valid("prefs.update", { theme: "dark", density: "compact" })).toBe(
      true,
    );
    expect(valid("prefs.update", { theme: "rainbow" })).toBe(false);
  });
  it("内容引用不能冒充工作项依赖关系", () => {
    expect(
      valid("workitem.createContentLink", {
        workItemId: uuid,
        targetType: "MILESTONE",
        targetId: uuid,
      }),
    ).toBe(true);
    expect(
      valid("workitem.createContentLink", {
        workItemId: uuid,
        targetType: "BLOCKS",
        targetId: uuid,
      }),
    ).toBe(false);
  });
});

it("业务服务无返回值时工具返回稳定的成功对象", async () => {
  const { businessTool } = await import("../src/server/mcp/business-tool.ts");
  const tool = businessTool(
    "test.voidWrite",
    "无返回值写入",
    "write",
    {},
    async () => undefined,
  );
  await expect(
    tool.handler({ actor: { memberId: "test" } } as never, {}),
  ).resolves.toEqual({ ok: true });
});
