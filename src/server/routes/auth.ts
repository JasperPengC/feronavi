/**
 * `/auth/*` 路由 —— **只做三件事**：解析入参、调服务、序列化响应。
 * 业务逻辑在 `services/auth.service.ts`，DB 在 `repos/`。
 *
 * ⚠️ CSRF 挂载纪律（第 5.10 节第 4 条硬规则）：
 *   `@fastify/csrf-protection` **按路由挂**（`onRequest: app.csrfProtection`），**绝不全局注册**
 *   —— 全局注册会让 MCP 端点的 POST 被拦截（MCP 客户端用 Bearer，但插件在进入路由前就校验）。
 *   本文件里只有「Cookie 会话的写端点」挂 CSRF；`/auth/login` 是公开端点，
 *   此时还没有会话 Cookie，挂上会导致永远登录不了。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import { z } from "zod";
import { loginSchema } from "../../shared/schemas/auth.ts";
import { SESSION_COOKIE } from "../auth/session.ts";
import { login, logout } from "../services/auth.service.ts";
import { loadActor } from "../auth/actor-loader.ts";
import { toDTO, type Actor } from "../permission/actor.ts";
import { verifySession, revokeAllSessions, revokeSessionById, listSessions } from "../auth/session.ts";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
    sessionToken?: string;
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest("actor", undefined);
  app.decorateRequest("sessionToken", undefined);

  /** 鉴权钩子：解析会话 → 装 Actor。挂在本插件作用域内，不影响 MCP 等 Bearer 路径 */
  app.addHook("preHandler", async (req: FastifyRequest) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return;
    const sess = await verifySession(token);
    if (!sess) return;
    const actor = await loadActor(sess.memberId);
    if (!actor) return;
    req.actor = actor;
    req.sessionToken = token;
    // 初始密码只可用于完成改密与管理登录会话；不能绕过前端直接访问业务 API。
    const route = req.routeOptions.url ?? "";
    const passwordSetupRoutes = new Set([
      "GET /api/v1/auth/me", "GET /api/v1/auth/csrf", "GET /api/v1/auth/sessions",
      "POST /api/v1/auth/password/change", "POST /api/v1/auth/logout", "POST /api/v1/auth/logout-all",
      "DELETE /api/v1/auth/sessions/:id",
    ]);
    if (actor.mustChangePassword && route.startsWith("/api/") && !passwordSetupRoutes.has(`${req.method} ${route}`)) {
      throw new DomainError("FORBIDDEN", "请先修改初始密码", { mustChangePassword: true });
    }
  });

  function requireActor(req: FastifyRequest): Actor {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  }

  // ── 登录（公开，不挂 CSRF）──────────────────────────────────
  app.post("/api/v1/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "登录参数不合法", parsed.error.issues);

    const { token, expiresAt } = await login(parsed.data, {
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    });

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,                       // 防 JS 读取（XSS 窃取）
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",                      // 挡住绝大多数跨站表单/图片请求
      path: "/",
      expires: expiresAt,
    });

    /**
     * 双提交令牌（第 5.10 节第 2 层）：登录时同时种下 CSRF token。
     *
     * ⚠️ 这个 Cookie 必须 `httpOnly: false` —— 前端要读它放进 `X-CSRF-Token` 头，
     *    这正是双提交模式的设计（token 不是秘密，攻击者读不到**他人的** Cookie 才是关键）。
     *    会话 Cookie 则必须 `httpOnly: true`，两者用途不同，不要搞混。
     */
    const csrfToken = await reply.generateCsrf();
    reply.setCookie("csrf_token", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return { ok: true, csrfToken };
  });

  // ── LDAP / AD 登录（公开，不挂 CSRF；由 login-guard 限流）────────
  app.post("/api/v1/auth/ldap/login", async (req, reply) => {
    const parsed = z.object({
      idpId: z.string().uuid(),
      username: z.string().min(1).max(200),
      password: z.string().min(1).max(500),
      totpCode: z.string().max(20).optional(),
      recoveryCode: z.string().max(64).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "登录参数不合法", parsed.error.issues);

    const { loginLdap } = await import("../services/ldap.service.ts");
    const { memberId } = await loginLdap(parsed.data, {
      ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    });
    const { createSession } = await import("../auth/session.ts");
    const { token, expiresAt } = await createSession({
      memberId, remember: false, userAgent: req.headers["user-agent"] ?? null, ip: req.ip,
    });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
    });
    const csrfToken = await reply.generateCsrf();
    reply.setCookie("csrf_token", csrfToken, {
      httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
    });
    return { ok: true, csrfToken };
  });

  // ── 登出（Cookie 会话的写端点 → 挂 CSRF）────────────────────
  app.post("/api/v1/auth/logout", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = req.actor;   // 登出前先留身份，用于安全审计
    await logout(req.sessionToken);
    if (actor) {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, actorSnapshot: actor.username,
        action: "auth.logout", targetType: "MEMBER", targetId: actor.memberId, ip: req.ip,
      });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/v1/auth/logout-all", { onRequest: app.csrfProtection }, async (req) => {
    const actor = requireActor(req);
    const revoked = await revokeAllSessions(actor.memberId);
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, actorSnapshot: actor.username,
        action: "auth.logout_all", targetType: "MEMBER", targetId: actor.memberId, ip: req.ip,
      });
    }
    return { ok: true, revoked };
  });

  // ── 当前身份（身份 + 权限集 + 数据范围）──────────────────────
  app.get("/api/v1/auth/me", async (req) => toDTO(requireActor(req)));

  /**
   * 刷新 CSRF 双提交令牌。
   *
   * 场景：服务重启后 `@fastify/csrf-protection` 会换签名密钥，浏览器里旧 token 立刻失效，
   * 用户会看到“CSRF 校验失败”，但会话本身仍然有效。前端收到此类 403 时调用本端点换 token
   * 并重试一次，避免让用户重新登录。
   */
  app.get("/api/v1/auth/csrf", async (req, reply) => {
    requireActor(req);
    const token = await reply.generateCsrf();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    reply.setCookie("csrf_token", token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires,
    });
    return { csrfToken: token };
  });

  // ── 会话管理 ───────────────────────────────────────────────
  app.get("/api/v1/auth/sessions", async (req) => listSessions(requireActor(req).memberId));

  app.delete("/api/v1/auth/sessions/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    // 撤销别人的会话与撤销不存在的会话返回**同一种**错误，否则可探测 session 是否存在
    const ok = await revokeSessionById(actor.memberId, id);
    if (!ok) throw forbidden();
    {
      const { writeSecurityAudit } = await import("../services/audit.service.ts");
      await writeSecurityAudit({
        actorId: actor.memberId, actorSnapshot: actor.username,
        action: "auth.session_revoked", targetType: "SESSION", targetId: id, ip: req.ip,
      });
    }
    return { ok: true };
  });

  /**
   * 自助找回（第七期 D3，REST 2 节）。
   *
   * 两条纪律：
   *   1 响应**恒为 ok**（账号存在与否同形）—— 否则可以拿来枚举账号
   *   2 未配 SMTP 时明确说"未启用自助找回"并指引联系管理员
   *      （规范 5.11：向导允许跳过 SMTP，必须有非邮件兜底，不能把用户锁死）
   */
  app.post("/api/v1/auth/password/forgot", async (req) => {
    const parsed = z.object({ identifier: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "请输入用户名或邮箱", parsed.error.issues);

    const { loadMailConfig, templates } = await import("../services/mail.service.ts");
    const cfg = await loadMailConfig();
    if (!cfg) {
      return { ok: false, enabled: false, message: "本实例未启用自助找回，请联系管理员重置密码" };
    }

    const { findMemberByUserOrEmail, issueResetToken } = await import("../services/password-reset.service.ts");
    const m = await findMemberByUserOrEmail(parsed.data.identifier);
    // 只对 ACTIVE 账号发信（禁用/匿名化不发），但响应形状不变 —— 否则可枚举账号状态
    if (m && m.status === "ACTIVE" && m.email) {
      const { token } = await issueResetToken({ memberId: m.id, issuedByMemberId: null });
      const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
      const host = (req.headers.host as string) ?? "localhost:3000";
      // 发信走通用任务队列（可重试；PG 为真相源），HTTP 响应不等 SMTP
      const { enqueue } = await import("../services/job.service.ts");
      await enqueue({
        kind: "email.send",
        payload: {
          to: m.email,
          subject: "Feronavi 密码重置",
          text: templates.passwordReset(`${proto}://${host}/reset?token=${token}`),
        },
        dedupeKey: `password-reset:${m.id}:${token}`,
        maxAttempts: 5,
      });
    }
    return { ok: true, enabled: true };
  });

  // 注：`/auth/password/change` 与 `/auth/password/reset` 已在 routes/members.ts 实现
}
