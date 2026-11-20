/** 只补回旧产品独有名称；当前能力是重名契约的唯一实现。 */
import { z } from "zod";
import type { ToolDef } from "./tools.ts";
import { CONTENT_TOOLS } from "./legacy/content-tools.ts";
import { OPERATIONS_TOOLS } from "./legacy/operations-tools.ts";
import { COLLABORATION_TOOLS } from "./legacy/collaboration-tools.ts";
import { PROJECT_TOOLS } from "./legacy/project-tools.ts";
import { WORK_PLANNING_TOOLS } from "./legacy/work-planning-tools.ts";
import { ADMINISTRATION_TOOLS } from "./legacy/administration-tools.ts";
import { outputSchemaFor } from "../tool-contracts.ts";
import * as fields from "../../services/custom-field.service.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";

function concrete(schema: Record<string, unknown>, definitions: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const ref = typeof schema.$ref === "string" ? schema.$ref.split("/").at(-1) : undefined;
  return ref ? concrete(definitions[ref]!, definitions) : schema;
}
export function withCompatibilityOutput(tool: ToolDef): ToolDef {
  if (tool.outputSchema) return tool;
  const envelope = outputSchemaFor(tool);
  const result = (envelope.properties as Record<string, Record<string, unknown>>).result!;
  const definitions = envelope.$defs as Record<string, Record<string, unknown>> | undefined ?? {};
  const body = concrete(result, definitions);
  if (body.type === "object") return { ...tool, outputSchema: { ...body, ...(Object.keys(definitions).length ? { $defs: definitions } : {}) } as ToolDef["outputSchema"] };
  // MCP structuredContent必须是对象；旧数组/标量结果只保留一次显式result封装。
  return { ...tool, resultEnvelope: true, outputSchema: envelope as ToolDef["outputSchema"], handler: async (ctx, args) => ({ result: await tool.handler(ctx, args) ?? null }) };
}
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-7" });
const extra: ToolDef[] = [
  { name: "customField.getValues", kind: "read", description: "读取工作项字段定义与当前值。", inputSchema: schema(z.object({ workItemId: z.uuid() }).strict()), handler: async (ctx, args) => ({ values: await fields.getValues(ctx.actor, String(args.workItemId)) }) },
  { name: "customField.setValues", kind: "write", description: "按当前工作项版本更新字段值，需用户确认；null清空字段。", inputSchema: schema(z.object({ workItemId: z.uuid(), expectedVersion: z.number().int().min(1), values: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(1).max(200).optional() }).strict()), handler: async (ctx, args) => {
    await fields.assertValuesWritable(ctx.actor, String(args.workItemId));
    const result = await withIdempotency({ actorId: ctx.actor.memberId, key: args.idempotencyKey as string | undefined ?? null, scope: "customField.setValues", body: args }, () => fields.setValues(ctx.actor, String(args.workItemId), args.values as Record<string, unknown>, Number(args.expectedVersion)));
    return { replayed: result.replayed, result: result.value };
  } },
];

export function compatibilityTools(current: ToolDef[]): ToolDef[] {
  const names = new Set(current.map(tool => tool.name));
  const legacyNames = new Set<string>();
  const candidates = [...CONTENT_TOOLS, ...OPERATIONS_TOOLS, ...COLLABORATION_TOOLS, ...PROJECT_TOOLS, ...WORK_PLANNING_TOOLS, ...ADMINISTRATION_TOOLS, ...extra];
  const additions: ToolDef[] = [];
  for (const tool of candidates) {
    if (names.has(tool.name) || /^(integration|webhook|im)\./u.test(tool.name)) continue;
    if (legacyNames.has(tool.name)) throw new Error(`兼容能力名称重复：${tool.name}`);
    legacyNames.add(tool.name);
    additions.push(withCompatibilityOutput(tool));
  }
  return additions;
}
