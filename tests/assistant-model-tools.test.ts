// @vitest-environment node
import { expect, it } from "vitest";
import { AssistantModelTools, assistantInputSchema } from "../src/server/services/assistant-model-tools.ts";
import type { ToolDef } from "../src/server/application/capabilities/tools.ts";
const tool = (name: string, kind: "read" | "write" = "read"): ToolDef => ({ name, kind, description: name, inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => ({}) });
it("发现业务流程，按需装载后下一轮只提供有界工具集，切换不会积累全部目录", () => {
  const registry = [tool("project.get"), tool("todo.list"), tool("todo.create", "write"), tool("role.assign", "write")];
  const tools = new AssistantModelTools(registry, new Set(["project.get"]), true);
  expect(tools.discover().workflows).toHaveLength(21);
  expect(tools.discover().workflows.some(flow => String(flow.id) === "connections")).toBe(false);
  expect(tools.definitions().map(t => t.function.name)).not.toContain("propose_todo_create");
  tools.load("personal");
  expect(tools.definitions().map(t => t.function.name)).toContain("propose_todo_create");
  tools.load("organization");
  expect(tools.definitions().map(t => t.function.name)).not.toContain("propose_todo_create");
  expect(tools.definitions().length).toBeLessThanOrEqual(128);
});
it("无持久会话不加载写能力，未知流程拒绝", () => {
  const tools = new AssistantModelTools([tool("todo.create", "write"), tool("todo.list")], new Set(), false);
  tools.load("personal");
  expect(tools.definitions().some(t => t.function.name.startsWith("propose_"))).toBe(false);
  expect(() => tools.load("not-a-workflow")).toThrow();
});
it.each([ ["attachment.upload", "artifactId"], ["import.create", "artifactId"], ["integration.create", "credentialRef"] ])("%s模型契约只收受控引用", (name, replacement) => {
  const definition = { ...tool(name, "write"), inputSchema: { type: "object", properties: { contentBase64: {type:"string"}, token: {type:"string"}, filename:{type:"string"} }, required:["contentBase64","token","filename"], additionalProperties:false } };
  const schema = assistantInputSchema(definition);
  expect(schema.properties).toHaveProperty(replacement);
  expect(schema.properties).not.toHaveProperty(name === "integration.create" ? "token" : "contentBase64");
  expect(schema.required).toContain(replacement);
});

it("模型契约不暴露确认字段，资源所属项目由服务端解析，当前附件使用受控引用", () => {
  const original = { ...tool("attachment.upload", "write"), inputSchema: { type: "object", properties: { projectId: { type: "string" }, targetId: { type: "string" }, originalName: { type: "string" }, dataBase64: { type: "string" }, userConfirmed: { type: "boolean" } }, required: ["projectId", "targetId", "originalName", "dataBase64", "userConfirmed"], additionalProperties: false } };
  const schema = assistantInputSchema(original);
  expect(schema.properties).not.toHaveProperty("userConfirmed");
  expect(schema.properties).not.toHaveProperty("dataBase64");
  expect(schema.required).toEqual(["targetId", "originalName", "artifactId"]);
  expect(original.inputSchema.required).toContain("userConfirmed");
});
