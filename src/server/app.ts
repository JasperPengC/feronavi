/**
 * Fastify 应用装配
 *
 * 三件事同进程（第 4.1 节）：REST API、MCP 端点、SPA 静态文件。
 * 选 Fastify 而非 Next.js 的原因见 A46 修订 —— MCP 的 Streamable-HTTP
 * transport 需要真实 Node `req`/`res`，Next.js Route Handler 只给 Web 标准对象。
 */
import Fastify, { type FastifyInstance } from "fastify";
import "./plugins-types.ts";
import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DomainError } from "../shared/errors.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerMemberRoutes } from "./routes/members.ts";
import { registerOrgStructureRoutes } from "./routes/org-structure.ts";
import { registerImRoutes } from "./routes/im.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerWorkItemRoutes } from "./routes/work-items.ts";
import { registerSetupRoutes } from "./routes/setup.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerApprovalRoutes } from "./routes/approvals.ts";
import { registerPlanningRoutes } from "./routes/planning.ts";
import { registerCommentRoutes } from "./routes/comments.ts";
import { registerAttachmentRoutes } from "./routes/attachments.ts";
import { registerAuditRoutes } from "./routes/audit.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerWorkflowConfigRoutes } from "./routes/workflow-config.ts";
import { registerCollabRoutes } from "./routes/collab.ts";
import { registerCollaborationRoutes } from "./routes/collaboration.ts";
import { registerTokenRoutes } from "./routes/tokens.ts";
import { registerMcpRoutes } from "./routes/mcp.ts";
import { registerSettingsRoutes } from "./routes/settings.ts";
import { registerCustomFieldRoutes } from "./routes/custom-fields.ts";
import { registerImportRoutes } from "./routes/imports.ts";
import { registerInsightRoutes } from "./routes/insight.ts";
import { registerIdeaRoutes } from "./routes/ideas.ts";
import { registerIntakeRoutes } from "./routes/intake.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import { registerIntegrationRoutes } from "./routes/integrations.ts";
import { registerFeatureFlagRoutes } from "./routes/feature-flags.ts";
import { registerMcpClientRoutes } from "./routes/mcp-clients.ts";
import { registerWorkItemLinkRoutes } from "./routes/work-item-links.ts";
import { registerProjectTemplateRoutes } from "./routes/project-templates.ts";
import { registerTeamRoutes } from "./routes/teams.ts";
import { registerFocusRoutes } from "./routes/focus.ts";
import { registerPortfolioRoutes } from "./routes/portfolios.ts";
import { registerPageRoutes } from "./routes/pages.ts";
import { registerKnowledgeRoutes } from "./routes/knowledge.ts";
import { registerAiRoutes } from "./routes/ai.ts";
import { registerComplianceRoutes } from "./routes/compliance.ts";
import { registerTwoFactorRoutes } from "./routes/two-factor.ts";
import { registerScimRoutes } from "./routes/scim.ts";
import { registerAutomationRoutes } from "./routes/automation.ts";
import { registerSlaRoutes } from "./routes/sla.ts";
import { registerRoleRoutes } from "./routes/roles.ts";
import { getState as getSetupState } from "./services/setup.service.ts";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    // 反向代理后面才信任 X-Forwarded-*（第 5.10 节；默认只信本机）
    trustProxy: process.env.TRUSTED_PROXY_CIDRS ?? "127.0.0.1",
  });

  /**
   * ⚠️ multipart **必须真正注册**：此前只有 `plugins-types.ts` 里的类型导入，
   * 解析器从未注册 —— 结果 POST /api/v1/uploads（第一阶段就有）与导入上传
   * 对任何客户端都返回 415 Unsupported Media Type，而七个阶段的 e2e 都在测服务层，
   * 谁都没走 HTTP 上传这条路径（第九期冒烟时才发现）。
   * 限制与反向代理的 client_max_body_size 30m 对齐（本处 20MB，留出表单开销余量）。
   */
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 20 } });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);

  /**
   * ⚠️ CSRF 插件**只注册、不全局挂钩子**（第 5.10 节第 4 条硬规则）。
   * `@fastify/csrf-protection` 注册后提供 `app.csrfProtection`，
   * 由各路由按需挂到 `onRequest`。全局挂会拦掉 MCP 的 POST（Bearer 路径）。
   */
  await app.register(csrf, {
    cookieOpts: { signed: false, sameSite: "lax", httpOnly: false, path: "/" },
  });

  await app.register(rateLimit, {
    global: false,          // 逐路由开，避免误伤 SSE 长连接
    max: 100,
    timeWindow: "1 minute",
  });

  // 统一错误处理：DomainError → 契约里的 `{ code, message, details }`
  app.setErrorHandler((rawErr, _req, reply) => {
    const err = rawErr as Error & { code?: string; validation?: unknown; statusCode?: number };
    if (rawErr instanceof DomainError) {
      return reply.status(rawErr.httpStatus).send({ code: rawErr.code, message: rawErr.message, details: rawErr.details });
    }
    // fastify 自身的校验错误 → VALIDATION
    if (err.validation) {
      return reply.status(400).send({ code: "VALIDATION", message: err.message, details: null });
    }
    // @fastify/csrf-protection 的拒绝
    const code = err.code;
    if (code === "FST_CSRF_MISSING_SECRET" || code === "FST_CSRF_INVALID_TOKEN") {
      return reply.status(403).send({ code: "FORBIDDEN", message: "CSRF 校验失败", details: null });
    }
    if (code === "FST_RATE_LIMIT_EXCEEDED") {
      return reply.status(429).send({ code: "RATE_LIMITED", message: "请求过于频繁", details: null });
    }
    /**
     * ⚠️ Fastify 自身的 4xx 必须原样按客户端错误返回，**不能一律吞成 500**。
     *
     * 实测踩到：无 body 的 POST 带上 `content-type: application/json` 会抛
     * `FST_ERR_CTP_EMPTY_JSON_BODY`（statusCode 400）。若落到下面的兜底分支，
     * 客户端错误会被报成 500 —— 掩盖真实原因，也让调用方误以为服务端故障。
     */
    const status = typeof err.statusCode === "number" ? err.statusCode : 0;
    if (status >= 400 && status < 500) {
      return reply.status(status).send({
        code: status === 429 ? "RATE_LIMITED" : "VALIDATION",
        message: err.message,
        details: null,
      });
    }
    // 未预期错误：不把内部细节泄露给调用方，只记日志
    app.log.error(err);
    return reply.status(500).send({ code: "INTERNAL", message: "服务器内部错误", details: null });
  });

  // 路由不存在 → 契约里 404 **只用于路由不存在**
  /**
   * ⚠️ 未初始化时的拦截面（第 6.1 节状态机）：
   *    - 未初始化 → **页面请求 302 到 /setup**；**API 请求返回 JSON 错误**（不重定向，
   *      否则前端 fetch 会拿到 HTML 而 JSON 解析失败，报出莫名其妙的错）
   *    - 已初始化 → 页面请求 `/setup` 转到登录；向导 API 返回 403（防止重跑向导改掉管理员）
   *
   * 豁免：向导自身、/api/v1/system/*、静态资源。
   * 数据库不可用时**不拦**，让各路由给出真实错误（否则自检页都打不开）。
   */
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    const isSetupPath = url === "/setup" || url.startsWith("/setup/");
    const isSetupApi = url.startsWith("/api/v1/setup/");
    const isSystemApi = url.startsWith("/api/v1/system/");
    const isAsset = /\.(js|css|map|svg|png|jpg|jpeg|ico|woff2?|ttf|json)$/i.test(url)
      || url.startsWith("/assets/");

    let initialized: boolean;
    try {
      initialized = (await getSetupState()).initialized;
    } catch {
      return;   // 数据库不可用时不拦
    }

    if (!initialized) {
      if (isSetupPath || isSetupApi || isSystemApi || isAsset) return;
      if (url.startsWith("/api/")) {
        return reply.status(403).send({
          code: "FORBIDDEN", message: "本实例尚未完成初始化，请先访问 /setup", details: null,
        });
      }
      return reply.redirect("/setup", 302);
    }

    /**
     * 已初始化后关闭向导入口。
     *
     * ⚠️ **例外：`GET /api/v1/setup/state` 永远放行**（D5）。
     *    前端要靠它决定「跳向导还是跳登录」。若也返回 403，前端只能靠 catch 猜状态 ——
     *    实测踩到：前端把 403 当成「已初始化」，逻辑虽然碰巧对，但这是靠猜测而不是靠契约，
     *    任何一方改动都会静默错位。状态查询是公开且无害的信息，没有必要拦。
     */
    const isStateQuery = url === "/api/v1/setup/state" && req.method === "GET";
    if (!isStateQuery && (isSetupPath || isSetupApi)) {
      // 页面入口给用户可恢复的去向；安装 API 仍保持封锁。
      if (isSetupPath && req.method === "GET") return reply.redirect("/login", 302);
      return reply.status(403).send({ code: "FORBIDDEN", message: "本实例已完成初始化", details: null });
    }
  });

  await registerHealthRoutes(app);
  await registerApprovalRoutes(app);
  await registerSetupRoutes(app);
  await registerAuthRoutes(app);
  await registerMemberRoutes(app);
  await registerOrgStructureRoutes(app);
  await registerImRoutes(app);
  await registerProjectRoutes(app);
  await registerPlanningRoutes(app);
  await registerCommentRoutes(app);
  await registerAttachmentRoutes(app);
  await registerAuditRoutes(app);
  await registerEventRoutes(app);
  await registerWorkflowConfigRoutes(app);
  await registerCollabRoutes(app);
  await registerCollaborationRoutes(app);
  await registerTokenRoutes(app);
  await registerMcpRoutes(app);
  await registerSettingsRoutes(app);
  await registerCustomFieldRoutes(app);
  await registerImportRoutes(app);
  await registerInsightRoutes(app);
  await registerIdeaRoutes(app);
  await registerIntakeRoutes(app);
  await registerWebhookRoutes(app);
  await registerIntegrationRoutes(app);
  await registerFeatureFlagRoutes(app);
  await registerMcpClientRoutes(app);
  await registerWorkItemLinkRoutes(app);
  await registerProjectTemplateRoutes(app);
  await registerTeamRoutes(app);
  await registerFocusRoutes(app);
  await registerPortfolioRoutes(app);
  await registerPageRoutes(app);
  await registerKnowledgeRoutes(app);
  await registerAiRoutes(app);
  await registerComplianceRoutes(app);
  // SCIM 的媒体类型、鉴权钩子与错误信封只作用于自身路由。
  await app.register(registerScimRoutes);
  await registerAutomationRoutes(app);
  await registerSlaRoutes(app);
  await registerTwoFactorRoutes(app);
  await registerRoleRoutes(app);
  await registerWorkItemRoutes(app);

  /**
   * SPA 静态托管：REST 与 MCP 之外的路径一律交给 index.html（前端路由自己处理）。
   * ⚠️ 只注册一次，且必须在所有 API 路由**之后** —— 否则会把 API 路径也吞掉。
   */
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), "../../dist");
  /**
   * ⚠️⚠️ `wildcard: false` 的真实语义是「**只服务注册时已存在的文件**」——
   * 它是**按启动那一刻的目录快照**登记路由的，不按请求实时读取。
   * 后果（实测复现）：重新构建产生新的 hash 资源后，`index.html` 是每次现读的（新引用），
   * 而插件对新资源一律 404 → **任何新访客都是空白页**（老访客靠缓存看着还正常，最难排查）。
   * 这大概率就是此前那次"全黑屏"的真身。
   *
   * 保留 `wildcard: false`（避免 `/*` 吞掉 API 的 404 契约）的同时，
   * 用下面 `serveAsset` 做**按请求实时读取**的兜底：命中文件则发送，未命中则按既有规则 404。
   */
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: "/",
    wildcard: false,
    /**
     * 缓存策略（D2）：
     *   - Vite 产物带内容哈希（`index-<hash>.js`），内容变了文件名就变 → 可**永久缓存**
     *   - `index.html` 绝不能被长期缓存，否则重新部署后用户仍拿旧 HTML，
     *     而它引用的旧 hash 资源已不存在 → **黑屏**（见下方 notFoundHandler 的说明）
     */
    setHeaders(reply, path) {
      if (path.endsWith("index.html")) {
        reply.header("cache-control", "no-cache");
      } else if (path.includes("/assets/")) {
        reply.header("cache-control", "public, max-age=31536000, immutable");
      }
    },
  });
  /**
   * SPA 回落 —— **只对「页面路径」生效，绝不对静态资源生效**。
   *
   * ⚠️ 这里踩过一个阻断级坑（实测）：回落若不加区分，请求一个**不存在的 JS**
   *    会返回 index.html + 200 + text/html。浏览器带 `X-Content-Type-Options: nosniff`
   *    时**拒绝把它当模块执行**，于是 React 永不挂载 —— 用户看到的是**纯黑屏**，
   *    控制台之外毫无线索。触发条件极常见：重新构建后 bundle 的 hash 变了，
   *    而浏览器缓存里还是指向旧 hash 的 index.html。
   *
   * 判定规则：**带文件扩展名或位于 /assets/ 之下的一律视为静态资源**，找不到就 404，
   * 让它**显式失败**而不是静默返回一份 HTML。
   */
  const ASSET_LIKE = /\.[a-z0-9]+$/i;

  /**
   * 静态资源兜底：**按请求实时读取磁盘**（`reply.sendFile` 每次 stat），
   * 因此重新构建后的新 hash 资源立即可用，不需要重启进程。
   * 只处理「像资源」的路径；页面路径仍交给下面的 SPA 回落。
   */
  app.get("/*", async (req, reply) => {
    const url = (req.url.split("?")[0] ?? "");
    const isAsset = url.startsWith("/assets/") || ASSET_LIKE.test(url);
    if (!isAsset) return reply.callNotFound();          // 页面路径 → 交给 SPA 回落
    try {
      return await reply.sendFile(url.slice(1), clientDist);
    } catch {
      return reply.status(404).send({ code: "NOT_FOUND", message: "资源不存在", details: null });
    }
  });
  app.setNotFoundHandler((req, reply) => {
    const url = (req.url.split("?")[0] ?? "");
    const isApi = url.startsWith("/api/");
    const isAsset = url.startsWith("/assets/") || ASSET_LIKE.test(url);
    if (isApi || isAsset) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "资源不存在", details: null });
    }
    // 页面路径：交给前端路由
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });

  /**
   * 迁移自检（文档 REST 第 10 节）：账本与迁移文件是否对得上、是否外部库（备份责任在部署方）。
   * 这是用户敢不敢升级的关键信息 —— 升级失败最常见的根因就是账本与文件不一致。
   */
  app.get("/api/v1/system/migrations", async (req, reply) => {
    const { migrationStatus } = await import("./services/upgrade.service.ts");
    // 权限：管理级（setting:manage）必须是组织级授权 —— 不允许「部门 ADMIN」靠角色并集读系统迁移
    const actor = (req as { actor?: import("./permission/actor.ts").Actor }).actor;
    const { can } = await import("./permission/engine.ts");
    const allowed = !!actor && can(actor, "setting:manage", { projectId: null, teamId: null }, {
      memberProjectIds: new Set(), memberTeamIds: new Set(), memberId: actor.memberId,
    });
    if (!allowed) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "需要设置管理权限", details: null });
    }
    return migrationStatus();
  });

  /**
   * 运维状态聚合（setting:manage）：把 webhook 死信/重试、保留期、集成、功能开关、MCP 与调度器间隔
   * 搬到系统页。只读，不提供改变状态的按钮。
   */
  app.get("/api/v1/system/operations", async (req, reply) => {
    const actor = (req as { actor?: import("./permission/actor.ts").Actor }).actor;
    if (!actor) return reply.status(403).send({ code: "FORBIDDEN", message: "需要设置管理权限", details: null });
    const { operationsStatus } = await import("./services/ops-status.service.ts");
    return operationsStatus(actor);   // 权限不足由服务层抛 DomainError（全局错误处理映射 403）
  });

  /** 系统状态：健康检查与安装向导状态（契约见 REST 清单） */
  app.get("/api/v1/system/status", async () => ({
    ok: true,
    version: process.env.FERONAVI_VERSION ?? "dev",
    // buildVersion = 当前托管静态资源的哈希：前端轮询比对，发现"服务端已是新构建"时提示在线用户刷新
    buildVersion: (await import("./services/build-info.service.ts")).getBuildId(),
  }));

  /**
   * IP 归属地库状态与在线更新（setting:manage）。
   * 状态读取无副作用；update 强制从上游拉取最新 xdb 并原子替换。
   */
  app.get("/api/v1/system/ipgeo", async (req, reply) => {
    const actor = (req as { actor?: import("./permission/actor.ts").Actor }).actor;
    if (!actor) return reply.status(403).send({ code: "FORBIDDEN", message: "需要设置管理权限", details: null });
    const { ipGeoStatus } = await import("./services/ipgeo.service.ts");
    return ipGeoStatus();
  });

  app.post("/api/v1/system/ipgeo/update", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = (req as { actor?: import("./permission/actor.ts").Actor }).actor;
    if (!actor) return reply.status(403).send({ code: "FORBIDDEN", message: "需要设置管理权限", details: null });
    const { updateIpGeoData, ipGeoStatus } = await import("./services/ipgeo.service.ts");
    try {
      await updateIpGeoData();
      return { ok: true, status: ipGeoStatus() };
    } catch (e) {
      return reply.status(400).send({ code: "VALIDATION", message: e instanceof Error ? e.message : "更新失败", details: null });
    }
  });

  /** 平台更新检查（setting:manage）：只做信息提示，绝不自动升级 */
  app.get("/api/v1/system/update-check", async (req, reply) => {
    const actor = (req as { actor?: import("./permission/actor.ts").Actor }).actor;
    if (!actor) return reply.status(403).send({ code: "FORBIDDEN", message: "需要设置管理权限", details: null });
    const { platformUpdateStatus } = await import("./services/update-check.service.ts");
    return platformUpdateStatus();
  });

  app.post("/api/v1/system/update-check", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = (req as { actor?: import("./permission/actor.ts").Actor }).actor;
    if (!actor) return reply.status(403).send({ code: "FORBIDDEN", message: "需要设置管理权限", details: null });
    const { checkPlatformUpdate } = await import("./services/update-check.service.ts");
    return checkPlatformUpdate(true);
  });

  return app;
}
