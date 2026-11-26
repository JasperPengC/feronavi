import assert from "node:assert/strict";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Actor } from "../../src/server/permission/actor.ts";
import type { ToolCtx } from "../../src/server/mcp/tools.ts";
import type {
  ReleaseCandidateView,
  ReleaseFeedbackView,
} from "../../src/shared/schemas/release-gate.ts";
export async function verifyReleaseGateContracts(
  actor: Actor,
  projectId: string,
  releaseId: string,
  workItemId: string,
  sourceId: string,
  testPlanId: string,
) {
  const { db } = await import("../../src/db/index.ts"),
    { apiToken } = await import("../../src/db/schema.ts"),
    { buildMcpServer } = await import("../../src/server/mcp/server.ts");
  const [token] = await db
    .insert(apiToken)
    .values({
      memberId: actor.memberId,
      name: "发布协议",
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "release",
      tier: "READ_WRITE",
      projectWhitelist: [projectId],
    })
    .returning();
  const ctx: ToolCtx = {
    actor,
    token: {
      memberId: actor.memberId,
      tokenId: token!.id,
      tier: "READ_WRITE",
      projectWhitelist: [projectId],
    },
  };
  async function connect(c: ToolCtx) {
    const server = buildMcpServer(c),
      client = new Client({ name: "release-contract", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    return client;
  }
  const client = await connect(ctx),
    catalog = (await client.listTools()).tools,
    validator = new AjvJsonSchemaValidator();
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const r = await client.callTool({
        name,
        arguments: { projectId, releaseId, ...args },
      }),
      data = JSON.parse((r.content as { text: string }[])[0]!.text);
    assert.notEqual(r.isError, true, JSON.stringify(data));
    assert.equal(
      validator.getValidator(
        catalog.find((t) => t.name === name)!.outputSchema!,
      )(data).valid,
      true,
      name,
    );
    return data;
  }
  const next = (await (
    await import("../../src/server/services/planning.service.ts")
  ).createPlan(actor, projectId, "release", { name: "下个发布" }))!;
  const input = {
    releaseId: next.id,
    sourceId,
    testPlanIds: [testPlanId],
    commitSha: "c".repeat(40),
    build: "c".repeat(40),
    environment: "production",
    workflowIds: [7],
    expectedCandidateNumber: 0,
    userConfirmed: true,
    idempotencyKey: "candidate-contract",
  };
  try {
    await call("delivery.releaseGate", {});
    const candidate = await call<ReleaseCandidateView>(
      "delivery.createCandidate",
      input,
    );
    assert.equal(
      (await call<ReleaseCandidateView>("delivery.createCandidate", input)).id,
      candidate.id,
    );
    const feedback = {
      workItemId,
      sourceUrl: "https://example.com/feedback/sdk",
      conclusion: "SDK反馈原文",
      outcome: "FOLLOW_UP",
      userConfirmed: true,
      idempotencyKey: "feedback-contract",
    };
    const f = await call<ReleaseFeedbackView>(
      "delivery.recordFeedback",
      feedback,
    );
    assert.equal(
      (await call<ReleaseFeedbackView>("delivery.recordFeedback", feedback)).id,
      f.id,
    );
    for (const context of [
      {
        ...ctx,
        actor: {
          ...actor,
          permissions: new Set<string>(),
          rolePermissions: new Map(),
        },
      },
      { ...ctx, token: { ...ctx.token, tier: "READ_ONLY" as const } },
    ]) {
      const denied = await connect(context);
      try {
        assert.equal(
          (
            await denied.callTool({
              name: "delivery.createCandidate",
              arguments: { projectId, ...input },
            })
          ).isError,
          true,
        );
      } finally {
        await denied.close();
      }
    }
  } finally {
    await client.close();
  }
  const { registerReleaseGateRoutes } =
    await import("../../src/server/routes/release-gate.ts");
  const app = Fastify();
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async (req) => {
    req.actor = actor;
  });
  app.setErrorHandler((error, _req, reply) =>
    reply.status(400).send({ message: (error as Error).message }),
  );
  await registerReleaseGateRoutes(app);
  const base = `/api/v1/projects/${projectId}/delivery/releases/`;
  try {
    assert.equal((await app.inject({ url: base + releaseId })).statusCode, 200);
    const {
      userConfirmed: _c,
      idempotencyKey: _k,
      releaseId: _r,
      ...body
    } = input;
    const a = await app.inject({
        method: "POST",
        url: base + next.id + "/candidates",
        payload: { ...body, expectedCandidateNumber: 1 },
        headers: { "idempotency-key": "candidate-rest" },
      }),
      b = await app.inject({
        method: "POST",
        url: base + next.id + "/candidates",
        payload: { ...body, expectedCandidateNumber: 1 },
        headers: { "idempotency-key": "candidate-rest" },
      });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(a.json().id, b.json().id);
    const feedback = await app.inject({
      method: "POST",
      url: base + releaseId + "/feedback",
      payload: {
        workItemId,
        sourceUrl: "https://example.com/rest/feedback",
        conclusion: "REST回读",
        outcome: "RESOLVED",
      },
    });
    assert.equal(feedback.statusCode, 200, feedback.body);
  } finally {
    await app.close();
  }
}
