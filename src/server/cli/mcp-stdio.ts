/**
 * MCP stdio 入口（第六期 W6）
 *
 * 用途：本地 AI 客户端（Claude Desktop 等）直接拉起本进程，走 stdin/stdout 的 JSON-RPC，
 * 不需要 HTTP 端口。鉴权同样靠 API 令牌，从环境变量 `FERONAVI_TOKEN` 读。
 *
 * ⚠️ stdio 模式下 **stdout 属于协议**：任何调试输出都必须走 stderr，
 *    否则会污染 JSON-RPC 流导致客户端解析失败。
 */
import { bootstrapBusinessEffects } from "../application/bootstrap-business-effects.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "../mcp/server.ts";
import { authenticateToken } from "../services/token.service.ts";

const raw = process.env.FERONAVI_TOKEN ?? "";
if (!raw) {
  process.stderr.write("[feronavi-mcp] 缺少环境变量 FERONAVI_TOKEN（API 令牌，fero_ 开头）\n");
  process.exit(1);
}

const auth = await authenticateToken(raw, null);
if (!auth) {
  process.stderr.write("[feronavi-mcp] 令牌无效、已吊销或已过期\n");
  process.exit(1);
}

await bootstrapBusinessEffects();
const server = buildMcpServer({ actor: auth.actor, token: auth.ctx });
await server.connect(new StdioServerTransport());
process.stderr.write(`[feronavi-mcp] 已连接：${auth.actor.name}（档位 ${auth.ctx.tier}）\n`);
