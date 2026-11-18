/** 安装向导路由（R7）—— 第 6.1 节六步 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import { setupCompleteSchema } from "../../shared/schemas/setup.ts";
import * as setupService from "../services/setup.service.ts";
import * as settingRepo from "../repos/setting.repo.ts";
import postgres from "postgres";

export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  /** 是否已初始化（公开：前端要知道该跳向导还是跳登录） */
  /**
   * 公开状态查询。除向导状态外，额外暴露一个**能力标志**（第七期 D3）：
   * `passwordResetEnabled` = 是否已配 SMTP（规范要求"未配 SMTP 时界面不显示自助找回入口"）。
   * 只暴露布尔值，不泄露任何 SMTP 细节。
   */
  app.get("/api/v1/setup/state", async (req) => {
    // ⚠️ 全新实例上**表还不存在**（迁移尚未跑成功）→ getState() 会抛错 → 此前直接 500，
    // 于是**安装向导页面拿不到状态、根本无法渲染** —— 而向导恰恰就是为"还没初始化"的实例准备的。
    // 因此这里把"读不到状态"翻译成**合法的未初始化状态**（200），让向导能正常显示第一步。
    // ⚠️ 整个处理体都要包住：`loadMailConfig()` **也会查表**，只包 getState() 不够
    //（我第一次就是这么修的，空库实测仍然 500 —— 修完必须实测，不能只看"改对了"）。
    try {
      const state = await setupService.getState();
      const { loadMailConfig } = await import("../services/mail.service.ts");
      const mail = await loadMailConfig().catch(() => null);
      return { ...state, passwordResetEnabled: mail !== null };
    } catch (e) {
      req.log?.warn?.({ err: e }, "setup/state 读不到状态（通常表示全新库尚未迁移），按未初始化处理");
      return { initialized: false, schemaReady: false, passwordResetEnabled: false };
    }
  });

  /**
   * 第 1 步：环境自检。
   * 任一项失败**仍返回 200**，由前端按 `items` 渲染可读原因。
   */
  app.get("/api/v1/setup/precheck", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return setupService.precheck();
  });

  /**
   * 第 2 步：当前数据库信息 + 外部 PostgreSQL 连接测试。
   *
   * 说明：Feronavi 不内置数据库，实例启动时通过 DATABASE_URL 连接 PostgreSQL。
   * 向导不能在运行中热切换 Drizzle 单例，因此这里做的是**安装前检查**：
   * 显示当前连接、PostgreSQL 版本、扩展能力；外部 URL 只测试不落库/不打印密码。
   */
  app.get("/api/v1/setup/database", async () => {
    const state = await setupService.getState();
    if (state.initialized) throw new DomainError("FORBIDDEN", "本实例已完成初始化", null);
    const url = process.env.DATABASE_URL ?? "";
    return describeDatabase(url, url);
  });

  app.post("/api/v1/setup/database/test", async (req) => {
    const state = await setupService.getState();
    if (state.initialized) throw new DomainError("FORBIDDEN", "本实例已完成初始化", null);
    const body = z.object({ url: z.string().min(8).max(2000) }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "请填写 PostgreSQL 连接串", body.error.issues);
    const raw = body.data.url.trim();
    if (!/^postgres(ql)?:\/\//i.test(raw)) throw new DomainError("VALIDATION", "连接串必须以 postgres:// 或 postgresql:// 开头", null);
    return describeDatabase(raw, "");
  });

  /** 第 2..5 步：记住当前步骤（刷新后可回到原处） */
  app.post("/api/v1/setup/step", async (req) => {
    const state = await setupService.getState();
    if (state.initialized) throw new DomainError("FORBIDDEN", "本实例已完成初始化", null);
    const body = req.body as { step?: number };
    const step = Number(body?.step);
    if (!Number.isInteger(step) || step < 1 || step > 6) {
      throw new DomainError("VALIDATION", "步骤必须是 1–6 的整数", null);
    }
    await settingRepo.setCurrentStep(step);
    return { ok: true };
  });

  /** 第 6 步：完成向导（单事务） */
  app.post("/api/v1/setup/complete", async (req, reply) => {
    const parsed = setupCompleteSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);

    await setupService.complete(parsed.data);
    reply.status(201);
    return { ok: true };
  });

  /** 组织信息（公开字段：名称/Logo/默认语言/时区；不含任何密钥） */
  app.get("/api/v1/organization", async () => {
    const { getOrganization } = await import("../services/organization.service.ts");
    const org = await getOrganization();
    return { ...org, storageKind: (await settingRepo.listPublic())["storage.kind"] ?? "local" };
  });

  /** 修改组织信息（org:manage；与向导第 4 步同一实体） */
  app.patch("/api/v1/organization", { onRequest: app.csrfProtection }, async (req) => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    const parsed = z.object({
      name: z.string().min(1).max(100).optional(),
      logoUrl: z.string().max(2000).nullable().optional(),
      defaultLocale: z.enum(["zh-CN", "en-US"]).optional(),
      defaultTimezone: z.string().min(1).max(100).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const { updateOrganization } = await import("../services/organization.service.ts");
    return updateOrganization(req.actor, parsed.data);
  });
}


/** 连接 PostgreSQL 读取版本/扩展；失败返回可读错误，不泄露密码。 */
async function describeDatabase(rawUrl: string, displayUrl: string) {
  const parsed = safeUrl(rawUrl);
  const masked = maskedUrl(rawUrl);
  let client: ReturnType<typeof postgres> | null = null;
  try {
    client = postgres(rawUrl, { max: 1, connect_timeout: 5, idle_timeout: 1, onnotice: () => {} });
    const [row] = await client<{ version: string; db: string; user: string }[]>`
      select version() as version, current_database() as db, current_user as user
    `;
    const exts = await client<{ extname: string }[]>`
      select extname from pg_extension where extname in ('vector','zhparser','pg_trgm')
    `;
    const installed = new Set(exts.map((e) => e.extname));
    const major = Number(/\bPostgreSQL\s+(\d+)/i.exec(row?.version ?? "")?.[1] ?? 0);
    return {
      ok: true,
      current: displayUrl === rawUrl,
      host: parsed?.host ?? masked,
      database: row?.db ?? parsed?.pathname.replace(/^\//, "") ?? "",
      user: row?.user ?? parsed?.username ?? "",
      maskedUrl: masked,
      version: row?.version?.split(",")[0] ?? "",
      major,
      compatible: major >= 14,
      recommended: major >= 16,
      extensions: { vector: installed.has("vector"), zhparser: installed.has("zhparser"), pgTrgm: installed.has("pg_trgm") },
    };
  } catch (e) {
    const message = String((e as Error).message || e).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://***");
    return { ok: false, current: displayUrl === rawUrl, maskedUrl: masked, error: message };
  } finally {
    if (client) await client.end({ timeout: 1 }).catch(() => {});
  }
}

function safeUrl(raw: string): URL | null {
  try { return new URL(raw); } catch { return null; }
}

function maskedUrl(raw: string): string {
  const u = safeUrl(raw);
  if (!u) return "postgres://***";
  const user = u.username ? `${u.username}@` : "";
  return `${u.protocol}//${user}${u.host}${u.pathname}`;
}
