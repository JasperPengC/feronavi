/** 双因素端点（第十四期，REST 2 节；全部「仅本人」） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as tfa from "../services/two-factor.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerTwoFactorRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/auth/2fa", async (req) => tfa.state(actorOf(req).memberId));

  /** 生成密钥：明文只在此响应出现一次（含 otpauth 链接与恢复码） */
  app.post("/api/v1/auth/2fa/setup", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    return tfa.setup(actor.memberId, { account: actor.username });
  });

  /** 校验一次动态码后激活 */
  app.post("/api/v1/auth/2fa/activate", { onRequest: app.csrfProtection }, async (req) => {
    const parsed = z.object({ code: z.string().min(6).max(8) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const actor = actorOf(req);
    const r = await tfa.activate(actor.memberId, parsed.data.code);
    if (!r.alreadyActive) {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "auth.2fa_enabled", targetType: "MEMBER", targetId: actor.memberId, ip: req.ip,
      });
    }
    return r;
  });

  /** 关闭：**必须重新验证密码**（否则拿到会话就能悄悄关掉二因子） */
  app.delete("/api/v1/auth/2fa", { onRequest: app.csrfProtection }, async (req) => {
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "需要提供当前密码", parsed.error.issues);
    const actor = actorOf(req);
    const r = await tfa.disable(actor.memberId, parsed.data.password);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "auth.2fa_disabled", targetType: "MEMBER", targetId: actor.memberId, ip: req.ip,
      });
    }
    return r;
  });

  /** 重新生成恢复码（只展示一次，旧码立即失效） */
  app.post("/api/v1/auth/2fa/recovery-codes", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const result = await tfa.regenerateRecoveryCodes(actor.memberId);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "auth.2fa_recovery_regenerated",
        targetType: "MEMBER", targetId: actor.memberId, ip: req.ip,
      });
    }
    return result;
  });
}
