/** 所有工具共享的运行时输入校验和令牌资源范围守卫。 */
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { DomainError } from "../../../shared/errors.ts";
import { projectAllowed, tierAllows } from "../../services/token.service.ts";
import { projectForMcpResource, type McpResourceKind } from "../../services/mcp-resource.service.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import { CONFIGURATION_ACCOUNT_TOOLS } from "./configuration-tools.ts";
import { WORKSPACE_HANDLER_SCOPE_TOOLS } from "./workspace-tools.ts";
import { ORGANIZATION_ACCOUNT_TOOLS } from "./organization-tools.ts";

const validator = new AjvJsonSchemaValidator();
// 这些工具没有可归属到项目的资源。全账号内容只允许不限制项目的令牌访问。
const identityTools = new Set(["ping", "whoami", "project.list", "meta.fields", "meta.capabilities", "meta.tool"]);
const accountTools = new Set(["notification.list", "notification.markRead", "notification.getPrefs", "notification.setPrefs", "announcement.list", "announcement.send", "announcement.revoke", "project.create", "member.list"]);
const scopeByName = (tool: ToolDef): ToolDef["scope"] => {
  if (tool.scope) return tool.scope;
  if (identityTools.has(tool.name)) return "identity";
  if (tool.name.startsWith("todo.") || tool.name.startsWith("focus.") || tool.name.startsWith("workbench.") || tool.name.startsWith("prefs.")) return "personal";
  if (accountTools.has(tool.name) || CONFIGURATION_ACCOUNT_TOOLS.has(tool.name) || ORGANIZATION_ACCOUNT_TOOLS.has(tool.name) || tool.name.startsWith("portfolio.")) return "account";
  if (tool.name.startsWith("savedView.") || tool.name.startsWith("dashboard.")) return "project-set";
};
const resources: Record<string, McpResourceKind> = {
  workItemId: "workItem", fromWorkItemId: "workItem", toWorkItemId: "workItem",
  pageId: "page", ideaId: "idea", milestoneId: "milestone", iterationId: "iteration",
  releaseId: "release", moduleId: "module", commentId: "comment", approvalId: "approval",
  targetIterationId: "iteration",
  attachmentId: "attachment", ruleId: "automationRule", formId: "intakeForm", submissionId: "intakeSubmission",
  fieldId: "customFieldDef", dashboardId: "dashboard", widgetId: "dashboardWidget", workflowId: "workflow",
  stateId: "workflowState", fromStateId: "workflowState", toStateId: "workflowState", transitionId: "workflowTransition",
  batchId: "importBatch", relationId: "relation", savedViewId: "savedView", workItemProgressUpdateId: "workItemProgressUpdate",
  milestoneProgressUpdateId: "milestoneProgressUpdate", timeLogId: "timeLog", contentLinkId: "contentLink", policyId: "slaPolicy",
};
const parents: Record<string, McpResourceKind> = {
  "workitem.create": "workItem", "workitem.update": "workItem", "workitem.comment": "comment", "page.create": "page", "plan.createModule": "module", "plan.updateModule": "module",
};

export async function assertTokenScope(ctx: ToolCtx, toolName: string, args: Record<string, unknown>, declaredScope?: ToolDef["scope"]): Promise<void> {
  if (identityTools.has(toolName)) return;
  if (WORKSPACE_HANDLER_SCOPE_TOOLS.has(toolName)) return; // 处理器按个人/项目/父资源实际归属逐项检查。
  if (toolName === "collab.inspect" || toolName === "collab.command") return; // 处理器先按房间 ACL 解析项目，再检查令牌范围。
  if (declaredScope === "identity") return;
  if (declaredScope === "project-set" && toolName.startsWith("rag.")) {
    if (typeof args.projectId === "string" && !projectAllowed(ctx.token, args.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
    for (const id of Array.isArray(args.projectIds) ? args.projectIds : []) if (typeof id !== "string" || !projectAllowed(ctx.token, id)) throw new DomainError("NOT_FOUND", "资源不存在", null);
    return; // RAG服务逐次检查会话归属、文档ACL与实际项目集合。
  }
  if (declaredScope === "account" || declaredScope === "personal" || accountTools.has(toolName) || CONFIGURATION_ACCOUNT_TOOLS.has(toolName) || ORGANIZATION_ACCOUNT_TOOLS.has(toolName)) {
    if (!projectAllowed(ctx.token, null)) throw new DomainError("FORBIDDEN", "此工具需要未限制项目的令牌", null);
    return;
  }
  let scoped = false;
  if (typeof args.projectId === "string") {
    scoped = true;
    if (!projectAllowed(ctx.token, args.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
  }
  for (const [key, value] of Object.entries(args)) {
    const kind = key === "parentId" ? parents[toolName] : resources[key];
    if (!kind || typeof value !== "string") continue;
    scoped = true;
    // 不限制项目时仍由领域服务检查存在和账号权限，避免重复读取。
    if (!ctx.token.projectWhitelist.length) continue;
    const projectId = await projectForMcpResource(kind, value);
    if (!projectId || !projectAllowed(ctx.token, projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
  }
  // 新增工具必须显式提供项目/资源归属，不能因为漏写守卫获得全账号权限。
  if (!scoped) throw new DomainError("FORBIDDEN", "工具未声明资源范围", null);
}

export function guardTools(definitions: ToolDef[]): ToolDef[] {
  return definitions.map((tool) => {
    const scope = scopeByName(tool);
    const originalProperties = tool.inputSchema.properties as Record<string, unknown> | undefined;
    const addedConfirmation = tool.kind === "write" && !originalProperties?.userConfirmed;
    const inputSchema = tool.kind === "write" ? {
      ...tool.inputSchema,
      properties: { ...originalProperties, userConfirmed: { type: "boolean", description: "用户已明确确认本次业务写入；必须为 true" } },
      required: [...new Set([...(tool.inputSchema.required as string[] | undefined ?? []), "userConfirmed"])],
    } : tool.inputSchema;
    const validate = validator.getValidator<Record<string, unknown>>(inputSchema);
    return {
      ...tool,
      scope,
      inputSchema,
      handler: async (ctx, args) => {
        const parsed = validate(args);
        if (!parsed.valid) throw new DomainError("VALIDATION", "工具参数不合法", { reason: parsed.errorMessage });
        if (!tierAllows(ctx.token, tool.kind)) throw new DomainError("FORBIDDEN", "当前令牌档位不允许该操作", null);
        if (tool.kind === "write") requireUserConfirmation(parsed.data.userConfirmed === true);
        await assertTokenScope(ctx, tool.name, parsed.data, scope);
        await tool.authorize?.(ctx, parsed.data);
        if (!addedConfirmation) return tool.handler(ctx, parsed.data);
        // 旧领域处理器无需感知协议门槛，避免确认字段混入业务patch和幂等正文。
        const { userConfirmed: _confirmed, ...businessArgs } = parsed.data;
        return tool.handler(ctx, businessArgs);
      },
    };
  });
}
