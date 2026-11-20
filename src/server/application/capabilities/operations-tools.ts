/** 自动化、SLA 和通知运维的业务工具；统一由注册处包装权限和输入守卫。 */
import { z } from "zod";
import { prioritySchema, severitySchema, workItemTypeSchema } from "../../../shared/schemas/work-item.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { assertTokenScope } from "./guard.ts";
import { DomainError } from "../../../shared/errors.ts";
import { projectForMcpResource } from "../../services/mcp-resource.service.ts";
import { automationConditionsSchema, automationActionSchema, updateAutomationRuleSchema } from "../../../shared/schemas/automation.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import * as automation from "../../services/automation.service.ts";
import * as sla from "../../services/sla.service.ts";
import * as notifications from "../../services/notification.service.ts";
import * as announcements from "../../services/announcement.service.ts";

const uuid = z.string().uuid();
const confirmed = { userConfirmed: z.boolean().describe("用户已明确确认本次写操作") };
const project = { projectId: uuid };
const ruleRef = { ...project, ruleId: uuid };
const policyRef = { ...project, policyId: uuid };
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-7" }) as NonNullable<ToolDef["outputSchema"]>;
const ok = schema(z.object({ ok: z.boolean() }).strict());
const ruleOutput = schema(z.object({
  id: uuid, projectId: uuid, name: z.string(), enabled: z.boolean(), trigger: z.string(),
  conditions: automationConditionsSchema, actions: z.array(automationActionSchema),
  scheduleCron: z.string().nullable(), scheduleTimezone: z.string().nullable(), lastScheduledAt: z.string().nullable(),
  scheduleState: z.object({
    scheduledAt: z.string(), cursor: uuid.nullable(),
    rule: z.object({
      id: uuid, projectId: uuid, name: z.string(), createdBy: uuid.nullable(),
      conditions: automationConditionsSchema, actions: z.array(automationActionSchema),
    }).strict(),
  }).strict().nullable(),
  createdBy: uuid.nullable(), createdAt: z.string(), updatedAt: z.string(),
}).strict());
const calendar = z.object({
  enabled: z.boolean().optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
  extraWorkdays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
}).strict();
const policyFields = z.object({
  name: z.string().trim().min(1).max(120), priority: prioritySchema.nullable().optional(),
  severity: severitySchema.nullable().optional(), type: workItemTypeSchema.nullable().optional(),
  responseMinutes: z.number().int().positive(), resolveMinutes: z.number().int().positive(),
  escalateAfterMinutes: z.number().int().positive().optional(), escalateRoles: z.array(z.string().max(80)).max(20).optional(),
  calendar: calendar.nullable().optional(), enabled: z.boolean().optional(),
}).strict();
const policyEntity = policyFields.required().extend({ id: uuid, projectId: uuid, createdAt: z.string(), updatedAt: z.string() });
const policyOutput = schema(policyEntity);

async function ruleFor(ctx: ToolCtx, projectId: string, ruleId: string) {
  const rule = (await automation.listRules(ctx.actor, projectId)).find(row => row.id === ruleId);
  if (!rule) throw new DomainError("NOT_FOUND", "规则不存在", null);
  return rule;
}
async function policyFor(ctx: ToolCtx, projectId: string, policyId: string) {
  const policy = (await sla.listPolicies(ctx.actor, projectId)).find(row => row.id === policyId);
  if (!policy) throw new DomainError("NOT_FOUND", "策略不存在", null);
  return policy;
}

/** 协作入口与直接工具共用嵌套引用守卫，规则动作不能引用令牌范围外的计划。 */
export async function assertAutomationReferences(ctx: ToolCtx, input: Record<string, unknown>) {
  if (!Array.isArray(input.actions)) return;
  for (const raw of input.actions) {
    const parsed = automationActionSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", "自动化动作不合法", parsed.error.issues);
    const action = parsed.data;
    if (action.type === "SET_FIELD" && ["iterationId", "milestoneId"].includes(action.field) && typeof action.value === "string") {
      await assertTokenScope(ctx, "automation.updateRule", { projectId: input.projectId, [action.field]: action.value });
      const projectId = await projectForMcpResource(action.field === "iterationId" ? "iteration" : "milestone", action.value);
      if (!projectId || projectId !== input.projectId) throw new DomainError("NOT_FOUND", "规则关联计划不存在于该项目", null);
    }
  }
}

