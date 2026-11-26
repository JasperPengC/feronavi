import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { forbidden } from "../../shared/errors.ts";
import * as execution from "../services/test-run.service.ts";
import {
  assertWriteTesting,
  type TestPermission,
} from "../services/test-access.ts";
import { withIdempotency } from "../services/idempotency.service.ts";
const params = z.object({
  projectId: z.uuid(),
  planId: z.uuid().optional(),
  runId: z.uuid().optional(),
});
const actor = (req: FastifyRequest) => {
  if (!req.actor) throw forbidden();
  return req.actor;
};
async function write<T>(
  req: FastifyRequest,
  scope: string,
  permission: TestPermission,
  fn: () => Promise<T>,
) {
  const p = params.parse(req.params),
    a = actor(req);
  await assertWriteTesting(a, p.projectId, permission);
  if (p.planId) await execution.getTestPlan(a, p.projectId, p.planId);
  if (p.runId) {
    const r = await execution.getTestRun(a, p.projectId, p.runId);
    if (scope === "createDefect" && !r.canCreateDefect) throw forbidden();
  }
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
        scope: `testing.rest.${scope}`,
        body: { params: p, body: req.body },
      },
      fn,
    )
  ).value;
}
export async function registerTestExecutionRoutes(app: FastifyInstance) {
  const base = "/api/v1/projects/:projectId/testing";
  app.get(base + "/plans", async (req) =>
    execution.listTestPlans(
      actor(req),
      params.parse(req.params).projectId,
      req.query,
    ),
  );
  app.get(base + "/plans/:planId", async (req) => {
    const p = params.parse(req.params);
    return execution.getTestPlan(actor(req), p.projectId, p.planId!);
  });
  app.get(base + "/plans/:planId/report", async (req) => {
    const p = params.parse(req.params);
    return execution.getTestPlanReport(actor(req), p.projectId, p.planId!);
  });
  app.get(base + "/runs/:runId", async (req) => {
    const p = params.parse(req.params);
    return execution.getTestRun(actor(req), p.projectId, p.runId!);
  });
  app.post(
    base + "/plans",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const p = params.parse(req.params);
      const result = await write(req, "createPlan", "test_plan:manage", () =>
        execution.createTestPlan(actor(req), p.projectId, req.body),
      );
      reply.status(201);
      return result;
    },
  );
  app.patch(
    base + "/plans/:planId",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "updatePlan", "test_plan:manage", () =>
        execution.updateTestPlan(actor(req), p.projectId, p.planId!, req.body),
      );
    },
  );
  app.post(
    base + "/plans/:planId/transition",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "transitionPlan", "test_plan:manage", () =>
        execution.transitionTestPlan(
          actor(req),
          p.projectId,
          p.planId!,
          req.body,
        ),
      );
    },
  );
  app.post(
    base + "/plans/:planId/runs",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const p = params.parse(req.params);
      const result = await write(req, "startRun", "test_run:execute", () =>
        execution.startTestRun(actor(req), p.projectId, p.planId!, req.body),
      );
      reply.status(201);
      return result;
    },
  );
  app.patch(
    base + "/runs/:runId",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "recordRun", "test_run:execute", () =>
        execution.recordTestRun(actor(req), p.projectId, p.runId!, req.body),
      );
    },
  );
  app.post(
    base + "/runs/:runId/complete",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "completeRun", "test_run:execute", () =>
        execution.completeTestRun(actor(req), p.projectId, p.runId!, req.body),
      );
    },
  );
  app.post(
    base + "/runs/:runId/defects",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "createDefect", "test_run:execute", () =>
        execution.createTestRunDefect(
          actor(req),
          p.projectId,
          p.runId!,
          req.body,
        ),
      );
    },
  );
  app.post(
    base + "/runs/:runId/defect-links",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return write(req, "linkDefect", "test_run:execute", () =>
        execution.linkTestRunDefect(
          actor(req),
          p.projectId,
          p.runId!,
          req.body,
        ),
      );
    },
  );
}
