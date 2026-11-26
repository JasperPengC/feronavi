/** Wiki 端点（第十二期，REST 9 节）—— 读写一律经 wiki.service（可见性唯一入口） */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as wiki from "../services/wiki.service.ts";
import { organizePage } from "../services/page-structure.service.ts";
import { organizePageSchema } from "../../shared/schemas/page-structure.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

const idP = z.object({ id: z.string().uuid() });
const pidP = z.object({ id: z.string().uuid() });
const PRINCIPALS = ["MEMBER", "TEAM", "ROLE"] as const;

export async function registerPageRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/projects/:id/pages", async (req) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    const q = z.object({ q: z.string().max(300).optional(), archived: z.enum(["true", "false"]).optional() }).parse(req.query);
    // 带 q 时走检索（同样套可见性条件）
    return { pages: await wiki.listPages(actor, id, { q: q.q, archived: q.archived === "true" }), mode: q.q ? "search" : "tree" };
  });

  app.post("/api/v1/projects/:id/pages", { onRequest: app.csrfProtection }, async (req, reply) => {
    const actor = actorOf(req);
    const { id } = pidP.parse(req.params);
    const parsed = z.object({
      title: z.string().min(1).max(300),
      kind: z.enum(["DOCUMENT", "FOLDER"]).optional(),
      content: z.string().max(200_000).optional(),
      parentId: z.string().uuid().nullable().optional(),
      visibility: z.enum(["PROJECT", "RESTRICTED"]).optional(),
      sortOrder: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    reply.status(201);
    return wiki.createPage(actor, id, parsed.data);
  });

  /** 详情：**含正文**（列表不含，规范明示） */
  app.get("/api/v1/pages/:id", async (req) => {
    const { id } = idP.parse(req.params);
    return wiki.getPage(actorOf(req), id);
  });

  app.patch("/api/v1/pages/:id/structure", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = organizePageSchema.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return organizePage(actorOf(req), id, parsed.data);
  });

  app.patch("/api/v1/pages/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      title: z.string().min(1).max(300).optional(),
      content: z.string().max(200_000).optional(),
      parentId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().optional(),
      visibility: z.enum(["PROJECT", "RESTRICTED"]).optional(),
      changeSummary: z.string().max(300).nullable().optional(),
      expectedRevisionId: z.string().uuid().optional(),
      expectedStructureVersion: z.number().int().positive().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return wiki.updatePage(actorOf(req), id, parsed.data);
  });

  app.delete("/api/v1/pages/:id", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    await wiki.deletePage(actorOf(req), id);
    return { ok: true };
  });

  app.get("/api/v1/pages/:id/revisions", async (req) => {
    const { id } = idP.parse(req.params);
    return { revisions: await wiki.listRevisions(actorOf(req), id) };
  });

  /** 回滚：append-only（把旧内容写成新版本，不删旧版） */
  app.post("/api/v1/pages/:id/revisions/:revId/restore", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const { revId } = z.object({ revId: z.string().uuid() }).parse(req.params);
    return wiki.restoreRevision(actorOf(req), id, revId);
  });

  app.get("/api/v1/pages/:id/permissions", async (req) => {
    const { id } = idP.parse(req.params);
    return { permissions: await wiki.listPermissions(actorOf(req), id) };
  });

  /** 页面级 ACL：仅 RESTRICTED 页有意义 */
  app.put("/api/v1/pages/:id/permissions", { onRequest: app.csrfProtection }, async (req) => {
    const { id } = idP.parse(req.params);
    const parsed = z.object({
      permissions: z.array(z.object({
        principalType: z.enum(PRINCIPALS),
        principalId: z.string().uuid(),
        canRead: z.boolean(),
        canWrite: z.boolean(),
      })).max(200),
    }).safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return { permissions: await wiki.setPermissions(actorOf(req), id, parsed.data.permissions) };
  });
}
