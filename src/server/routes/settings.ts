/** 设置读写 + SMTP 自检（第七期 C，REST 10 节） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError, forbidden } from "../../shared/errors.ts";
import * as settingService from "../services/setting.service.ts";
import * as mailService from "../services/mail.service.ts";
import type { Actor } from "../permission/actor.ts";
import { can, type PermissionContext } from "../permission/engine.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const assertManage = (actor: Actor): void => {
    const ctx: PermissionContext = { memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId };
    // 组织级动作：无项目资源 + 非 _own → 仍要求 ORG 档（第七期 A1 修法刻意不放宽）
    if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw forbidden();
  };

  app.get("/api/v1/settings", async (req) => {
    const actor = actorOf(req);
    assertManage(actor);
    return { settings: await settingService.listSettings() };
  });

  app.put("/api/v1/settings", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    assertManage(actor);
    const parsed = z.record(z.string(), z.unknown()).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const settings = await settingService.putSettings(parsed.data);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, action: "settings.updated", targetType: "SETTING",
        ip: req.ip,
      });
    }
    return { settings };
  });

  /** 附件存储测试：本地/ S3 均使用“已保存配置”，避免把未保存密钥发回前端 */
  app.post("/api/v1/settings/storage/test", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    assertManage(actor);
    const { testStorage } = await import("../services/storage.service.ts");
    return testStorage();
  });

  /** 向导第 5 步「SMTP 带测试」的落点：真连一次并投递测试信 */
  app.post("/api/v1/settings/smtp/test", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    assertManage(actor);
    const parsed = z.object({ to: z.string().email() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "需要提供收件邮箱 to", parsed.error.issues);
    const cfg = await mailService.loadMailConfig();
    if (!cfg) {
      // 未配置不是错误：如实告知，让界面显示"先去配置"
      return { ok: false, reason: "未配置 SMTP" };
    }
    const r = await mailService.sendMail({
      to: parsed.data.to,
      subject: "Feronavi SMTP 测试",
      text: mailService.templates.smtpTest(),
    });
    return { ok: r.ok, reason: r.reason ?? null, host: cfg.host, port: cfg.port };
  });
}
