import "./_env.ts";
/** 已禁用外联能力：公开确认与历史排队任务均拒绝，故障和重启不重新外发。 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, sql as query } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, job, ragConversation } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as integrations from "../src/server/services/integration.service.ts";
import * as repo from "../src/server/repos/rag-conversation.repo.ts";
import { assistantRegistry } from "../src/server/services/assistant-tools.ts";
import { queueAssistantExternalAction, registerAssistantExternalActionJobs } from "../src/server/services/assistant-external-action.service.ts";
import { runJobWorkerOnce, claimBatch } from "../src/server/services/job.service.ts";
import { useLocalOutboundMock } from "../tests/support/local-outbound.ts";
import type { RagChatResult } from "../src/shared/rag.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import * as tokens from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";

await ensureInitialized();
let checks = 0, requests = 0;
let lockConversationId = "";
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; console.log(`OK ${label}`); };
const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
const [owner] = await db.insert(member).values({ username: "external-action-admin", email: "external-action@test.invalid", name: "外部执行管理员", status: "ACTIVE", passwordHash: "isolated-fixture" }).returning();
await db.insert(roleAssignment).values({ memberId: owner!.id, roleId: adminRole!.id, scopeType: "ORG" });
const actor = (await loadActor(owner!.id))!;
const httpToken = (await tokens.createToken(actor, { name: "外部动作HTTP确认", tier: "ADMIN" })).token;
const app = await buildApp({ logger: false });
const base = await app.listen({ port: 0, host: "127.0.0.1" });
const p = await projects.createProject(actor, { key: "EXTACT", name: "异步外部动作" });
const other = await projects.createProject(actor, { key: "EXTOTHER", name: "变更后的会话范围" });
const server = createServer(async (req, res) => {
  requests++;
  try {
    // NOWAIT 在另一连接上成功，证明外发期间没有持有会话行锁。
    await db.transaction(async tx => { await tx.execute(query`select id from rag_conversation where id=${lockConversationId} for update nowait`); });
    check(true, "供应商HTTP期间会话行锁已释放");
    res.writeHead(200, { "content-type": "application/json" }); res.end("[]");
  } catch { res.writeHead(500); res.end("fixture observed conversation lock"); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const restore = useLocalOutboundMock("https://1.1.1.1", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
registerAssistantExternalActionJobs();
let serial = 0;
async function prepare(token?: tokens.TokenContext) {
  const fixtureId = ++serial;
  const integration = await integrations.createIntegration(actor, { projectId: p.id, kind: "GITHUB", name: `异步同步${fixtureId}`, baseUrl: "https://1.1.1.1", token: "fixture-not-a-real-secret", config: { repo: `fixture/app${fixtureId}` } });
  check(!(await assistantRegistry()).some(t => /^(integration|webhook|im)\./u.test(t.name)), "外联能力不在助手公开目录");
  const action: import("../src/shared/rag.ts").RagActionProposal = {
    id: randomUUID(), toolName: "integration.sync", projectId: p.id, targetId: null, expectedVersion: null,
    parameters: { projectId: p.id, integrationId: integration.id }, status: "pending",
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const conversation = await repo.insertConversation({ ownerId: actor.memberId, projectId: p.id, title: "异步执行测试", titleIsDefault: false });
  const requestId = randomUUID();
  const reply: RagChatResult = { ok: true, answer: "待确认的外部同步", citations: [], mode: "none", scope: { projectIds: [p.id], projectCount: 1 }, actions: [action] };
  await repo.insertMessage({ conversationId: conversation.id, requestId, question: "同步集成", status: "completed", reply });
  const enqueue = async () => repo.withConversationLock(actor.memberId, conversation.id, async () => {
    const message = (await repo.findMessage(conversation.id, requestId))!;
    const saved = structuredClone(message.reply!);
    const queued = saved.actions![0]!;
    await queueAssistantExternalAction({ ownerId: actor.memberId, conversationId: conversation.id, requestId, action: queued, projectIds: [p.id], token });
    await repo.updateMessage(message.id, { reply: saved });
    return queued;
  });
  const confirmHttp = async () => {
    const response = await fetch(`${base}/api/v1/rag/conversations/${conversation.id}/requests/${requestId}/actions/${action.id}`, {
      method: "POST", headers: { authorization: `Bearer ${httpToken}`, "content-type": "application/json" }, body: JSON.stringify({ decision: "confirm" }),
    });
    assert.equal(response.status, 403, "真实HTTP拒绝执行已禁用工具的历史建议");
    const body = await response.json() as { code: string };
    assert.equal(body.code, "NOT_FOUND");
    return body;
  };
  return { conversation, requestId, action, enqueue, confirmHttp, read: async () => (await repo.findMessage(conversation.id, requestId))!.reply!.actions![0]! };
}
try {
  const historical = await prepare(); lockConversationId = historical.conversation.id;
  await historical.confirmHttp(); await historical.confirmHttp();
  check((await historical.read()).status === "pending", "重复HTTP确认不会恢复禁用工具或改写历史状态");
  const [count] = await sql`select count(*)::int as n from job where kind='assistant.external_action'`;
  check(count!.n === 0, "被拒确认不产生外联队列任务");
  check(requests === 0, "被拒确认没有供应商HTTP");

  // 模拟升级前已持久化的待执行任务，仍须在worker重新检查公开能力。
  const queued = await prepare(); lockConversationId = queued.conversation.id;
  await queued.enqueue(); await runJobWorkerOnce("external-action-test", 5);
  check((await queued.read()).status === "failed", "历史queued任务因能力禁用保存failed");
  check((await queued.read()).result?.value.code === "FORBIDDEN", "worker保存明确授权失败码");
  await runJobWorkerOnce("external-action-test", 5);
  check(requests === 0, "禁用能力及失败任务均不会外发或重试");

  const interrupted = await prepare(); const pending = await interrupted.enqueue();
  const claimed = (await claimBatch("crashed-worker", 5)).find(row => row.id === pending.result?.value.jobId)!;
  check(!!claimed && claimed.maxAttempts === 1, "外部任务只允许一次执行租约");
  await db.update(job).set({ lockedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(job.id, claimed.id));
  const beforeRecovery = requests; await runJobWorkerOnce("recovery-worker", 5);
  check((await interrupted.read()).status === "uncertain", "进程中断的过期租约持久化uncertain");
  check(requests === beforeRecovery, "恢复只复读状态，不自动再次外发");

  const moved = await prepare(); await moved.enqueue();
  await db.update(ragConversation).set({ projectId: other.id }).where(eq(ragConversation.id, moved.conversation.id));
  const beforeMoved = requests; await runJobWorkerOnce("external-action-test", 5);
  check((await moved.read()).status === "failed", "worker重新验证当前会话项目范围");
  check(requests === beforeMoved, "会话范围变化时禁止外发");
  const apiToken = await tokens.createToken(actor, { name: "异步撤权", tier: "READ_WRITE", projectWhitelist: [p.id] });
  const revoked = await prepare({ tokenId: apiToken.row.id, memberId: actor.memberId, tier: "READ_WRITE", projectWhitelist: [p.id] });
  await revoked.enqueue(); await tokens.revokeToken(actor, apiToken.row.id);
  const beforeRevoked = requests; await runJobWorkerOnce("external-action-test", 5);
  check((await revoked.read()).status === "failed", "worker重新验证令牌仍有效");
  check(requests === beforeRevoked, "确认后撤销令牌不得外发");
  console.log(`结果：${checks}断言通过；${requests}次本地供应商HTTP；无真实外部请求。`);
} finally {
  restore(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await app.close(); await closeCache(); await sql.end();
}
