/**
 * MCP 端点（第六期 W3，REST 第 11 节 /api/v1/mcp）
 *
 * ⚠️ 鉴权**只认 Bearer 令牌**，不适用 Cookie 会话（规范明示）。
 * 校验失败一律同一形状 401 —— 不区分「令牌不存在 / 已吊销 / 已过期 / IP 不符」。
 *
 * 为什么用 `reply.hijack()`：Streamable-HTTP 要自己接管响应流（可能是 SSE），
 * Fastify 不能再插手 —— 这正是当初选 Fastify 而非 Web 标准框架的原因。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import "../plugins-types.ts";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "../mcp/server.ts";
import { authenticateToken } from "../services/token.service.ts";
import type { Actor } from "../permission/actor.ts";
import { recordClientSeen } from "../services/mcp-client.service.ts";
import { getSettingRaw, putSettings } from "../services/setting.service.ts";
import { DomainError } from "../../shared/errors.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

function requireActor(req: { actor?: Actor }): Actor {
  if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
  return req.actor;
}


export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  /**
   * MCP 自动发现文档（上架/市场延后，但客户端可先发现本实例的 endpoint/协议）。
   * 只暴露公开元数据，不含令牌、工具权限或内部地址。
   */
  app.get("/.well-known/mcp.json", async (req) => {
    const configured = ((await getSettingRaw("mcp.publicUrl")) as string | null) ?? "";
    const origin = `${req.protocol}://${req.host}`;
    const url = configured || `${origin}/api/v1/mcp`;
    return {
      name: "feronavi",
      description: "Feronavi project delivery MCP server",
      transport: "streamable-http",
      url,
      authentication: { type: "bearer", tokenPrefix: "fero_" },
      docs: `${origin}/tokens`,
    };
  });

  /** MCP 自托管地址：Token 页生成客户端配置时使用；可配置为反代后的完整 endpoint。 */
  app.get("/api/v1/mcp/config", async () => ({
    url: ((await getSettingRaw("mcp.publicUrl")) as string | null) ?? "",
  }));

  app.put("/api/v1/mcp/config", { onRequest: app.csrfProtection }, async (req) => {
    const actor = requireActor(req);
    const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
    if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw new DomainError("FORBIDDEN", "无权修改 MCP 配置", null);
    const body = z.object({ url: z.string().max(2000) }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    const raw = body.data.url.trim();
    if (raw) {
      let parsed: URL;
      try { parsed = new URL(raw); } catch { throw new DomainError("VALIDATION", "MCP URL 不合法", null); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new DomainError("VALIDATION", "MCP URL 必须是 http/https", null);
    }
    await putSettings({ "mcp.publicUrl": raw });
    return { url: raw };
  });

  app.post("/api/v1/mcp", async (req, reply) => {
    const raw = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const auth = raw ? await authenticateToken(raw, req.ip ?? null) : null;
    if (!auth) {
      return reply.status(401).send({
        code: "FORBIDDEN",
        message: "令牌无效或不可用",
        details: null,
      });
    }

    // 无状态模式下 initialize 与后续调用不是同一个 Server 实例，`getClientVersion()` 拿不到；
    // 因此从 initialize 的 JSON-RPC 请求体直接读 clientInfo（观测失败不阻断业务）。
    const body = req.body as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } } | null;
    if (body?.method === "initialize" && body.params?.clientInfo) {
      void recordClientSeen(auth.ctx.tokenId, body.params.clientInfo.name ?? null, body.params.clientInfo.version ?? null)
        .catch(() => {});
    }

    // 交给 MCP transport 接管原始 req/res
    reply.hijack();
    const server = buildMcpServer({ actor: auth.actor, token: auth.ctx });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,        // 无状态
      enableJsonResponse: true,             // 直接 JSON 响应（本客户端集不需要 SSE 流）
    });
    reply.raw.on("close", () => { void server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  /** GET 用于 SSE 流式通道：本期无状态实现，明确拒绝而不是静默 405 */
  app.get("/api/v1/mcp", async (_req, reply) =>
    reply.status(405).send({
      code: "VALIDATION",
      message: "本实现在无状态模式下只接受 POST（JSON-RPC）",
      details: null,
    }));
}
