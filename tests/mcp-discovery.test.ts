// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
import { describeFields } from "../src/server/services/meta.service.ts";
import { annotationsFor, outputSchemaFor, validatedToolOutput } from "../src/server/mcp/contracts.ts";
import type { ToolDef } from "../src/server/mcp/tools.ts";
const definition = (name: string, extra: Partial<ToolDef> = {}): ToolDef => ({ name, description: "", kind: "write", inputSchema: { type: "object" }, handler: async () => ({}), ...extra });
describe("智能体发现契约", () => {
  it("字段发现与创建和更新schema同源，包含小时估算与清空语义", () => {
    const fields = describeFields();
    expect(fields.fields.find((field) => field.name === "estimateHours")).toMatchObject({ required: false, nullable: true });
    expect(fields.schemas.create.properties).toHaveProperty("estimateHours");
    expect(fields.schemas.update.required).toContain("version");
  });
  it("可选幂等键不能承诺所有请求天然幂等，读工具始终幂等", () => {
    expect(annotationsFor(definition("project.create", { idempotent: true, inputSchema: { properties: { idempotencyKey: { type: "string" } } } })).idempotentHint).toBe(false);
    expect(annotationsFor(definition("workitem.link", { idempotent: true })).idempotentHint).toBe(true);
    expect(annotationsFor(definition("project.list", { kind: "read" })).idempotentHint).toBe(true);
  });
  it("高影响操作可机器识别，详情与分页结果有具体输出契约", () => {
    expect(annotationsFor(definition("automation.createRule")).destructiveHint).toBe(true);
    expect(annotationsFor(definition("import.confirm")).destructiveHint).toBe(true);
    const get = outputSchemaFor(definition("workitem.get"));
    const resolve = (schema: Record<string, unknown>, root: Record<string, unknown>): Record<string, unknown> => {
      const name = (schema.$ref as string | undefined)?.split("/").at(-1);
      return name ? (root.$defs as Record<string, Record<string, unknown>>)[name]! : schema;
    };
    const detail = resolve((get.properties as Record<string, Record<string, unknown>>).result!, get);
    const workItem = resolve((detail.properties as Record<string, Record<string, unknown>>).workItem!, get);
    expect(workItem.required).toEqual(expect.arrayContaining(["id", "version"]));
    const list = outputSchemaFor(definition("workitem.list"));
    const result = resolve((list.properties as Record<string, Record<string, unknown>>).result!, list);
    expect(result.properties).toMatchObject({ items: { type: "array" }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } });
    expect(() => validatedToolOutput(definition("workitem.list"), { items: [], total: 0, page: 1, pageSize: 50 })).not.toThrow();
    expect(() => validatedToolOutput(definition("workitem.list"), { items: [], total: "0", page: 1, pageSize: 50 })).toThrow("工具输出不符合声明的契约");
  });
});
