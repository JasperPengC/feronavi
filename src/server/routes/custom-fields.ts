/** 自定义字段端点（第八期 W2/W3） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as cf from "../services/custom-field.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const pidP = z.object({ projectId: z.string().uuid() });
const defBody = z.object({
  key: z.string().min(2).max(40),
  name: z.string().min(1).max(80),
  type: z.enum(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "PERSON"]),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1), color: z.string().max(32).optional() })).optional(),
  requiredStates: z.array(z.string().max(40)).optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function registerCustomFieldRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/projects/:projectId/custom-fields", async (req) => {
    const actor = actorOf(req);
    const { projectId } = pidP.parse(req.params);
    const q = req.query as { archived?: string };
    return cf.listDefs(actor, projectId, { includeArchived: q.archived === "true" });
  });

  app.post("/api/v1/projects/:projectId/custom-fields", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { projectId } = pidP.parse(req.params);
    const parsed = defBody.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return cf.createDef(actor, projectId, parsed.data);
  });

  app.patch("/api/v1/custom-fields/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = defBody.partial().omit({ key: true, type: true }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return cf.updateDef(actor, id, parsed.data);
  });

  app.post("/api/v1/custom-fields/:id/archive", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    await cf.archiveDef(actor, id);
    return { ok: true };
  });

  // ── 字段值：读写都必须经服务层（规范纪律）──
  app.get("/api/v1/work-items/:id/custom-fields", async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    return { fields: await cf.getValues(actor, id) };
  });

  app.patch("/api/v1/work-items/:id/custom-fields", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idP.parse(req.params);
    const parsed = z.object({ values: z.record(z.string(), z.unknown()) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return { fields: await cf.setValues(actor, id, parsed.data.values) };
  });
}
