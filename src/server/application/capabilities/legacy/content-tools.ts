/** 内容、文档、附件、自动化与收集表单的原始工具定义；统一守卫由注册入口应用。 */
import { z } from "zod";
import { updateAutomationRuleSchema } from "../../../../shared/schemas/automation.ts";
import type { ToolCtx, ToolDef } from "../tools.ts";
import { withIdempotency } from "../../../services/idempotency.service.ts";
import * as idea from "../../../services/idea.service.ts";
import * as wiki from "../../../services/wiki.service.ts";
import * as attachment from "../../../services/attachment.service.ts";
import * as notification from "../../../services/notification.service.ts";
import * as announcement from "../../../services/announcement.service.ts";
import * as intake from "../../../services/intake.service.ts";
import * as sla from "../../../services/sla.service.ts";
import {
  prioritySchema,
  severitySchema,
  workItemTypeSchema,
} from "../../../../shared/schemas/work-item.ts";
import * as content from "../../../services/mcp-content.service.ts";

const uuid = z.string().uuid();
const pageId = { pageId: uuid };
const ideaId = { ideaId: uuid };
const formId = { formId: uuid };
const submissionId = { submissionId: uuid };
const ruleId = { projectId: uuid, ruleId: uuid };
const text = z.string().min(1).max(300);
const field = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    label: z.string().min(1).max(300),
    type: z.enum(["TEXT", "TEXTAREA", "SELECT"]).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().max(500)).min(1).max(100).optional(),
  })
  .strict();
const fields = z.array(field).min(1).max(30);
const idem = { idempotencyKey: z.string().min(1).max(200).optional() };
const permission = z
  .object({
    principalType: z.enum(["MEMBER", "TEAM", "ROLE"]),
    principalId: uuid,
    canRead: z.boolean(),
    canWrite: z.boolean(),
  })
  .strict();
const schema = (shape: z.ZodRawShape) =>
  z.toJSONSchema(z.object(shape).strict(), { target: "draft-7" });
const props = (args: Record<string, unknown>, omitted: string[]) =>
  Object.fromEntries(
    Object.entries(args).filter(([k]) => !omitted.includes(k)),
  );
async function idempotent<T>(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>,
) {
  // 授权不能缓存在幂等结果里：撤销角色或 ACL 后，同 key 也必须拒绝。
  if (name === "page.restore")
    await wiki.assertPageWritable(ctx.actor, String(args.pageId));
  if (name === "intake.createForm")
    await intake.listForms(ctx.actor, String(args.projectId));
  if (name === "sla.createPolicy")
    await sla.listPolicies(ctx.actor, String(args.projectId));
  const result = await withIdempotency(
    {
      actorId: ctx.actor.memberId,
      key: (args.idempotencyKey as string | undefined) ?? null,
      scope: name,
      body: args,
    },
    fn,
  );
  return { replayed: result.replayed, result: result.value };
}
const done = async (action: Promise<void>) => {
  await action;
  return { ok: true };
};

const calendar = z
  .object({
    enabled: z.boolean().optional(),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    start: z
      .string()
      .regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
      .optional(),
    end: z
      .string()
      .regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
      .optional(),
    holidays: z.array(z.iso.date()).max(1000).optional(),
    extraWorkdays: z.array(z.iso.date()).max(1000).optional(),
  })
  .strict();
