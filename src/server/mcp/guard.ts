/** 所有工具共享的运行时输入校验和令牌资源范围守卫。 */
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { DomainError } from "../../shared/errors.ts";
import { projectAllowed, tierAllows } from "../services/token.service.ts";
import { projectForMcpResource, type McpResourceKind } from "../services/mcp-resource.service.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";

const validator = new AjvJsonSchemaValidator();
// 这些工具没有可归属到项目的资源。全账号内容只允许不限制项目的令牌访问。
const identityTools = new Set(["ping", "whoami", "project.list", "meta.fields", "notification.setPrefs"]);
const accountTools = new Set(["notification.list", "notification.markRead", "announcement.send", "announcement.revoke"]);
const resources: Record<string, McpResourceKind> = {
  workItemId: "workItem", fromWorkItemId: "workItem", toWorkItemId: "workItem",
  pageId: "page", ideaId: "idea", milestoneId: "milestone", iterationId: "iteration",
  releaseId: "release", moduleId: "module", commentId: "comment", approvalId: "approval",
};
const parents: Record<string, McpResourceKind> = {
  "workitem.create": "workItem", "workitem.comment": "comment", "page.create": "page", "plan.createModule": "module",
};

async function assertTokenScope(ctx: ToolCtx, tool: ToolDef, args: Record<string, unknown>): Promise<void> {
  if (identityTools.has(tool.name)) return;
  if (accountTools.has(tool.name)) {
    if (!projectAllowed(ctx.token, null)) throw new DomainError("FORBIDDEN", "此工具需要未限制项目的令牌", null);
    return;
  }
  let scoped = false;
  if (typeof args.projectId === "string") {
    scoped = true;
    if (!projectAllowed(ctx.token, args.projectId)) throw new DomainError("NOT_FOUND", "资源不存在", null);
  }
  for (const [key, value] of Object.entries(args)) {
    const kind = key === "parentId" ? parents[tool.name] : resources[key];
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
    const validate = validator.getValidator<Record<string, unknown>>(tool.inputSchema);
    return {
      ...tool,
      handler: async (ctx, args) => {
        const parsed = validate(args);
        if (!parsed.valid) throw new DomainError("VALIDATION", "工具参数不合法", { reason: parsed.errorMessage });
        if (!tierAllows(ctx.token, tool.kind)) throw new DomainError("FORBIDDEN", "当前令牌档位不允许该操作", null);
        await assertTokenScope(ctx, tool, parsed.data);
        return tool.handler(ctx, parsed.data);
      },
    };
  });
}
