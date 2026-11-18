/** MCP 客户端与工具级策略端点（REST 11 节：GET 列表、PUT 策略；apikey:manage_any） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as mcpClients from "../services/mcp-client.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerMcpClientRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const idP = z.object({ id: z.string().uuid() });

  app.get("/api/v1/mcp-clients", async (req) => {
    return { clients: await mcpClients.listMcpClients(actorOf(req)) };
  });

  app.put("/api/v1/mcp-clients/:id/policy", { onRequest: app.csrfProtection }, async (req) => {
    const parsedId = idP.safeParse(req.params);
    if (!parsedId.success) throw new DomainError("VALIDATION", "客户端 id 不合法", parsedId.error.issues);
    const parsed = z.object({
      policies: z.array(z.object({
        toolName: z.string().min(1).max(100),
        effect: z.enum(mcpClients.MCP_POLICY_EFFECTS),
        argConstraints: z.record(z.string(), z.unknown()).optional(),
      })).max(200),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return { policies: await mcpClients.replaceClientPolicies(actorOf(req), parsedId.data.id, parsed.data.policies) };
  });
}
