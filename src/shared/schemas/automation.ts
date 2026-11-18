/** REST、MCP 与领域服务共用的自动化可执行契约。 */
import { z } from "zod";

export const AUTOMATION_TRIGGERS = ["WORK_ITEM_CREATED", "WORK_ITEM_UPDATED", "STATUS_CHANGED", "COMMENT_ADDED", "SLA_BREACHED", "SCHEDULE"] as const;
const uuid = z.string().uuid();
const text = z.string().max(10000);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const automationConditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(["eq", "neq", "in", "not_in", "contains", "is_empty", "is_not_empty"]),
  value: z.union([scalar, z.array(scalar).max(100)]).optional(),
}).strict();
export const automationConditionsSchema = z.object({
  all: z.array(automationConditionSchema).max(100).optional(),
  any: z.array(automationConditionSchema).max(100).optional(),
}).strict();
export const automationActionSchema = z.union([
  z.object({ type: z.literal("ASSIGN"), memberId: uuid }).strict(),
  z.object({ type: z.literal("SET_FIELD"), field: z.literal("priority"), value: z.enum(["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"]).nullable().optional() }).strict(),
  z.object({ type: z.literal("SET_FIELD"), field: z.enum(["assigneeId", "iterationId", "milestoneId"]), value: uuid.nullable().optional() }).strict(),
  z.object({ type: z.literal("TRANSITION"), toStateKey: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("ADD_COMMENT"), body: text.optional() }).strict(),
  z.object({ type: z.literal("NOTIFY"), memberIds: z.array(uuid).max(100).optional(), roles: z.array(z.string().min(1).max(100)).max(100).optional(), title: z.string().max(500).optional(), body: text.optional() }).strict(),
  z.object({ type: z.literal("CALL_WEBHOOK") }).strict(),
]);
export const createAutomationRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: automationConditionsSchema.optional(),
  actions: z.array(automationActionSchema).min(1).max(20),
  enabled: z.boolean().optional(),
  scheduleCron: z.string().trim().max(80).nullable().optional(),
  scheduleTimezone: z.string().min(1).max(80).nullable().optional(),
}).strict();
export const updateAutomationRuleSchema = createAutomationRuleSchema.partial();
export const mcpAutomationRuleSchema = createAutomationRuleSchema.extend({ projectId: uuid, idempotencyKey: z.string().optional() });
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;
