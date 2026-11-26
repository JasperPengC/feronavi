import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { Actor } from "../../src/server/permission/actor.ts";
import type { TokenContext } from "../../src/server/services/token.service.ts";
import type { RagExecutionResult } from "../../src/shared/rag-conversations.ts";

export async function verifyAgentExecutionContracts(actor: Actor, token: TokenContext, projectId: string, conversationId: string, workItemId: string) {
  const { buildMcpServer } = await import("../../src/server/mcp/server.ts");
  const { registerRagConversationRoutes } = await import("../../src/server/routes/rag-conversations.ts");
  const { getWorkItem } = await import("../../src/server/services/work-item.service.ts");
  const server = buildMcpServer({ actor, token }), client = new Client({ name: "agent-execution-contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const catalogue = (await client.listTools()).tools, validator = new AjvJsonSchemaValidator();
  async function call(name: string, args: Record<string, unknown>): Promise<RagExecutionResult> {
    const response = await client.callTool({ name, arguments: { conversationId, ...args, ...(name === "rag.conversation.execution" ? {} : { userConfirmed: true }) } });
    const value = JSON.parse((response.content as { text: string }[])[0]!.text);
    assert.notEqual(response.isError, true, JSON.stringify(value));
    assert.equal(validator.getValidator(catalogue.find(t => t.name === name)!.outputSchema!)(value).valid, true, name);
    return value;
  }
  const app = Fastify();
  app.decorateRequest("ragIdentity", undefined);
  app.setErrorHandler((error, _req, reply) => { const e = error as { httpStatus?: number; code?: string; message: string }; reply.status(e.httpStatus ?? 500).send({ code: e.code, message: e.message }); });
  registerRagConversationRoutes(app, async req => { req.ragIdentity = { actor, token, projectIds: [projectId], bearer: true }; }, async () => {});
  const base = `/api/v1/rag/conversations/${conversationId}`;
  try {
    const requestId = randomUUID(), original = await getWorkItem(actor, workItemId);
    const proposal = { requestId, title: "跨协议登记与修正", steps: [{ toolName: "workitem.update", parameters: { workItemId, expectedVersion: original.version, title: "协议修正前" } }] };
    const run = await call("rag.conversation.propose", proposal);
    assert.equal((await getWorkItem(actor, workItemId)).title, original.title);
    const first = run.execution.steps[0]!.stepId;
    const read = await app.inject({ url: `${base}/requests/${requestId}` });
    assert.equal(read.statusCode, 200); assert.equal(read.json().execution.steps[0].stepId, first);
    const replacementId = randomUUID();
    const revision = { replacementId, parameters: { workItemId, expectedVersion: original.version, title: "协议修正后" } };
    const revised = await call("rag.conversation.revise", { requestId, actionId: first, ...revision });
    const next = revised.message.reply!.actions!.find(s => s.supersedesId === first)!;
    const replay = await app.inject({ method: "POST", url: `${base}/requests/${requestId}/actions/${first}/revise`, payload: revision });
    assert.equal(replay.statusCode, 200); assert.equal(replay.json().execution.steps.length, 2);
    await call("rag.conversation.action", { requestId, actionId: next.id, decision: "confirm" });
    const result = await call("rag.conversation.execution", { requestId });
    assert.equal(result.execution.status, "VERIFIED");
    const current = await getWorkItem(actor, workItemId);
    assert.equal(current.title, "协议修正后"); assert.equal(current.version, original.version + 1);
    // REST 登记独立运行也不执行业务；同 ID 异内容必须冲突。
    const rest = { requestId: randomUUID(), title: "REST登记", steps: [{ toolName: "workitem.comment", parameters: { workItemId, body: "等待人工审阅" } }] };
    assert.equal((await app.inject({ method: "POST", url: `${base}/executions`, payload: rest })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `${base}/executions`, payload: { ...rest, title: "不同内容" } })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: `${base}/executions`, payload: { ...rest, requestId: randomUUID(), steps: Array(11).fill(rest.steps[0]) } })).statusCode, 400);
  } finally { await app.close(); await client.close(); }
}
