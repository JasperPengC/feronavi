import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { forbidden } from "../../shared/errors.ts";
import * as gate from "../services/release-gate.service.ts";
import { assertDeliveryWrite } from "../services/delivery-access.ts";
import { assertDeliveryItems } from "../services/delivery-evidence.service.ts";
import { getTestPlan } from "../services/test-execution-read.ts";
import { assertDeliverySourceId } from "../services/delivery-source.service.ts";
import { withIdempotency } from "../services/idempotency.service.ts";
const params = z.object({ projectId: z.uuid(), releaseId: z.uuid() });
const actor = (req: FastifyRequest) => {
  if (!req.actor) throw forbidden();
  return req.actor;
};
async function write<T>(
  req: FastifyRequest,
  name: string,
  fn: () => Promise<T>,
) {
  const a = actor(req),
    p = params.parse(req.params);
  await assertDeliveryWrite(a, p.projectId, "release:manage");
  await gate.assertReleaseTarget(a, p.projectId, p.releaseId);
  const b = z
    .object({
      sourceId: z.uuid().optional(),
      workItemId: z.uuid().optional(),
      testPlanIds: z.array(z.uuid()).optional(),
    })
    .passthrough()
    .parse(req.body);
  if (b.sourceId) await assertDeliverySourceId(a, p.projectId, b.sourceId);
  if (b.workItemId) await assertDeliveryItems(a, p.projectId, [b.workItemId]);
  for (const id of b.testPlanIds ?? []) await getTestPlan(a, p.projectId, id);
  const key = z
    .string()
    .min(1)
    .max(200)
    .optional()
    .parse(req.headers["idempotency-key"]);
  return (
    await withIdempotency(
      {
        actorId: a.memberId,
        key,
        scope: "delivery.release.rest." + name,
        body: { params: p, body: req.body },
      },
      fn,
    )
  ).value;
}
export async function registerReleaseGateRoutes(app: FastifyInstance) {
  const base = "/api/v1/projects/:projectId/delivery/releases/:releaseId";
  app.get(base, async (req) => {
    const p = params.parse(req.params);
    return gate.getReleaseGate(actor(req), p.projectId, p.releaseId);
  });
  app.post(
    base + "/candidates",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "candidate", () =>
        gate.createReleaseCandidate(
          actor(req),
          p.projectId,
          p.releaseId,
          req.body,
        ),
      );
    },
  );
  app.post(
    base + "/feedback",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "feedback", () =>
        gate.recordReleaseFeedback(
          actor(req),
          p.projectId,
          p.releaseId,
          req.body,
        ),
      );
    },
  );
}
