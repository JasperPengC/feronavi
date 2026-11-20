/**
 * MCP 服务端（第六期 W3/W5，规范 4.9 节）
 *
 * 形态：
 *   - **Streamable-HTTP**：`POST /api/v1/mcp`，鉴权 `Authorization: Bearer <API 令牌>`
 *   - **stdio**：同一注册表，独立进程入口（bin 脚本）
 *
 * 为什么能这么薄：REST 与 MCP 共用同一 service 层（第 4.1 节纪律 1），
 * 工具只做参数映射与守卫 —— 这里没有一条业务查询。
 *
 * 会话：本期**无状态**（不带 Mcp-Session-Id），每个请求新建 Server 实例；
 * 规范未要求 MCP 会话保持，SSE 推送走已有的 /api/v1/events。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DomainError } from "../../shared/errors.ts";
import { TOOLS, ALL_TOOLS, assertToolAllowed, type ToolCtx } from "./tools.ts";
import { WRITE_TOOLS } from "./write-tools.ts";
import { describeTool } from "./contracts.ts";
import { assertToolPolicyAllowed, recordToolCall } from "../services/mcp-client.service.ts";

/** 读 + 写工具全集（写工具在 READ_ONLY 档会被档位守卫拒绝） */
const TOOL_CATALOG = ALL_TOOLS.map(describeTool);
const validator = new AjvJsonSchemaValidator();
const outputValidators = new Map(TOOL_CATALOG.map(tool => [tool.name,
  validator.getValidator<Record<string, unknown>>(tool.outputSchema!),
]));

export const SERVER_INFO = { name: "feronavi", version: "1.0.0" } as const;

const RESOURCES = [
  {
    uri: "feronavi://guide/business-workflows",
    name: "business-workflows",
    title: "业务流程与 Agent 边界",
    description: "Feronavi 查询、写入确认、权限校验与写后回读的闭环指南。",
    mimeType: "text/markdown",
  },
  {
    uri: "feronavi://catalog/tools",
    name: "mcp-tool-catalog",
    title: "MCP 工具目录",
    description: "当前实例公开的 MCP 工具、读写属性与输入契约目录。",
    mimeType: "application/json",
  },
] as const;

const PROMPTS = [
  {
    name: "analyze-project",
    title: "项目分析",
    description: "在指定项目范围内汇总进度、风险、里程碑与待办，并标注数据来源。",
    arguments: [
      { name: "projectScope", description: "项目名称、项目 ID 或跨项目范围", required: true },
      { name: "question", description: "希望分析的问题", required: true },
    ],
  },
  {
    name: "deliver-work-item",
    title: "工作项交付",
    description: "按确认后执行的规则规划、创建或流转工作项，并在写入后回读核验。",
    arguments: [
      { name: "projectScope", description: "项目名称或项目 ID", required: true },
      { name: "request", description: "用户提出的交付请求", required: true },
    ],
  },
  {
    name: "knowledge-grounded-answer",
    title: "知识库检索回答",
    description: "限定知识范围检索后回答，区分已知事实、推断与缺失资料。",
    arguments: [
      { name: "scope", description: "跨项目或指定项目范围", required: true },
      { name: "question", description: "需要回答的问题", required: true },
    ],
  },
] as const;

const BUSINESS_WORKFLOW_GUIDE = `# Feronavi Agent 业务闭环\n\n- 先用只读工具查询当前账号可见的数据、项目白名单与业务前置条件。\n- 任何业务写入都必须先向用户展示目标、字段、影响范围和调用的工具，获得明确确认后再执行。\n- 写入成功后必须用对应的读取工具或 REST 回读结果，核对 ID、版本、状态和关键字段；遇到超时先查询确认，不盲目重试。\n- 令牌档位、项目白名单、工具级 DENY 和业务权限会在每次调用时重新检查，不能用提示词或缓存绕过。\n- 涉及页面协作、附件、导入和 MCP 命令时，完成后要检查对应的业务事件、版本或审计记录。\n`;

/** 把领域错误转成稳定的信封（与 REST 同一形状：code / message / details） */
function toEnvelope(e: unknown): { code: string; message: string; details: unknown } {
  if (e instanceof DomainError) return { code: e.code, message: e.message, details: e.details };
  return { code: "INTERNAL", message: (e as Error)?.message ?? "内部错误", details: null };
}

export interface McpCallMetric { tokenId: string; toolName: string; success: boolean; durationMs: number; errorCode?: string }

export function buildMcpServer(ctx: ToolCtx, observeCall?: (metric: McpCallMetric) => void): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {}, prompts: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_CATALOG,
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const resource = RESOURCES.find((item) => item.uri === req.params.uri);
    if (!resource) throw new Error(`资源「${req.params.uri}」不存在`);
    const text = resource.uri === "feronavi://guide/business-workflows"
      ? BUSINESS_WORKFLOW_GUIDE
      : JSON.stringify({ generatedAt: new Date().toISOString(), tools: TOOL_CATALOG }, null, 2);
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = PROMPTS.find((item) => item.name === req.params.name);
    if (!prompt) throw new Error(`提示词「${req.params.name}」不存在`);
    const args = req.params.arguments ?? {};
    const scope = args.projectScope ?? args.scope ?? "当前账号可见范围";
    const request = args.request ?? args.question ?? "请给出当前范围的结构化分析";
    const text = prompt.name === "deliver-work-item"
      ? `工作范围：${scope}\n用户请求：${request}\n\n请先读取当前数据和可用迁移边，列出准备执行的工具、字段、影响范围和风险，等待用户明确确认后再写入。写入后必须回读结果并报告 ID、版本和最终状态。`
      : `工作范围：${scope}\n用户问题：${request}\n\n请先使用只读工具获取事实，标注数据来源和时间。没有足够证据时明确说明缺口，不要臆测；如需写入，先给出操作预览并等待确认。`;
    return { description: prompt.description, messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (!tool) {
      // 未注册的工具名：明确拒绝，不静默。
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            code: "NOT_FOUND",
            message: `工具「${name}」不存在或未在本版本开放`,
            details: null,
          }),
        }],
      };
    }
    const startedAt = performance.now();
    let success = false;
    let errorCode: string | undefined;
    try {
      assertToolAllowed(ctx, tool);
      // 调用计数/最后活跃（观测）+ 工具级策略 DENY 优先于令牌档位（A39）
      await recordToolCall(ctx.token.tokenId);
      await assertToolPolicyAllowed(ctx.token.tokenId, tool.name);
      const result = await tool.handler(ctx, (req.params.arguments ?? {}) as Record<string, unknown>);
      const text = JSON.stringify(result, null, 2);
      const structuredContent = JSON.parse(text) as Record<string, unknown>;
      const parsed = outputValidators.get(tool.name)!(structuredContent);
      if (!parsed.valid) throw new DomainError("INTERNAL", "工具结果不符合输出契约", { tool: tool.name });
      success = true;
      return { content: [{ type: "text" as const, text }], structuredContent };
    } catch (e) {
      errorCode = e instanceof DomainError ? e.code : "INTERNAL";
      // 权限拒绝不重试、按错误码分支 —— 规范护栏要求错误可被机器消费
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(toEnvelope(e)) }],
      };
    } finally {
      try { observeCall?.({ tokenId: ctx.token.tokenId, toolName: tool.name, success, durationMs: Math.max(0, Math.round(performance.now() - startedAt)), ...(errorCode ? { errorCode } : {}) }); } catch { /* 观测不能影响业务结果。 */ }
    }
  });

  return server;
}

export { TOOLS, WRITE_TOOLS };
