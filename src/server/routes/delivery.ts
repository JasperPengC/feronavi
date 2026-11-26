import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { forbidden } from "../../shared/errors.ts";
import * as evidence from "../services/delivery-evidence.service.ts";
import * as sources from "../services/delivery-source.service.ts";
import {
  assertDeliveryWrite,
  type DeliveryPermission,
} from "../services/delivery-access.ts";
import { withIdempotency } from "../services/idempotency.service.ts";
import {
  receiveGitHubDelivery,
  receiveGitHubPing,
} from "../services/delivery-webhook.service.ts";
import type { DeliveryFetchDeps } from "../services/delivery-github.ts";
import { registerReleaseGateRoutes } from "./release-gate.ts";
const params = z.object({
  projectId: z.uuid(),
  evidenceId: z.uuid().optional(),
});
const actor = (req: FastifyRequest) => {
  if (!req.actor) throw forbidden();
  return req.actor;
};
async function write<T>(
  req: FastifyRequest,
  name: string,
  permission: DeliveryPermission,
  fn: () => Promise<T>,
) {
  const a = actor(req),
    p = params.parse(req.params);
  await assertDeliveryWrite(a, p.projectId, permission);
  if (p.evidenceId)
    await evidence.getDeliveryEvidence(a, p.projectId, p.evidenceId);
  const body = z
    .object({
      integrationId: z.uuid().optional(),
      sourceId: z.uuid().optional(),
      workItemIds: z.array(z.uuid()).optional(),
    })
    .passthrough()
    .parse(req.body);
  if (body.integrationId)
    await sources.assertDeliverySourceTarget(
      a,
      p.projectId,
      body.integrationId,
      body.sourceId,
    );
  if (body.workItemIds)
    await evidence.assertDeliveryItems(a, p.projectId, body.workItemIds);
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
        scope: "delivery.rest." + name,
        body: { params: p, body: req.body },
      },
      fn,
    )
  ).value;
}
export async function registerDeliveryRoutes(
  app: FastifyInstance,
  deps: DeliveryFetchDeps = {},
) {
  await registerReleaseGateRoutes(app);
  const base = "/api/v1/projects/:projectId/delivery";
  app.get(base + "/sources", async (req) =>
    sources.listDeliverySources(actor(req), params.parse(req.params).projectId),
  );
  app.post(base + "/sources", { onRequest: app.csrfProtection }, async (req) =>
    write(req, "source", "integration:manage", () =>
      sources.configureDeliverySource(
        actor(req),
        params.parse(req.params).projectId,
        req.body,
      ),
    ),
  );
  app.get(base + "/evidence", async (req) =>
    evidence.listDeliveryEvidence(
      actor(req),
      params.parse(req.params).projectId,
      req.query,
    ),
  );
  app.get(base + "/evidence/:evidenceId", async (req) => {
    const p = params.parse(req.params);
    return evidence.getDeliveryEvidence(actor(req), p.projectId, p.evidenceId!);
  });
  app.post(
    base + "/evidence",
    { onRequest: app.csrfProtection },
    async (req, reply) => {
      const result = await write(req, "create", "work_item:update_any", () =>
        evidence.createDeliveryEvidence(
          actor(req),
          params.parse(req.params).projectId,
          req.body,
        ),
      );
      reply.code(201);
      return result;
    },
  );
  app.post(
    base + "/evidence/:evidenceId/links",
    { onRequest: app.csrfProtection },
    async (req) => {
      const p = params.parse(req.params),
        b = z
          .object({ workItemIds: z.array(z.uuid()) })
          .strict()
          .parse(req.body);
      return write(req, "link", "work_item:update_any", () =>
        evidence.linkDeliveryEvidence(
          actor(req),
          p.projectId,
          p.evidenceId!,
          b.workItemIds,
        ),
      );
    },
  );
  // 独立封装parser保留签名的原始字节，不改变其它JSON路由。
  await app.register(async (hook) => {
    hook.removeContentTypeParser("application/json");
    hook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 1_048_576 },
      (_req, body, done) => done(null, body),
    );
    hook.post(
      "/api/v1/delivery/hooks/github/:sourceId",
      { bodyLimit: 1_048_576 },
      async (req) => {
        const p = z.object({ sourceId: z.uuid() }).parse(req.params);
        if (req.headers["x-github-event"] === "ping")
          return receiveGitHubPing(p.sourceId, req.headers, req.body as Buffer);
        return receiveGitHubDelivery(
          p.sourceId,
          req.headers,
          req.body as Buffer,
          deps,
        );
      },
    );
  });
}
