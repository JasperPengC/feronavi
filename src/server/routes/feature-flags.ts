/** 功能开关端点（规范 8.3 / REST 11 节：GET 列表、PUT 单键 upsert；setting:manage） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as flagService from "../services/feature-flag.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerFeatureFlagRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const keyP = z.object({ key: z.string().min(2).max(100) });

  app.get("/api/v1/feature-flags", async (req) => {
    return { flags: await flagService.listFeatureFlags(actorOf(req)) };
  });

  app.put("/api/v1/feature-flags/:key", { onRequest: app.csrfProtection }, async (req) => {
    const parsedKey = keyP.safeParse(req.params);
    if (!parsedKey.success) throw new DomainError("VALIDATION", "开关 key 长度需为 2–100", parsedKey.error.issues);
    const { key } = parsedKey.data;
    const parsed = z.object({
      enabled: z.boolean(),
      config: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return flagService.setFeatureFlag(actorOf(req), key, parsed.data);
  });
}
