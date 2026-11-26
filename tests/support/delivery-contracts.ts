import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { verifyDeliveryPing } from "./delivery-ping.ts";
import type { Actor } from "../../src/server/permission/actor.ts";
import type { ToolCtx } from "../../src/server/mcp/tools.ts";
import type {
  DeliverySourceView,
  DeliveryEvidenceView,
} from "../../src/shared/schemas/delivery.ts";
export async function verifyDeliveryContracts(
  actor: Actor,
  projectId: string,
  foreignId: string,
  workItemId: string,
  integrationId: string,
) {
  const { db } = await import("../../src/db/index.ts"),
    { apiToken } = await import("../../src/db/schema.ts");
  const { buildMcpServer } = await import("../../src/server/mcp/server.ts");
  const [token] = await db
    .insert(apiToken)
    .values({
      memberId: actor.memberId,
      name: "交付协议",
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "delivery",
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
      client = new Client({ name: "delivery-contract", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    return client;
  }
  const client = await connect(ctx),
    catalog = (await client.listTools()).tools,
    validator = new AjvJsonSchemaValidator(),
    calls = new Set<string>();
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const r = await client.callTool({
        name,
        arguments: { projectId, ...args },
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
    calls.add(name);
    return data;
  }
  const secret = "protocol-webhook-secret-123456789";
  let source!: DeliverySourceView;
  try {
    const sourceArgs = {
      integrationId,
      expectedVersion: 3,
      webhookSecret: secret,
      userConfirmed: true,
      idempotencyKey: "source-contract",
    };
    source = await call("delivery.configureSource", sourceArgs);
    assert.equal(
      (await call<DeliverySourceView>("delivery.configureSource", sourceArgs))
        .id,
      source.id,
    );
    await call("delivery.sources", {});
    const create = {
      kind: "BUILD",
      title: "协议构建",
      repository: "acme/app",
      commitSha: "b".repeat(40),
      build: "protocol-build",
      status: "SUCCEEDED",
      url: "https://example.com/artifact",
      workItemIds: [workItemId],
      userConfirmed: true,
      idempotencyKey: "evidence-contract",
    };
    const item = await call<DeliveryEvidenceView>(
      "delivery.createEvidence",
      create,
    );
    assert.equal(item.verification, "SELF_REPORTED");
    assert.equal(
      (await call<DeliveryEvidenceView>("delivery.createEvidence", create)).id,
      item.id,
    );
    await call("delivery.listEvidence", {});
    await call("delivery.getEvidence", { evidenceId: item.id });
    await call("delivery.linkEvidence", {
      evidenceId: item.id,
      workItemIds: [workItemId],
      userConfirmed: true,
      idempotencyKey: "link-contract",
    });
    assert.equal(calls.size, 6);
    for (const [context, args, code] of [
      [
        {
          ...ctx,
          actor: {
            ...actor,
            permissions: new Set<string>(),
            rolePermissions: new Map(),
          },
        },
        create,
        "FORBIDDEN",
      ],
      [
        { ...ctx, token: { ...ctx.token, tier: "READ_ONLY" as const } },
        create,
        "FORBIDDEN",
      ],
      [ctx, { ...create, projectId: foreignId }, "NOT_FOUND"],
    ] as const) {
      const c = await connect(context);
      try {
        const r = await c.callTool({
          name: "delivery.createEvidence",
          arguments: { projectId, ...args },
        });
        assert.equal(r.isError, true);
        assert.equal(
          JSON.parse((r.content as { text: string }[])[0]!.text).code,
          code,
        );
      } finally {
        await c.close();
      }
    }
  } finally {
    await client.close();
  }
  const { registerDeliveryRoutes } =
    await import("../../src/server/routes/delivery.ts");
  const app = Fastify();
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async (req) => {
    if (!req.url.includes("/hooks/")) req.actor = actor;
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as { code?: string; message: string };
    reply
      .status(e.code === "FORBIDDEN" ? 403 : 400)
      .send({ code: e.code, message: e.message });
  });
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests++;
    return Response.json({
      id: 10,
      name: "CI",
      workflow_id: 7,
      head_sha: "b".repeat(40),
      run_attempt: 1,
      status: "completed",
      conclusion: "failure",
      updated_at: "2026-11-25T11:00:00Z",
      html_url: "https://github.com/acme/app/actions/runs/10",
      repository: { full_name: "acme/app" },
    });
  };
  await registerDeliveryRoutes(app, { fetchImpl });
  const base = `/api/v1/projects/${projectId}/delivery`;
  try {
    await verifyDeliveryPing(app, source.id, secret);
    assert.equal(requests, 0, "ping不能读取CI对象或生成可信交付结果");
    for (const path of ["/sources", "/evidence"])
      assert.equal((await app.inject({ url: base + path })).statusCode, 200);
    const payload = {
      kind: "CI",
      title: "REST证据",
      repository: "acme/app",
      commitSha: "a".repeat(40),
      build: "rest",
      status: "FAILED",
      url: "https://example.com/log",
      workItemIds: [workItemId],
    };
    const a = await app.inject({
        method: "POST",
        url: base + "/evidence",
        payload,
        headers: { "idempotency-key": "rest-delivery" },
      }),
      b = await app.inject({
        method: "POST",
        url: base + "/evidence",
        payload,
        headers: { "idempotency-key": "rest-delivery" },
      });
    assert.equal(a.statusCode, 201);
    assert.equal(a.json().id, b.json().id);
    assert.equal(
      (await app.inject({ url: base + "/evidence/" + a.json().id })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/evidence/" + a.json().id + "/links",
          payload: { workItemIds: [workItemId] },
        })
      ).statusCode,
      200,
    );
    const raw =
      '{ "repository": { "full_name": "acme/app" }, "workflow_run": { "id": 10 } }';
    const headers = {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "raw-bytes",
      "x-hub-signature-256":
        "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
    };
    const hook = "/api/v1/delivery/hooks/github/" + source.id;
    const r = await app.inject({
      method: "POST",
      url: hook,
      payload: raw,
      headers,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().replayed, false);
    assert.equal(requests, 1);
    const replay = await app.inject({
      method: "POST",
      url: hook,
      payload: raw,
      headers,
    });
    assert.equal(replay.json().replayed, true);
    assert.equal(requests, 1);
    const invalid = await app.inject({
      method: "POST",
      url: hook,
      payload: raw,
      headers: {
        ...headers,
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
      },
    });
    assert.equal(invalid.statusCode, 403);
    assert.equal(requests, 1);
  } finally {
    await app.close();
  }
  // 完整应用装配：无登录/无CSRF的已签名回执仍可重放，不发网络请求。
  await db
    .insert((await import("../../src/db/schema.ts")).organization)
    .values({ name: "交付协议实例" })
    .onConflictDoNothing();
  const full = await (
    await import("../../src/server/app.ts")
  ).buildApp({ logger: false });
  try {
    await verifyDeliveryPing(full, source.id, secret);
    const raw =
      '{ "repository": { "full_name": "acme/app" }, "workflow_run": { "id": 10 } }';
    const response = await full.inject({
      method: "POST",
      url: "/api/v1/delivery/hooks/github/" + source.id,
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": "raw-bytes",
        "x-hub-signature-256":
          "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().replayed, true);
    assert.equal(
      (await full.inject({ url: base + "/evidence" })).statusCode,
      403,
    );
  } finally {
    await full.close();
  }
}
