// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { outputSchemaFor, TOOL_NAMES, validatedToolOutput } from "../src/server/application/tool-contracts.ts";
import { generatedToolOutputs } from "../src/server/application/tool-output-schemas.generated.ts";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
import { ALL_TOOLS } from "../src/server/application/capabilities/tools.ts";
import { describeTool } from "../src/server/application/capabilities/contracts.ts";

const id = "11111111-1111-4111-8111-111111111111";
const currentResult = (name: string, value: unknown) => {
  const tool = ALL_TOOLS.find(tool => tool.name === name)!;
  const validate = new AjvJsonSchemaValidator().getValidator(describeTool(tool).outputSchema!);
  const result = JSON.parse(JSON.stringify(value));
  if (!validate(result).valid) throw new Error("工具输出不符合声明的契约");
  return result;
};
const attachment = { id, targetType: "WORK_ITEM", targetId: id, uploaderId: id, originalName: "notes.txt", mimeType: "text/plain", sizeBytes: 3, createdAt: new Date("2026-11-16T00:00:00Z") };
describe("领域返回类型生成的工具输出契约", () => {
  it("全部注册工具及兼容输出的具体结果、引用和JSON Schema均可编译", () => {
    const validator = new AjvJsonSchemaValidator();
    expect(new Set(ALL_TOOLS.map(tool => tool.name)).size).toBe(ALL_TOOLS.length);
    for (const tool of ALL_TOOLS) {
      const schema = describeTool(tool).outputSchema!;
      expect(schema, tool.name).toMatchObject({ type: "object" });
      expect(() => validator.getValidator(schema), tool.name).not.toThrow();
      if (!tool.outputSchema) expect(TOOL_NAMES, tool.name).toContain(tool.name);
    }
    for (const name of TOOL_NAMES) {
      const schema = outputSchemaFor({ name });
      expect(generatedToolOutputs.sources[name], name).toBeTruthy();
      const result = (schema.properties as Record<string, unknown>).result;
      expect(result, name).not.toEqual({});
      expect(result, name).not.toEqual({ type: "object" });
      expect(result, name).not.toEqual({ $ref: "#/$defs/JsonValue" });
      expect(() => validator.getValidator(schema), name).not.toThrow();
    }
  });
  it("没有领域结果定义的新工具不能静默发布空契约", () => {
    expect(() => outputSchemaFor({ name: "unknown.tool" })).toThrow("工具缺少输出契约");
  });
  it("按真实传输表示接受Date、nullable和幂等完成结果", () => {
    const output = currentResult("attachment.list", { attachments: [attachment] });
    expect(JSON.stringify(output)).toContain("2026-11-16T00:00:00.000Z");
    const completion = { replayed: true, result: { id, projectId: id, completedAt: "2026-11-16T00:00:00Z", targetIterationId: null, carriedOverCount: null, remainingCount: null, movedCount: null, movedWorkItemIds: null } };
    expect(validatedToolOutput({ name: "plan.completeIteration" }, completion)).toEqual({ result: completion });
    expect(() => validatedToolOutput({ name: "plan.completeIteration" }, completion.result)).toThrow("工具输出不符合声明的契约");
  });
  it.each([
    { items: [], total: "1" },
    { items: [{ id: 1, key: "P", name: "Project", status: null, workItemCount: 0 }], total: 1 },
    { items: [{ id, key: "P", name: "Project", status: null }], total: 1 },
  ])("拒绝真实业务列表的错误计数、字段类型和缺失字段 %j", (invalid) => {
    expect(() => validatedToolOutput({ name: "project.list" }, invalid)).toThrow("工具输出不符合声明的契约");
  });
  it("嵌套时间字段必须是合法日期且不能泄漏未声明字段", () => {
    expect(() => currentResult("attachment.list", { attachments: [{ ...attachment, createdAt: "yesterday" }] })).toThrow();
    expect(() => currentResult("attachment.list", { attachments: [{ ...attachment, storagePath: "/private/data" }] })).toThrow();
  });
});
