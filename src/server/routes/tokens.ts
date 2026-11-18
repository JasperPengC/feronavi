/** API 令牌路由（第六期 W2，REST 10 节 /api/v1/tokens） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as tokenService from "../services/token.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerTokenRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/tokens", async (req) => {
    const actor = actorOf(req);
    return tokenService.listTokens(actor);
  });

  /** 明文令牌**只在此响应里出现一次** */
  app.post("/api/v1/tokens", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      name: z.string().min(1).max(80),
      tier: z.enum(["READ_ONLY", "READ_WRITE", "ADMIN"]),
      projectWhitelist: z.array(z.string().uuid()).max(200).optional(),
      allowedIpCidrs: z.array(z.string().max(64)).max(50).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const created = await tokenService.createToken(actor, parsed.data);
    reply.status(201);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "token.created", targetType: "API_TOKEN",
        targetId: created.row.id, ip: req.ip,
      });
    }
    return created;
  });

  app.delete("/api/v1/tokens/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await tokenService.revokeToken(actor, id);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "token.revoked", targetType: "API_TOKEN", targetId: id, ip: req.ip,
      });
    }
    return { ok: true };
  });
}
