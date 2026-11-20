/** 从实际注册表生成能力发现与可执行闭环指引，避免手工维护能力清单。 */
import { z } from "zod";
import { annotationsFor, outputSchemaFor } from "../tool-contracts.ts";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { businessTool as tool, id } from "./business-tool.ts";
import { tierAllows } from "../../services/token.service.ts";
import { assertToolPolicyAllowed } from "../../services/mcp-client.service.ts";
import { DomainError } from "../../../shared/errors.ts";

import { BUSINESS_WORKFLOWS } from "./business-workflows.ts";
export { BUSINESS_WORKFLOWS } from "./business-workflows.ts";

async function available(ctx: ToolCtx, definition: ToolDef) {
  if (!tierAllows(ctx.token, definition.kind)) return { available: false, reason: "token_tier" };
  if ((definition.scope === "account" || definition.scope === "personal" || ["announcement.send", "announcement.revoke", "notification.list", "notification.markRead"].includes(definition.name)) && ctx.token.projectWhitelist.length) return { available: false, reason: "unrestricted_token_required" };
  try { await assertToolPolicyAllowed(ctx.token.tokenId, definition.name); }
  catch (error) { if (error instanceof DomainError) return { available: false, reason: "tool_policy" }; throw error; }
  return { available: true, reason: "subject_to_resource_and_actor_permissions" };
}

export function intelligenceTools(registry: () => ToolDef[]): ToolDef[] {
  const invoke = async (ctx: ToolCtx, name: string, args: Record<string, unknown>) => {
    const definition = registry().find((entry) => entry.name === name);
    if (!definition) throw new DomainError("NOT_FOUND", "工具不存在", null);
    await assertToolPolicyAllowed(ctx.token.tokenId, name);
    return definition.handler(ctx, args);
  };
  return [
    tool("meta.capabilities", "冷启动能力发现：当前工具、风险、令牌限制和业务闭环步骤。先查此项再规划任务；available 不代替实际资源权限。", "read", {}, async (ctx) => {
      const definitions = registry();
      const tools = await Promise.all(definitions.map(async (entry) => ({ name: entry.name, description: entry.description, kind: entry.kind, scope: entry.scope ?? "project_or_resource", confirmationRequired: annotationsFor(entry).destructiveHint, idempotentWithoutKey: annotationsFor(entry).idempotentHint, idempotencyKey: !!(entry.inputSchema.properties as Record<string, unknown> | undefined)?.idempotencyKey, ...(await available(ctx, entry)) })));
      const names = new Set(definitions.map((entry) => entry.name));
      return {
        toolCount: tools.length, tools,
        workflows: BUSINESS_WORKFLOWS.map((flow) => ({ ...flow, missingTools: flow.steps.filter((name) => !names.has(name)) })),
        completionRule: "读取真实上下文和当前版本；执行合法操作；对写入结果复读；未完成项和错误必须如实报告。",
        boundaries: {
          humanAuthentication: "登录、密码、2FA、SSO、API密钥设置及需二次身份验证的操作保留人工身份验证入口，不得代取凭据。",
          systemMaintenance: "安装、整库恢复、升级、存储及安全密钥等系统管理保留专门管理入口，MCP不绕过人工身份校验。",
          asynchronous: "跨进程等待审批或后台任务须主动复读状态；无进度流、取消或断点恢复协议。",
          protocol: "静态Bearer认证、无状态HTTP POST与stdio；不提供OAuth/DCR和GET SSE。",
        },
      };
    }, { scope: "identity" }),
    tool("meta.tool", "读取工具精确输入/输出契约和调用前提；不猜字段，不添加未声明参数。", "read", { name: z.string().min(1).max(120) }, async (ctx, args) => {
      const entry = registry().find((definition) => definition.name === args.name);
      if (!entry) throw new DomainError("NOT_FOUND", "工具不存在", null);
      return { name: entry.name, description: entry.description, kind: entry.kind, inputSchema: entry.inputSchema, outputSchema: outputSchemaFor(entry), ...(await available(ctx, entry)) };
    }, { scope: "identity" }),
    tool("project.context", "一次读取项目执行上下文：详情、成员、工作流、字段、计划与前20项任务。每一部分遵守独立工具策略；被拒部分明确标记。", "read", { projectId: id }, async (ctx, args) => {
      const result: Record<string, unknown> = { projectId: args.projectId };
      const sections = [
        ["project", "project.get"], ["members", "project.members"], ["workflows", "meta.workflow"],
        ["fields", "meta.fields"], ["customFields", "customField.definitions"], ["iterations", "plan.listIterations"],
        ["milestones", "plan.listMilestones"], ["releases", "plan.listReleases"], ["modules", "plan.listModules"], ["workItems", "workitem.list"],
      ];
      // 先验证项目，不以其他区段的降级掩盖项目不可见。
      result.project = await invoke(ctx, "project.get", args);
      for (const [section, name] of sections.slice(1)) {
        try { result[section!] = await invoke(ctx, name!, name === "meta.fields" ? {} : name === "workitem.list" ? { ...args, pageSize: 20 } : args); }
        catch (error) {
          if (!(error instanceof DomainError)) throw error;
          result[section!] = { unavailable: true, code: error.code, tool: name };
        }
      }
      return result;
    }),
  ];
}

export function errorRecovery(code: string, toolName: string) {
  if (code === "VERSION_CONFLICT") return { retryable: true, action: "reread_and_merge", tools: [toolName.startsWith("page.") ? "page.get" : "workitem.get"], instruction: "重新读取当前版本，合并用户意图；使用最新版本重试，不覆盖其他人修改。" };
  if (code === "VALIDATION") return { retryable: false, action: "correct_arguments", tools: ["meta.tool", "meta.fields"], instruction: "按工具schema与details修正参数后再提交，禁止盲目重试。" };
  if (code === "FORBIDDEN" || code === "NOT_FOUND") return { retryable: false, action: "stop_and_request_access", tools: [], instruction: "停止对该资源的操作；不猜ID、不换工具绕过权限；报告所需授权。" };
  if (code === "BLOCKED_BY_PREREQUISITE") return { retryable: false, action: "resolve_prerequisites", tools: ["meta.workflow", "workitem.get", "approval.list"], instruction: "读取必填字段、依赖和审批状态，满足前提或等待人工审批后重新读取。" };
  if (code === "RATE_LIMITED") return { retryable: true, action: "backoff", tools: [], instruction: "遵循服务端重试提示退避；写入重试必须保留同一幂等键。" };
  return { retryable: false, action: "inspect_and_report", tools: [], instruction: "读取当前状态确认部分执行结果；报告错误，禁止自动重放未知写入。" };
}