const slaPolicy = z
  .object({
    name: z.string().trim().min(1).max(120),
    priority: prioritySchema.nullable().optional(),
    severity: severitySchema.nullable().optional(),
    type: workItemTypeSchema.nullable().optional(),
    responseMinutes: z.number().int().min(1).max(129600),
    resolveMinutes: z.number().int().min(1).max(129600),
    escalateAfterMinutes: z.number().int().min(1).max(129600).optional(),
    escalateRoles: z.array(z.string().min(1).max(100)).max(100).optional(),
    calendar: calendar.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const CONTENT_TOOLS: ToolDef[] = [
  {
    name: "sla.listPolicies",
    description: "列出同项目 SLA 策略 ID、时限、匹配条件和日历；需项目管理权。",
    kind: "read",
    inputSchema: schema({ projectId: uuid }),
    handler: async (ctx, a) => ({
      policies: await sla.listPolicies(ctx.actor, String(a.projectId)),
    }),
  },
  {
    name: "sla.createPolicy",
    description:
      "创建项目 SLA 策略（幂等键）；时限为 1 至 129600 整数分钟，解决时限不能小于响应时限。",
    kind: "write",
    inputSchema: z.toJSONSchema(
      slaPolicy.extend({ projectId: uuid, ...idem }).strict(),
      { target: "draft-7" },
    ),
    handler: (ctx, a) =>
      idempotent(ctx, "sla.createPolicy", a, () =>
        content.createSlaPolicy(
          ctx.actor,
          String(a.projectId),
          props(a, ["projectId", "idempotencyKey"]) as Parameters<
            typeof content.createSlaPolicy
          >[2],
        ),
      ),
  },
  {
    name: "sla.updatePolicy",
    description: "更新同项目 SLA 策略；合并当前值验证响应和解决时限。",
    kind: "write",
    inputSchema: z.toJSONSchema(
      slaPolicy.partial().extend({ projectId: uuid, policyId: uuid }).strict(),
      { target: "draft-7" },
    ),
    handler: (ctx, a) =>
      content.updateSlaPolicy(
        ctx.actor,
        String(a.projectId),
        String(a.policyId),
        props(a, ["projectId", "policyId"]),
      ),
  },
  {
    name: "sla.deletePolicy",
    description:
      "删除同项目 SLA 策略，已有 SLA 保留时钟并解除策略关联。执行前确认目标。",
    kind: "write",
    destructive: true,
    inputSchema: schema({ projectId: uuid, policyId: uuid }),
    handler: (ctx, a) =>
      content.deleteSlaPolicy(
        ctx.actor,
        String(a.projectId),
        String(a.policyId),
      ),
  },

  {
    name: "idea.list",
    description: "列出项目想法，按热度分页；供想法 ID 发现。",
    kind: "read",
    inputSchema: schema({
      projectId: uuid,
      status: z.enum(idea.IDEA_STATUSES).optional(),
      page: z.number().int().min(1).max(100000).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }),
    handler: (ctx, a) =>
      idea.listIdeas(ctx.actor, String(a.projectId), props(a, ["projectId"])),
  },
  {
    name: "idea.get",
    description: "读取想法详情、投票与票数。",
    kind: "read",
    inputSchema: schema(ideaId),
    handler: (ctx, a) => idea.getIdea(ctx.actor, String(a.ideaId)),
  },
  {
    name: "idea.update",
    description: "更新想法内容或评审状态；需要想法管理权限。",
    kind: "write",
    inputSchema: schema({
      ...ideaId,
      title: text.optional(),
      description: z.string().max(100000).nullable().optional(),
      status: z.enum(idea.IDEA_STATUSES).optional(),
    }),
    handler: (ctx, a) =>
      idea.updateIdea(ctx.actor, String(a.ideaId), props(a, ["ideaId"])),
  },
  {
    name: "idea.unvote",
    description: "撤销当前成员对想法的投票，重算热度。",
    kind: "write",
    idempotent: true,
    inputSchema: schema(ideaId),
    handler: (ctx, a) => done(idea.unvote(ctx.actor, String(a.ideaId))),
  },
  {
    name: "idea.delete",
    description: "删除想法并清理关联引用。执行前确认目标。",
    kind: "write",
    destructive: true,
    inputSchema: schema(ideaId),
    handler: (ctx, a) => done(idea.deleteIdea(ctx.actor, String(a.ideaId))),
  },
  {
    name: "page.revisions",
    description: "列出可见文档最近 100 个历史版本 ID。",
    kind: "read",
    inputSchema: schema(pageId),
    handler: async (ctx, a) => ({
      revisions: await wiki.listRevisions(ctx.actor, String(a.pageId)),
    }),
  },
  {
    name: "page.restore",
    description:
      "将该文档历史版本内容追加为新版本。执行前确认目标；幂等键避免重复生成版本。",
    kind: "write",
    destructive: true,
    inputSchema: schema({ ...pageId, revisionId: uuid, expectedRevisionId: uuid, ...idem }),
    handler: (ctx, a) =>
      idempotent(ctx, "page.restore", a, () =>
        wiki.restoreRevision(ctx.actor, String(a.pageId), String(a.revisionId), String(a.expectedRevisionId)),
      ),
  },
  {
    name: "page.delete",
    description: "删除文档及后代文档。执行前确认删除范围。",
    kind: "write",
    destructive: true,
    inputSchema: schema(pageId),
    handler: (ctx, a) => done(wiki.deletePage(ctx.actor, String(a.pageId))),
  },
  {
    name: "page.permissions",
    description:
      "读取文档 ACL；需要页面权限管理权。主体 ID 可由 project.members 等发现。",
    kind: "read",
    inputSchema: schema(pageId),
    handler: async (ctx, a) => ({
      permissions: await wiki.listPermissions(ctx.actor, String(a.pageId)),
    }),
  },
  {
    name: "page.setPermissions",
    description: "替换受限文档 ACL，至少保留一个可读主体。执行前确认授权范围。",
    kind: "write",
    destructive: true,
    idempotent: true,
    inputSchema: schema({
      ...pageId,
      permissions: z.array(permission).min(1).max(200),
    }),
    handler: async (ctx, a) => ({
      permissions: await wiki.setPermissions(
        ctx.actor,
        String(a.pageId),
        a.permissions as Parameters<typeof wiki.setPermissions>[2],
      ),
    }),
  },
  {
    name: "attachment.download",
    description:
      "下载有权限读取的附件为 base64，最多 8 MiB；较大文件请走授权 HTTP 下载端点。",
    kind: "read",
    inputSchema: schema({ attachmentId: uuid }),
    handler: (ctx, a) =>
      content.downloadAttachment(ctx.actor, String(a.attachmentId)),
  },
  {
    name: "attachment.remove",
    description: "删除自己上传的附件；需能读取附件目标。执行前确认目标。",
    kind: "write",
    destructive: true,
    inputSchema: schema({ attachmentId: uuid }),
    handler: (ctx, a) =>
      done(attachment.remove(ctx.actor, String(a.attachmentId))),
  },
  {
    name: "attachment.get",
    description: "读取附件安全元数据及真实父对象；沿用父对象可读权限，不返回存储位置或文件内容。",
    kind: "read",
    inputSchema: schema({ attachmentId: uuid }),
    handler: (ctx, a) => attachment.getMetadata(ctx.actor, String(a.attachmentId)),
  },
  {
    name: "automation.updateRule",
    description:
      "更新项目内的自动化规则。沿用完整条件和动作契约；需要项目管理权。",
    kind: "write",
    inputSchema: z.toJSONSchema(
      updateAutomationRuleSchema.extend(ruleId).strict(),
      { target: "draft-7" },
    ),
    handler: (ctx, a) =>
      content.updateRule(
        ctx.actor,
        String(a.projectId),
        String(a.ruleId),
        props(a, ["projectId", "ruleId"]),
      ),
  },
  {
    name: "automation.deleteRule",
    description: "删除项目内自动化规则。执行前确认规则。",
    kind: "write",
    destructive: true,
    inputSchema: schema(ruleId),
    handler: (ctx, a) =>
      content.deleteRule(ctx.actor, String(a.projectId), String(a.ruleId)),
  },
  {
    name: "automation.testRule",
    description:
      "只判断规则条件是否匹配同项目工作项，不执行动作。规则 ID 从 automation.listRules 获取。",
    kind: "read",
    inputSchema: schema({ ...ruleId, workItemId: uuid }),
    handler: (ctx, a) =>
      content.testRule(
        ctx.actor,
        String(a.projectId),
        String(a.ruleId),
        String(a.workItemId),
      ),
  },
  {
    name: "notification.getPrefs",
    description: "读取当前成员的通知与免打扰偏好。",
    kind: "read",
    scope: "identity",
    inputSchema: schema({}),
    handler: (ctx) => notification.getPreferences(ctx.actor),
  },
  {
    name: "announcement.list",
    description: "列出全组织最近 100 条公告，需要未限制项目的令牌。",
    kind: "read",
    scope: "account",
    inputSchema: schema({ includeRevoked: z.boolean().optional() }),
    handler: async (ctx, a) => ({
      announcements: await announcement.listAnnouncements(
        ctx.actor,
        a as Parameters<typeof announcement.listAnnouncements>[1],
      ),
    }),
  },
  {
    name: "intake.listForms",
    description:
      "列出项目收集表单 ID、字段和启用状态。绝不返回提交令牌。需要想法管理权。",
    kind: "read",
    inputSchema: schema({ projectId: uuid }),
    handler: async (ctx, a) => ({
      forms: await intake.listForms(ctx.actor, String(a.projectId)),
    }),
  },
  {
    name: "intake.getForm",
    description:
      "读取同项目的收集表单字段定义，供管理与提交记录发现；不返回匿名提交凭据。",
    kind: "read",
    inputSchema: schema({ projectId: uuid, ...formId }),
    handler: (ctx, a) =>
      content.getForm(ctx.actor, String(a.projectId), String(a.formId)),
  },
  {
    name: "intake.createForm",
    description:
      "创建收集表单（幂等键），返回表单元数据；匿名提交链接由已授权的表单管理页面获取。",
    kind: "write",
    inputSchema: schema({
      projectId: uuid,
      name: text,
      schema: fields,
      ...idem,
    }),
    handler: (ctx, a) =>
      idempotent(ctx, "intake.createForm", a, () =>
        content.createForm(ctx.actor, String(a.projectId), {
          name: String(a.name),
          schema: a.schema,
        }),
      ),
  },
  {
    name: "intake.updateForm",
    description: "更新表单名称、字段或启用状态，不返回提交令牌。",
    kind: "write",
    inputSchema: schema({
      ...formId,
      name: text.optional(),
      isActive: z.boolean().optional(),
      schema: fields.optional(),
    }),
    handler: (ctx, a) =>
      intake.updateForm(ctx.actor, String(a.formId), props(a, ["formId"])),
  },
  {
    name: "intake.deleteForm",
    description:
      "删除无提交记录的收集表单；已有提交时请改为停用。执行前确认目标。",
    kind: "write",
    destructive: true,
    inputSchema: schema(formId),
    handler: (ctx, a) => done(intake.deleteForm(ctx.actor, String(a.formId))),
  },
  {
    name: "intake.listSubmissions",
    description: "列出项目收集提交记录 ID、内容和处理状态；可按状态筛选。",
    kind: "read",
    inputSchema: schema({
      projectId: uuid,
      status: z.enum(["PENDING", "CONVERTED", "REJECTED"]).optional(),
    }),
    handler: (ctx, a) =>
      intake.listSubmissions(
        ctx.actor,
        String(a.projectId),
        props(a, ["projectId"]),
      ),
  },
  {
    name: "intake.convertSubmission",
    description: "将授权可见的提交记录转换为想法；重复调用返回已转换想法。",
    kind: "write",
    idempotent: true,
    inputSchema: schema(submissionId),
    handler: (ctx, a) =>
      intake.convertSubmission(ctx.actor, String(a.submissionId)),
  },
  {
    name: "intake.rejectSubmission",
    description: "驳回提交记录。执行前确认目标提交。",
    kind: "write",
    destructive: true,
    idempotent: true,
    inputSchema: schema(submissionId),
    handler: (ctx, a) =>
      done(intake.rejectSubmission(ctx.actor, String(a.submissionId))),
  },
];
