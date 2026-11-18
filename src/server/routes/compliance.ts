/** RAG 合规留痕 · Skill · 研发活跃度端点（第十三期收口） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as compliance from "../services/compliance.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerComplianceRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const idP = z.object({ id: z.string().uuid() });

  // ── RAG 同意记录（记录位，不是门禁）──
  app.post("/api/v1/ai/rag/consent", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      providerConfigId: z.string().uuid(),
      purposeTextSnapshot: z.string().min(1).max(5000),
      crossBorder: z.boolean(),
      // 可选记录位：平台不校验取值（A35）
      crossBorderPath: z.string().max(200).nullable().optional(),
      piaRecord: z.record(z.string(), z.unknown()).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return compliance.recordConsent(actorOf(req), parsed.data);
  });

  app.get("/api/v1/ai/rag/consent", async (req) => {
    const q = req.query as { all?: string };
    return { consents: await compliance.listConsents(actorOf(req), { all: q.all === "true" }) };
  });

  app.post("/api/v1/ai/rag/consent/:id/revoke", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    return compliance.revokeConsent(actorOf(req), id);
  });

  /** 个人数据导出（数据可携带权，规范 2.6）：**只导出本人** —— 不接受 memberId 参数 */
  app.get("/api/v1/me/data-export", async (req, reply) => {
    const actor = actorOf(req);
    const { exportMemberData, EXPORT_SCHEMA_VERSION } = await import("../services/data-export.service.ts");
    const data = await exportMemberData(actor.memberId);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", "attachment; filename=\"feronavi-my-data.json\"")
      .header("x-schema-version", EXPORT_SCHEMA_VERSION)
      .send(JSON.stringify(data, null, 2));
  });

  /** 异步全量导出（Round 46）：POST 入队 → GET /system/exports/:id 下载（权限均 setting:manage） */
  app.post("/api/v1/system/exports", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { can } = await import("../permission/engine.ts");
    const ctx = { memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>(), memberId: actor.memberId };
    if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    const { enqueue } = await import("../services/job.service.ts");
    const jobRow = await enqueue({
      kind: "export.full",
      payload: { requestedBy: actor.memberId },
      dedupeKey: `export.full:${actor.memberId}`,
      maxAttempts: 2,
    });
    reply.status(201);
    return { id: jobRow?.id ?? null, status: jobRow?.status ?? "PENDING" };
  });

  app.get("/api/v1/system/exports/:id", async (req, reply) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { can } = await import("../permission/engine.ts");
    const ctx = { memberProjectIds: new Set<string>(), memberTeamIds: new Set<string>(), memberId: actor.memberId };
    if (!can(actor, "setting:manage", { projectId: null, teamId: null }, ctx)) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    const { listJobs } = await import("../services/job.service.ts");
    const jobRow = (await listJobs(1000)).find((j) => j.id === id && j.kind === "export.full");
    if (!jobRow) throw new DomainError("FORBIDDEN", "无权访问该资源", null);
    if (jobRow.status === "PENDING" || jobRow.status === "RUNNING") {
      throw new DomainError("CONFLICT", "导出包生成中，请稍后再试", { status: jobRow.status });
    }
    if (jobRow.status !== "SUCCEEDED") {
      throw new DomainError("CONFLICT", "导出包生成失败", { lastError: jobRow.lastError });
    }
    const { readFullExportPackage } = await import("../services/full-export.service.ts");
    const buf = await readFullExportPackage(id);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="feronavi-full-export-${id}.json"`)
      .header("x-schema-version", "1")
      .header("x-export-mode", "async")
      .send(buf);
  });

  /** 全量数据导出（setting:manage；同步 JSON，响应头标注 schemaVersion 与导出模式） */
  app.get("/api/v1/system/exports/inline", async (req, reply) => {
    const actor = actorOf(req);
    const { fullExport, FULL_EXPORT_SCHEMA_VERSION } = await import("../services/full-export.service.ts");
    const data = await fullExport(actor);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", "attachment; filename=\"feronavi-full-export.json\"")
      .header("x-schema-version", FULL_EXPORT_SCHEMA_VERSION)
      .header("x-export-mode", "inline")
      .send(JSON.stringify(data));
  });

  /** 项目 PDF 报告（P5：导出之一）。只放可核对数字，见 report.service 的说明 */
  app.get("/api/v1/projects/:id/report.pdf", async (req, reply) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { projectReport } = await import("../services/report.service.ts");
    const { buffer, filename } = await projectReport(actor, id);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(buffer);
  });

  // ── SSO（第十四期：本轮为配置 + 发现 + 授权请求）──
  app.get("/api/v1/auth/sso/providers", async () => ({ providers: await (await import("../services/sso.service.ts")).publicIdpList() }));

  app.get("/api/v1/settings/idp", async (req) => ({
    idps: await (await import("../services/sso.service.ts")).listIdps(actorOf(req)),
  }));

  app.post("/api/v1/settings/idp", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      id: z.string().uuid().optional(),
      kind: z.enum(["OIDC", "LDAP"]),
      issuer: z.string().url().max(2000),
      clientId: z.string().min(1).max(300),
      clientSecret: z.string().max(500).nullable().optional(),
      autoProvision: z.boolean().optional(),
      enabled: z.boolean().optional(),
      allowedEmailDomains: z.string().max(500).nullable().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(parsed.data.id ? 200 : 201);
    return (await import("../services/sso.service.ts")).upsertIdp(actorOf(req), parsed.data);
  });

  /** 管理端 LDAP 连接测试：服务账号 bind + base DN 搜索 */
  app.post("/api/v1/settings/idp/:id/test", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return (await import("../services/ldap.service.ts")).testLdap(actorOf(req), id);
  });

  /** 登录页：只暴露启用中的 LDAP 源（不泄露地址/baseDn） */
  app.get("/api/v1/auth/ldap/providers", async () => {
    const { db } = await import("../../db/index.ts");
    const { idpConfig } = await import("../../db/schema.ts");
    const { and, eq } = await import("drizzle-orm");
    const rows = await db.select({ id: idpConfig.id, label: idpConfig.issuer }).from(idpConfig)
      .where(and(eq(idpConfig.kind, "LDAP"), eq(idpConfig.enabled, true)));
    return { providers: rows.map((r) => ({ id: r.id, label: r.label.replace(/^ldaps?:\/\//, "") })) };
  });

  /**
   * 发起 SSO 登录：返回授权 URL（state/nonce/PKCE 由服务端生成并落库）。
   *
   * ⚠️ **不能挂 csrfProtection**：这是登录前端点，匿名访客没有会话也没有 csrf cookie ——
   * 挂了 CSRF 会让"登录页点企业登录"永远 403（本会话真实踩到并用浏览器验收发现）。
   * 该端点的安全边界由 OAuth 的 `state`（一次性、落库、绑定 redirectUri）承担，不是 CSRF token。
   */
  app.post("/api/v1/auth/sso/:id/start", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { redirectUri } = z.object({ redirectUri: z.string().url().max(2000) }).parse(req.body ?? {});
    return (await import("../services/sso.service.ts")).startLogin(req.actor ?? null, id, redirectUri);
  });

  /**
   * SSO 回调：兑换授权码 → 校验 ID Token → 绑定或建号 → **种会话 Cookie**（与密码登录同一套）。
   * 失败一律重定向到登录页并带 `sso_error`，**不在 URL 里泄露具体原因**（原因只进服务端日志）。
   */
  app.get("/api/v1/auth/sso/callback", async (req, reply) => {
    const q = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ code: "VALIDATION", message: "缺少 code 或 state", details: null });
    try {
      const { completeLogin } = await import("../services/sso.service.ts");
      const { memberId } = await completeLogin({ state: q.data.state, code: q.data.code });
      const { createSession, SESSION_COOKIE } = await import("../auth/session.ts");
      const { token, expiresAt } = await createSession({ memberId, remember: false, userAgent: req.headers["user-agent"] ?? null, ip: req.ip });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
      });
      const csrfToken = await reply.generateCsrf();
      reply.setCookie("csrf_token", csrfToken, {
        httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
      });
      return reply.redirect("/", 302);
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, "SSO 登录失败");
      return reply.redirect("/login?sso_error=1", 302);
    }
  });

  /**
   * 群发公告（规范 8.5 的三个端点）。**最高风险写操作**：
   * 权限由服务层判（`notification:send`），撤回复用「仅限发送人本人」的规则。
   */
  app.get("/api/v1/announcements", async (req) => {
    const q = req.query as { includeRevoked?: string };
    const { listAnnouncements } = await import("../services/announcement.service.ts");
    return { announcements: await listAnnouncements(actorOf(req), { includeRevoked: q.includeRevoked === "true" }) };
  });

  app.post("/api/v1/announcements", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      title: z.string().min(1).max(300),
      body: z.string().min(1).max(20_000),
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
      audience: z.object({
        roleKeys: z.array(z.string().max(60)).max(50).optional(),
        teamIds: z.array(z.string().uuid()).max(200).optional(),
      }).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { sendAnnouncement } = await import("../services/announcement.service.ts");
    reply.status(201);
    return sendAnnouncement(actorOf(req), parsed.data);
  });

  app.post("/api/v1/announcements/:id/revoke", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { revokeAnnouncement } = await import("../services/announcement.service.ts");
    return revokeAnnouncement(actorOf(req), id);
  });

  // ── Skill ──
  app.get("/api/v1/skills", async (req) => {
    const q = req.query as { enabled?: string };
    return { skills: await compliance.listSkills(actorOf(req), { onlyEnabled: q.enabled === "true" }) };
  });

  app.post("/api/v1/skills", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1).max(120),
      manifest: z.record(z.string(), z.unknown()).optional(),
      appliesTo: z.string().max(120).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return compliance.createSkill(actorOf(req), parsed.data);
  });

  app.patch("/api/v1/skills/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(120).optional(),
      manifest: z.record(z.string(), z.unknown()).optional(),
      enabled: z.boolean().optional(),
      appliesTo: z.string().max(120).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return compliance.updateSkill(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/skills/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await compliance.deleteSkill(actorOf(req), id);
    return { ok: true };
  });

  // ── 研发活跃度 ──
  /** 集成方写入：批量 upsert 日活跃度（integration:manage；整批一个事务） */
  app.post("/api/v1/dev-activity", { onRequest: app.csrfProtection }, async (req, reply) => {
    const parsed = z.object({
      rows: z.array(z.object({
        memberId: z.string().uuid().optional(),
        username: z.string().min(1).max(64).optional(),
        date: z.string().max(10),
        commits: z.number().int().min(0).max(1_000_000).optional(),
        prs: z.number().int().min(0).max(1_000_000).optional(),
        reviews: z.number().int().min(0).max(1_000_000).optional(),
      })).min(1).max(500),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return compliance.ingestDevActivity(actorOf(req), parsed.data.rows);
  });

  app.get("/api/v1/projects/:id/dev-activity", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = req.query as { from?: string; to?: string };
    return compliance.projectDevActivity(actor, id, { from: q.from, to: q.to });
  });
}
