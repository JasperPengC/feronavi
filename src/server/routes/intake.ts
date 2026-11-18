/**
 * 需求收集端点（第十一期，REST 9 节）
 *
 * ⚠️ 匿名提交端点 `POST /api/v1/intake/:submitToken/submissions`：
 *   - 不读 req.actor（无会话即为外部提交者）
 *   - **严格限流**（规范要求）：公开写入必须挡刷
 *   - **绝不把令牌写日志**：路由层不打印 URL，也不把它放进错误详情
 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as intakeService from "../services/intake.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const pidP = z.object({ id: z.string().uuid() });

export async function registerIntakeRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/projects/:id/intake-forms", async (req) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    return { forms: await intakeService.listForms(actor, id) };
  });

  /** 建表单：**明文提交令牌只在此响应出现一次** */
  app.post("/api/v1/projects/:id/intake-forms", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    const parsed = z.object({ name: z.string().min(1).max(80), schema: z.array(z.unknown()).min(1) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return intakeService.createForm(actor, id, parsed.data);
  });

  app.patch("/api/v1/intake-forms/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      isActive: z.boolean().optional(),
      schema: z.array(z.unknown()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return intakeService.updateForm(actor, id, parsed.data);
  });

  app.post("/api/v1/intake-forms/:id/rotate-token", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return intakeService.rotateToken(actor, id);
  });

  app.delete("/api/v1/intake-forms/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await intakeService.deleteForm(actor, id);
    return { ok: true };
  });

  app.get("/api/v1/projects/:id/intake-submissions", async (req) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    const q = req.query as { status?: string };
    return intakeService.listSubmissions(actor, id, { status: q.status });
  });

  app.post("/api/v1/intake-submissions/:id/convert", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return intakeService.convertSubmission(actor, id);
  });

  app.post("/api/v1/intake-submissions/:id/reject", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await intakeService.rejectSubmission(actor, id);
    return { ok: true };
  });

  // 公开读取表单（匿名页面渲染字段）；只按 token 取，不返回项目/提交数据
  app.get("/api/v1/intake/:submitToken", {
    config: { rateLimit: intakeService.INTAKE_RATE_LIMIT },
  }, async (req) => {
    const { submitToken } = req.params as { submitToken: string };
    return intakeService.publicForm(submitToken);
  });

  // ── 匿名公开提交（无限流 = 可被刷爆，故按路由限流）──
  app.post("/api/v1/intake/:submitToken/submissions", {
    config: { rateLimit: intakeService.INTAKE_RATE_LIMIT },
  }, async (req, reply) => {
    const { submitToken } = req.params as { submitToken: string };
    const parsed = z.record(z.string(), z.unknown()).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    const r = await intakeService.publicSubmit(submitToken, parsed.data);
    reply.status(201);
    return { ok: true, id: r.id };
  });
}
