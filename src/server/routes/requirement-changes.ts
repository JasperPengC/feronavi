import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as changes from "../services/requirement-change.service.ts";
import type { Actor } from "../permission/actor.ts";

const params = z.object({
  workItemId: z.uuid(),
  changeId: z.uuid().optional(),
});
export async function registerRequirementChangeRoutes(app: FastifyInstance) {
  const actor = (req: { actor?: Actor }) => {
    if (!req.actor)
      throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const base = "/api/v1/work-items/:workItemId/changes";
  app.get(base + "/context", async (req) =>
    changes.getChangeContext(actor(req), params.parse(req.params).workItemId),
  );
  app.get(base, async (req) =>
    changes.listRequirementChanges(
      actor(req),
      params.parse(req.params).workItemId,
      req.query,
    ),
  );
  app.get(base + "/:changeId", async (req) => {
    const p = params.parse(req.params);
    return changes.getRequirementChange(actor(req), p.workItemId, p.changeId!);
  });
  app.post(base, { onRequest: app.csrfProtection }, async (req, reply) => {
    const p = params.parse(req.params);
    const result = await changes.createRequirementChange(
      actor(req),
      p.workItemId,
      req.body,
    );
    reply.status(201);
    return result;
  });
  app.post(
    base + "/:changeId/decide",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return changes.decideRequirementChange(
        actor(req),
        p.workItemId,
        p.changeId!,
        req.body,
      );
    },
  );
  app.post(
    base + "/:changeId/apply",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return changes.applyRequirementChange(
        actor(req),
        p.workItemId,
        p.changeId!,
        req.body,
      );
    },
  );
  app.post(
    base + "/:changeId/acknowledge",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return changes.acknowledgeRequirementImpact(
        actor(req),
        p.workItemId,
        p.changeId!,
        req.body,
      );
    },
  );
}
