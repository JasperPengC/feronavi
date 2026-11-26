import assert from "node:assert/strict";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Actor } from "../../src/server/permission/actor.ts";
import type { ToolCtx } from "../../src/server/mcp/tools.ts";
import type {
  TestPlanDetail,
  TestRunDetail,
  TestRunDefectResult,
  TestPlanReport,
} from "../../src/shared/schemas/test-execution.ts";
export async function verifyExecutionContracts(
  actor: Actor,
  denied: Actor,
  projectId: string,
  foreignId: string,
  caseId: string,
  revisionId: string,
) {
  const { db } = await import("../../src/db/index.ts"),
    { apiToken } = await import("../../src/db/schema.ts");
  const { buildMcpServer } = await import("../../src/server/mcp/server.ts");
  const [token] = await db
    .insert(apiToken)
    .values({
      memberId: actor.memberId,
      name: "执行协议测试",
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "exec",
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
      client = new Client({ name: "execution-contract", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    return client;
  }
  const client = await connect(ctx),
    validator = new AjvJsonSchemaValidator(),
    catalog = (await client.listTools()).tools,
    calls = new Set<string>();
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const r = await client.callTool({
      name,
      arguments: { projectId, ...args },
    });
    const data = JSON.parse((r.content as { text: string }[])[0]!.text);
    assert.notEqual(r.isError, true, `${name}: ${JSON.stringify(data)}`);
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
  let plan!: TestPlanDetail, run!: TestRunDetail;
  try {
    const create = {
      title: "协议回归",
      build: "protocol-build",
      environment: "isolated",
      cases: [{ caseId, revisionId }],
      userConfirmed: true,
      idempotencyKey: "plan-once",
    };
    plan = await call("testPlan.create", create);
    assert.equal(
      (await call<TestPlanDetail>("testPlan.create", create)).id,
      plan.id,
    );
    await call("testPlan.list", {});
    await call("testPlan.get", { planId: plan.id });
    plan = await call("testPlan.update", {
      planId: plan.id,
      title: "协议完整回归",
      expectedVersion: plan.version,
      userConfirmed: true,
    });
    plan = await call("testPlan.transition", {
      planId: plan.id,
      action: "START",
      expectedVersion: plan.version,
      userConfirmed: true,
      idempotencyKey: "plan-start",
    });
    const start = {
      planId: plan.id,
      planCaseId: plan.cases[0]!.id,
      source: "AUTOMATION",
      sourceReference: "isolated-contract-test",
      userConfirmed: true,
      idempotencyKey: "run-once",
    };
    run = await call("testRun.start", start);
    assert.equal(
      (await call<TestRunDetail>("testRun.start", start)).id,
      run.id,
    );
    await call("testRun.get", { runId: run.id });
    const record = {
      runId: run.id,
      expectedVersion: run.version,
      results: [
        {
          stepIndex: 0,
          status: "FAILED",
          actual: "协议fixture模拟失败",
          evidence: [],
        },
      ],
      userConfirmed: true,
      idempotencyKey: "record-once",
    };
    run = await call("testRun.record", record);
    assert.equal(
      (await call<TestRunDetail>("testRun.record", record)).version,
      run.version,
    );
    const complete = {
      runId: run.id,
      expectedVersion: run.version,
      userConfirmed: true,
      idempotencyKey: "complete-once",
    };
    run = await call("testRun.complete", complete);
    assert.equal(
      (await call<TestRunDetail>("testRun.complete", complete)).version,
      run.version,
    );
    const defect = await call<TestRunDefectResult>("testRun.createDefect", {
      runId: run.id,
      title: "协议fixture缺陷",
      userConfirmed: true,
      idempotencyKey: "defect-once",
    });
    await call("testRun.linkDefect", {
      runId: run.id,
      defectId: defect.defect.id,
      userConfirmed: true,
    });
    const report = await call<TestPlanReport>("testPlan.report", {
      planId: plan.id,
    });
    assert.equal(report.totalAttempts, 1);
    assert.equal(report.allAttempts.FAILED, 1);
    assert.equal(report.passed, false);
    assert.equal(calls.size, 12, "全部执行域工具应通过真实SDK和输出合同");
    for (const [context, args, code] of [
      [
        {
          ...ctx,
          actor: {
            ...actor,
            permissions: new Set<string>(),
            rolePermissions: new Map<string, ReadonlySet<string>>(),
          },
        },
        complete,
        "FORBIDDEN",
      ],
      [
        { ...ctx, token: { ...ctx.token, tier: "READ_ONLY" as const } },
        complete,
        "FORBIDDEN",
      ],
      [ctx, { ...complete, projectId: foreignId }, "NOT_FOUND"],
    ] as const) {
      const restricted = await connect(context);
      try {
        const r = await restricted.callTool({
          name: "testRun.complete",
          arguments: { projectId, ...args },
        });
        assert.equal(r.isError, true);
        assert.equal(
          JSON.parse((r.content as { text: string }[])[0]!.text).code,
          code,
        );
      } finally {
        await restricted.close();
      }
    }
  } finally {
    await client.close();
  }
  const { registerTestExecutionRoutes } =
    await import("../../src/server/routes/test-execution.ts");
  const app = Fastify();
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async (req) => {
    req.actor = req.headers["x-denied"] ? denied : actor;
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as { code?: string; message: string };
    reply
      .status(e.code === "FORBIDDEN" ? 403 : 400)
      .send({ code: e.code, message: e.message });
  });
  await registerTestExecutionRoutes(app);
  const base = `/api/v1/projects/${projectId}/testing`;
  try {
    for (const path of [
      "/plans",
      `/plans/${plan.id}`,
      `/plans/${plan.id}/report`,
      `/runs/${run.id}`,
    ])
      assert.equal(
        (await app.inject({ method: "GET", url: base + path })).statusCode,
        200,
        path,
      );
    const payload = {
      title: "REST幂等",
      build: "rest",
      environment: "isolated",
      cases: [{ caseId, revisionId }],
    };
    const req = {
      method: "POST" as const,
      url: base + "/plans",
      payload,
      headers: { "idempotency-key": "rest-plan" },
    };
    const created = await app.inject(req);
    assert.equal(created.statusCode, 201);
    assert.equal((await app.inject(req)).json().id, created.json().id);
    assert.equal(
      (
        await app.inject({
          ...req,
          headers: { ...req.headers, "x-denied": "1" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: base + "/plans",
          headers: { "x-denied": "1" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
}
