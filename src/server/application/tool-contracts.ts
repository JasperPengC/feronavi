/** 业务能力发现和传输适配器共用契约；不依赖 HTTP/MCP 注册表。 */
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolDef } from "./capabilities/tools.ts";
import { DomainError } from "../../shared/errors.ts";
import { generatedToolOutputs } from "./tool-output-schemas.generated.ts";

export const TOOL_NAMES = Object.freeze(Object.keys(generatedToolOutputs.results));
const validator = new AjvJsonSchemaValidator();
const schemas = new Map<string, Record<string, unknown>>();
const validators = new WeakMap<object, ReturnType<typeof validator.getValidator>>();

/** 每个发现结果只携带自己引用的定义，避免把整个工具集递归塞进响应。 */
export function outputSchemaFor(tool: Pick<ToolDef, "name" | "outputSchema">): Record<string, unknown> {
  if (tool.outputSchema) return tool.outputSchema;
  const cached = schemas.get(tool.name);
  if (cached) return cached;
  const result = generatedToolOutputs.results[tool.name];
  if (!result) throw new DomainError("INTERNAL", "工具缺少输出契约", { tool: tool.name });
  const definitions: Record<string, unknown> = {};
  function collect(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(collect); return; }
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === "string" && object.$ref.startsWith("#/$defs/")) {
      const name = object.$ref.slice("#/$defs/".length);
      if (!(name in definitions)) {
        const definition = generatedToolOutputs.definitions[name];
        if (!definition) throw new DomainError("INTERNAL", "工具输出契约引用不存在", { tool: tool.name, definition: name });
        definitions[name] = definition;
        collect(definition);
      }
    }
    Object.values(object).forEach(collect);
  }
  collect(result);
  const schema = {
    type: "object", properties: { result }, required: ["result"], additionalProperties: false,
    ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
  };
  schemas.set(tool.name, schema);
  return schema;
}

/** JSON 序列化后再校验：Date、undefined与幂等缓存重放使用相同传输表示。 */
export function validatedToolOutput(tool: Pick<ToolDef, "name" | "outputSchema">, result: unknown): { result: unknown } {
  let structured: { result: unknown };
  try { structured = JSON.parse(JSON.stringify({ result: result ?? null })) as { result: unknown }; }
  catch { throw new DomainError("INTERNAL", "工具输出无法序列化", { tool: tool.name }); }
  const schema = outputSchemaFor(tool);
  let validate = validators.get(schema);
  if (!validate) { validate = validator.getValidator(schema); validators.set(schema, validate); }
  const checked = validate(structured);
  if (!checked.valid) throw new DomainError("INTERNAL", "工具输出不符合声明的契约", { tool: tool.name, reason: checked.errorMessage });
  return structured;
}
const naturalIdempotent = new Set(["workitem.link", "idea.vote", "idea.unvote", "idea.promote", "notification.setPrefs", "notification.markRead", "plan.completeIteration", "plan.completeRelease"]);
const highImpact = new Set(["workitem.transition", "customField.setValues", "savedView.update", "announcement.send", "automation.createRule", "automation.updateRule", "workflow.create", "workflow.update", "role.assign", "role.updateAssignment", "organization.assignMember", "organization.applyTemplate", "webhook.replay", "integration.sync"]);
export function annotationsFor(tool: ToolDef) {
  const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;
  return {
    readOnlyHint: tool.kind === "read",
    destructiveHint: tool.destructive ?? (tool.kind === "write" && (highImpact.has(tool.name) || /\.(?:delete|remove|revoke|archive|restore|promote|approve|reject|confirm|rollback|setPermissions)/u.test(tool.name))),
    idempotentHint: tool.kind === "read" || naturalIdempotent.has(tool.name) || (tool.idempotent === true && !properties?.idempotencyKey),
    openWorldHint: ["knowledge.ask", "rag.search", "rag.chat", "rag.conversation.send", "announcement.send", "automation.createRule", "integration.sync", "webhook.replay"].includes(tool.name),
  };
}
