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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DomainError } from "../../shared/errors.ts";
import { TOOLS, assertToolAllowed, type ToolCtx } from "./tools.ts";
import { WRITE_TOOLS } from "./write-tools.ts";
import { assertToolPolicyAllowed, recordToolCall } from "../services/mcp-client.service.ts";

/** 读 + 写工具全集（写工具在 READ_ONLY 档会被档位守卫拒绝） */
const ALL_TOOLS = [...TOOLS, ...WRITE_TOOLS];

export const SERVER_INFO = { name: "feronavi", version: "1.0.0" } as const;

/** 把领域错误转成稳定的信封（与 REST 同一形状：code / message / details） */
function toEnvelope(e: unknown): { code: string; message: string; details: unknown } {
  if (e instanceof DomainError) return { code: e.code, message: e.message, details: e.details };
  return { code: "INTERNAL", message: (e as Error)?.message ?? "内部错误", details: null };
}

export function buildMcpServer(ctx: ToolCtx): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

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
    try {
      assertToolAllowed(ctx, tool);
      // 调用计数/最后活跃（观测）+ 工具级策略 DENY 优先于令牌档位（A39）
      await recordToolCall(ctx.token.tokenId);
      await assertToolPolicyAllowed(ctx.token.tokenId, tool.name);
      const result = await tool.handler(ctx, (req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      // 权限拒绝不重试、按错误码分支 —— 规范护栏要求错误可被机器消费
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(toEnvelope(e)) }],
      };
    }
  });

  return server;
}

export { TOOLS, WRITE_TOOLS };
