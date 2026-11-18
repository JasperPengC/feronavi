/** 审批查询/决策路由 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as approval from "../services/approval.service.ts";
import type { Actor } from "../permission/actor.ts";

declare module "fastify" { interface FastifyRequest { actor?: Actor } }
export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  app.get("/api/v1/work-items/:id/approvals", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { approvals: await approval.listForItem(actorOf(req), id) };
  });
  const decide = (decision: "approve" | "reject") => async (req: { params: unknown; body: unknown; actor?: Actor }) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({ comment: z.string().max(1000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "参数不合法", parsed.error.issues);
    return { approval: await approval.decide(actorOf(req), id, decision, parsed.data.comment) };
  };
  app.post("/api/v1/approvals/:id/approve", { onRequest: app.csrfProtection }, decide("approve") as never);
  app.post("/api/v1/approvals/:id/reject", { onRequest: app.csrfProtection }, decide("reject") as never);
}
