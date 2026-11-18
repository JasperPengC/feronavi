/** 组织架构路由（Round 66 对标）：部门 / 职位 / 成员归属 —— 薄层，权限在服务层 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as svc from "../services/org-structure.service.ts";

const idParam = z.object({ id: z.string().uuid() });
const orgBody = z.object({ departmentId: z.string().uuid().nullable().optional(), positionId: z.string().uuid().nullable().optional() });

export async function registerOrgStructureRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/departments", async (req) => {
    actorOf(req);
    return svc.listDepartments();
  });
  app.post("/api/v1/departments", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({ name: z.string().min(1).max(80), parentId: z.string().uuid().nullable().optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return svc.createDepartment(actor, parsed.data);
  });
  app.patch("/api/v1/departments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = z.object({ name: z.string().min(1).max(80).optional(), parentId: z.string().uuid().nullable().optional(), sortOrder: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return svc.updateDepartment(actor, id, parsed.data);
  });
  app.delete("/api/v1/departments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    await svc.archiveDepartment(actor, id);
    return { ok: true };
  });

  /** 组织模板：公司 / OPC，只补缺失的部门与岗位，不覆盖已有结构 */
  app.post("/api/v1/organization/template", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const body = z.object({ kind: z.enum(["COMPANY", "OPC"]) }).safeParse(req.body);
    if (!body.success) throw new DomainError("VALIDATION", "参数不合法", body.error.issues);
    return svc.applyOrganizationTemplate(actor, body.data.kind);
  });

  app.get("/api/v1/positions", async (req) => {
    actorOf(req);
    return svc.listPositions();
  });
  app.post("/api/v1/positions", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const parsed = z.object({
      name: z.string().min(1).max(80), code: z.string().max(40).nullable().optional(),
      departmentId: z.string().uuid().nullable().optional(), description: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return svc.createPosition(actor, parsed.data);
  });
  app.patch("/api/v1/positions/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(), code: z.string().max(40).nullable().optional(),
      departmentId: z.string().uuid().nullable().optional(), description: z.string().max(2000).nullable().optional(),
      sortOrder: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return svc.updatePosition(actor, id, parsed.data);
  });
  app.delete("/api/v1/positions/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    await svc.archivePosition(actor, id);
    return { ok: true };
  });

  app.patch("/api/v1/members/:id/organization", { onRequest: app.csrfProtection }, async (req) => {
    const actor = actorOf(req);
    const { id } = idParam.parse(req.params);
    const parsed = orgBody.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return svc.assignMemberOrganization(actor, id, parsed.data);
  });
}
