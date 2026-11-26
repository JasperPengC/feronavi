import { registerTestExecutionRoutes } from "./test-execution.ts";
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { forbidden } from "../../shared/errors.ts";
import * as library from "../services/test-case.service.ts";
import type { Actor } from "../permission/actor.ts";

const params = z.object({
  projectId: z.uuid(),
  caseId: z.uuid().optional(),
  suiteId: z.uuid().optional(),
  revisionId: z.uuid().optional(),
});
export async function registerTestManagementRoutes(app: FastifyInstance) {
  await registerTestExecutionRoutes(app);
  const actor = (req: { actor?: Actor }) => {
    if (!req.actor) throw forbidden();
    return req.actor;
  };
  const base = "/api/v1/projects/:projectId/testing";
  app.get(base + "/suites", async (req) => {
    const p = params.parse(req.params),
      q = z
        .object({ includeArchived: z.enum(["true", "false"]).optional() })
        .strict()
        .parse(req.query);
    return library.listTestSuites(
      actor(req),
      p.projectId,
      q.includeArchived === "true",
    );
  });
  app.get(base + "/suites/:suiteId", async (req) => {
    const p = params.parse(req.params);
    return library.getTestSuite(actor(req), p.projectId, p.suiteId!);
  });
  app.post(
    base + "/suites",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const p = params.parse(req.params);
      const result = await library.createTestSuite(
        actor(req),
        p.projectId,
        req.body,
      );
      reply.status(201);
      return result;
    },
  );
  app.patch(
    base + "/suites/:suiteId",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return library.updateTestSuite(
        actor(req),
        p.projectId,
        p.suiteId!,
        req.body,
      );
    },
  );
  app.get(base + "/cases", async (req) =>
    library.listTestCases(
      actor(req),
      params.parse(req.params).projectId,
      req.query,
    ),
  );
  app.get(base + "/cases/:caseId", async (req) => {
    const p = params.parse(req.params);
    return library.getTestCase(actor(req), p.projectId, p.caseId!);
  });
  app.get(base + "/cases/:caseId/revisions", async (req) => {
    const p = params.parse(req.params);
    return library.listTestCaseRevisions(
      actor(req),
      p.projectId,
      p.caseId!,
      req.query,
    );
  });
  app.get(base + "/cases/:caseId/revisions/:revisionId", async (req) => {
    const p = params.parse(req.params);
    return library.getTestCaseRevision(
      actor(req),
      p.projectId,
      p.caseId!,
      p.revisionId!,
    );
  });
  app.post(
    base + "/cases",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const p = params.parse(req.params);
      const result = await library.createTestCase(
        actor(req),
        p.projectId,
        req.body,
      );
      reply.status(201);
      return result;
    },
  );
  app.patch(
    base + "/cases/:caseId",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params);
      return library.updateTestCase(
        actor(req),
        p.projectId,
        p.caseId!,
        req.body,
      );
    },
  );
}
