import assert from "node:assert/strict";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Actor } from "../../src/server/permission/actor.ts";
import type {
  TestCaseDetail,
  TestSuite,
} from "../../src/shared/schemas/test-management.ts";
import type { ToolCtx } from "../../src/server/mcp/tools.ts";
export async function verifyTestCaseContracts(
  actor: Actor,
  denied: Actor,
  projectId: string,
  foreignId: string,
) {
  const { db } = await import("../../src/db/index.ts"),
    { apiToken } = await import("../../src/db/schema.ts");
  const { buildMcpServer } = await import("../../src/server/mcp/server.ts");
  const [token] = await db
    .insert(apiToken)
    .values({
      memberId: actor.memberId,
      name: "用例协议测试",
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "test_case",
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
  async function connect(context: ToolCtx) {
    const server = buildMcpServer(context),
      client = new Client({ name: "case-library-contract", version: "1" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    return client;
  }
  const client = await connect(ctx),
    validator = new AjvJsonSchemaValidator();
  const catalog = (await client.listTools()).tools;
  const calls = new Set<string>();
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
    clientOverride = client,
  ): Promise<T> {
    const result = await clientOverride.callTool({
        name,
        arguments: { projectId, ...args },
      }),
      data = JSON.parse((result.content as { text: string }[])[0]!.text);
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(data)}`);
    assert.equal(
      validator.getValidator(
        catalog.find((t) => t.name === name)!.outputSchema!,
      )(data).valid,
      true,
      name,
    );
    calls.add(name);
    return data as T;
  }
  async function rejected(
    context: ToolCtx,
    args: Record<string, unknown>,
    code: string,
  ) {
    const restricted = await connect(context);
    try {
      const result = await restricted.callTool({
        name: "testCase.create",
        arguments: args,
      });
      assert.equal(result.isError, true);
      assert.equal(
        JSON.parse((result.content as { text: string }[])[0]!.text).code,
        code,
      );
    } finally {
      await restricted.close();
    }
  }
  try {
    let suite = await call<TestSuite>("testSuite.create", {
      name: "协议套件",
      userConfirmed: true,
      idempotencyKey: "suite-once",
    });
    assert.equal(
      (
        await call<TestSuite>("testSuite.create", {
          name: "协议套件",
          userConfirmed: true,
          idempotencyKey: "suite-once",
        })
      ).id,
      suite.id,
    );
    await call("testSuite.list", {});
    await call("testSuite.get", { suiteId: suite.id });
    suite = await call<TestSuite>("testSuite.update", {
      suiteId: suite.id,
      name: "协议回归套件",
      expectedVersion: suite.version,
      userConfirmed: true,
    });
    const args = {
      projectId,
      title: "协议写入用例",
      suiteId: suite.id,
      status: "READY",
      steps: [{ action: "调用工具", expected: "回读一致" }],
      userConfirmed: true,
      idempotencyKey: "case-once",
    };
    let item = await call<TestCaseDetail>("testCase.create", args);
    assert.equal(
      (await call<TestCaseDetail>("testCase.create", args)).id,
      item.id,
    );
    await call("testCase.list", {});
    await call("testCase.get", { caseId: item.id });
    await call("testCase.revisions", { caseId: item.id });
    await call("testCase.getRevision", {
      caseId: item.id,
      revisionId: item.currentRevisionId,
    });
    item = await call<TestCaseDetail>("testCase.update", {
      caseId: item.id,
      expectedVersion: item.version,
      title: "协议已更新用例",
      userConfirmed: true,
    });
    assert.equal(item.revisionNo, 2);
    assert.equal(calls.size, 10);
    await rejected(
      {
        ...ctx,
        actor: { ...actor, permissions: new Set(), rolePermissions: new Map() },
      },
      args,
      "FORBIDDEN",
    );
    await rejected(
      { ...ctx, token: { ...ctx.token, tier: "READ_ONLY" } },
      args,
      "FORBIDDEN",
    );
    await rejected(
      ctx,
      { ...args, userConfirmed: false },
      "COMMAND_CONFIRMATION_REQUIRED",
    );
    await rejected(
      { ...ctx, token: { ...ctx.token, projectWhitelist: [foreignId] } },
      args,
      "NOT_FOUND",
    );
  } finally {
    await client.close();
  }
  const app = Fastify();
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async (req) => {
    req.actor = req.headers["x-denied"] ? denied : actor;
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as { httpStatus?: number; code?: string };
    reply.status(e.httpStatus ?? 500).send({ code: e.code });
  });
  await (
    await import("../../src/server/routes/test-management.ts")
  ).registerTestManagementRoutes(app);
  try {
    const base = `/api/v1/projects/${projectId}/testing`;
    const created = await app.inject({
      method: "POST",
      url: base + "/cases",
      payload: { title: "REST用例" },
    });
    assert.equal(created.statusCode, 201);
    const item = created.json();
    for (const path of [
      "/suites",
      `/cases`,
      `/cases/${item.id}`,
      `/cases/${item.id}/revisions`,
      `/cases/${item.id}/revisions/${item.currentRevisionId}`,
    ])
      assert.equal(
        (await app.inject({ method: "GET", url: base + path })).statusCode,
        200,
        path,
      );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: base + `/cases/${item.id}`,
          payload: { expectedVersion: item.version, title: "REST更新" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: base + "/cases",
          headers: { "x-denied": "1" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
}
