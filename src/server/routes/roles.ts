/** 组织级角色、权限目录与成员角色指派 API。 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as roles from "../services/role.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idParams = z.object({ id: z.string().uuid() });
const assignmentInput = z.object({
  memberId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.enum(["ORG", "TEAM", "PROJECT"]),
  scopeId: z.string().uuid().nullable(),
});
const assignmentPatch = assignmentInput.omit({ memberId: true });
const permissionKeys = z.array(z.string().min(1).max(120)).max(100);
const createRoleBody = z.object({
  slug: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  permissionKeys,
}).strict();
const updateRoleBody = z.object({
  name: z.string().min(1).max(80).optional(),
  permissionKeys,
}).strict();

export async function registerRoleRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const manage = (req: { actor?: Actor }): Actor => {
    const actor = actorOf(req);
    roles.assertRoleManagement(actor);
    return actor;
  };

  app.get("/api/v1/roles", async (req) => ({ roles: await roles.listRoles(manage(req)) }));

  app.get("/api/v1/permissions", async (req) => ({ groups: await roles.listPermissionCatalog(manage(req)) }));

  app.get("/api/v1/roles/scope-options", async (req) => {
    const actor = manage(req);
    const parsed = z.object({ scopeType: z.enum(["TEAM", "PROJECT", "DEPARTMENT"]) }).safeParse(req.query);
    if (!parsed.success) throw new DomainError("VALIDATION", "范围类型不合法", parsed.error.issues);
    return roles.listScopeOptions(actor, parsed.data.scopeType);
  });

  app.post("/api/v1/roles", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = manage(req);
    const parsed = createRoleBody.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return roles.createRole(actor, parsed.data);
  });

  app.patch("/api/v1/roles/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = manage(req);
    const { id } = idParams.parse(req.params);
    const parsed = updateRoleBody.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return roles.updateRole(actor, id, parsed.data);
  });

  app.delete("/api/v1/roles/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = manage(req);
    const { id } = idParams.parse(req.params);
    await roles.deleteRole(actor, id);
    return { ok: true };
  });

  app.get("/api/v1/role-assignments", async (req) => {
    const actor = manage(req);
    const parsed = z.object({ memberId: z.string().uuid() }).safeParse(req.query);
    if (!parsed.success) throw new DomainError("VALIDATION", "成员标识不合法", parsed.error.issues);
    return { assignments: await roles.listRoleAssignments(actor, parsed.data.memberId) };
  });

  app.post("/api/v1/role-assignments", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = manage(req);
    const parsed = assignmentInput.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return roles.createRoleAssignment(actor, parsed.data);
  });

  app.patch("/api/v1/role-assignments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = manage(req);
    const { id } = idParams.parse(req.params);
    const parsed = assignmentPatch.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return roles.updateRoleAssignment(actor, id, parsed.data);
  });

  app.delete("/api/v1/role-assignments/:id", { onRequest: app.csrfProtection }, async (req) => {
    const actor = manage(req);
    const { id } = idParams.parse(req.params);
    await roles.deleteRoleAssignment(actor, id);
    return { ok: true };
  });
}