export const OPERATIONS_TOOLS: ToolDef[] = [
  {
    name: "automation.dryRun", kind: "read", description: "对项目内工作项试运行已保存规则的条件，只返回匹配结果，不执行动作。",
    inputSchema: schema(z.object({ ...ruleRef, workItemId: uuid }).strict()), outputSchema: schema(z.object({ matched: z.boolean() }).strict()),
    handler: async (ctx, args) => automation.testRule(ctx.actor, String(args.projectId), await ruleFor(ctx, String(args.projectId), String(args.ruleId)), String(args.workItemId)),
  },
  {
    name: "automation.updateRule", kind: "write", description: "修改自动化规则；enabled=false 可停用。需要 userConfirmed=true。",
    inputSchema: schema(updateAutomationRuleSchema.extend({ ...ruleRef, ...confirmed }).strict()), outputSchema: ruleOutput,
    handler: async (ctx, args) => {
      const { projectId, ruleId, userConfirmed, ...patch } = args;
      requireUserConfirmation(userConfirmed === true);
      await ruleFor(ctx, String(projectId), String(ruleId));
      await assertAutomationReferences(ctx, args);
      return automation.updateRule(ctx.actor, String(projectId), String(ruleId), patch);
    },
  },
  {
    name: "automation.disableRule", kind: "write", description: "停用指定项目的自动化规则，保留规则和历史运行记录。需要 userConfirmed=true。",
    inputSchema: schema(z.object({ ...ruleRef, ...confirmed }).strict()), outputSchema: ruleOutput,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await ruleFor(ctx, String(args.projectId), String(args.ruleId));
      return automation.updateRule(ctx.actor, String(args.projectId), String(args.ruleId), { enabled: false });
    },
  },
  {
    name: "automation.deleteRule", kind: "write", description: "删除指定项目的规则及运行记录。需要 userConfirmed=true；通常可先用 disableRule 停用。",
    inputSchema: schema(z.object({ ...ruleRef, ...confirmed }).strict()), outputSchema: ok,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await ruleFor(ctx, String(args.projectId), String(args.ruleId));
      return automation.deleteRule(ctx.actor, String(args.projectId), String(args.ruleId));
    },
  },
  {
    name: "sla.listPolicies", kind: "read", description: "列出指定项目的 SLA 策略、时限和工作日历。",
    inputSchema: schema(z.object(project).strict()), outputSchema: schema(z.object({ policies: z.array(policyEntity) }).strict()),
    handler: async (ctx, args) => ({ policies: await sla.listPolicies(ctx.actor, String(args.projectId)) }),
  },
  {
    name: "sla.getPolicy", kind: "read", description: "读取指定项目的单条 SLA 策略。",
    inputSchema: schema(z.object(policyRef).strict()), outputSchema: policyOutput,
    handler: async (ctx, args) => policyFor(ctx, String(args.projectId), String(args.policyId)),
  },
  {
    name: "sla.createPolicy", kind: "write", description: "创建项目 SLA 策略；解决时限不能小于响应时限。需要 userConfirmed=true。",
    inputSchema: schema(policyFields.extend({ ...project, ...confirmed })), outputSchema: policyOutput,
    handler: async (ctx, args) => {
      const { projectId, userConfirmed, ...input } = args;
      requireUserConfirmation(userConfirmed === true);
      return sla.createPolicy(ctx.actor, String(projectId), policyFields.parse(input));
    },
  },
  {
    name: "sla.updatePolicy", kind: "write", description: "修改项目 SLA 策略，包括停用、时限和工作日历。需要 userConfirmed=true。",
    inputSchema: schema(policyFields.partial().extend({ ...policyRef, ...confirmed })), outputSchema: policyOutput,
    handler: async (ctx, args) => {
      const { projectId, policyId, userConfirmed, ...patch } = args;
      requireUserConfirmation(userConfirmed === true);
      await policyFor(ctx, String(projectId), String(policyId));
      return sla.updatePolicy(ctx.actor, String(projectId), String(policyId), policyFields.partial().parse(patch));
    },
  },
  {
    name: "sla.deletePolicy", kind: "write", description: "删除项目 SLA 策略；已有工作项 SLA 记录保留。需要 userConfirmed=true。",
    inputSchema: schema(z.object({ ...policyRef, ...confirmed }).strict()), outputSchema: ok,
    handler: async (ctx, args) => {
      requireUserConfirmation(args.userConfirmed === true);
      await policyFor(ctx, String(args.projectId), String(args.policyId));
      return sla.deletePolicy(ctx.actor, String(args.projectId), String(args.policyId));
    },
  },
  {
    name: "notification.getPrefs", kind: "read", description: "读取本人的通知类别、免打扰和摘要偏好。需要未限制项目的令牌；setPrefs 会逐类别、逐渠道合并修改。",
    inputSchema: schema(z.object({}).strict()), outputSchema: schema(z.object({
      memberId: uuid, categoryPrefs: z.record(z.string(), z.object({ inApp: z.boolean().optional(), email: z.boolean().optional() }).strict()),
      dndStart: z.string().nullable(), dndEnd: z.string().nullable(), dndTimezone: z.string(), digestFrequency: z.string(), updatedAt: z.string(),
    }).strict()), handler: async ctx => notifications.getPreferences(ctx.actor),
  },
  {
    name: "announcement.list", kind: "read", description: "读取当前账号可见的最近100条公告；仅组织公告管理权限可包含已撤回内容。需要未限制项目的令牌。",
    inputSchema: schema(z.object({ includeRevoked: z.boolean().optional() }).strict()), outputSchema: schema(z.object({ announcements: z.array(z.object({
      id: uuid, authorId: uuid, title: z.string(), body: z.string(), severity: z.string(),
      audience: z.union([z.object({ roleKeys: z.array(z.string()).optional(), teamIds: z.array(uuid).optional() }).strict(), z.array(z.never())]),
      deliveredCount: z.number().int(), revokedAt: z.string().nullable(), createdAt: z.string(),
    }).strict()) }).strict()), handler: async (ctx, args) => ({ announcements: await announcements.listAnnouncements(ctx.actor, { includeRevoked: args.includeRevoked === true }) }),
  },
];
