import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assertIsolatedTestEnvironment } from "../../scripts/test-environment.mjs";
assertIsolatedTestEnvironment();
const { ensureInitialized } = await import("../../scripts/_test-helpers.ts");
await ensureInitialized();
const { db, sql } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const work = await import("../../src/server/services/work-item.service.ts");
const conv = await import("../../src/server/services/rag-conversation.service.ts");
const proposal = await import("../../src/server/services/agent-proposal.service.ts");
const tokens = await import("../../src/server/services/token.service.ts");
try {
  const [r] = await db.select().from(s.role).where(eq(s.role.key, "ADMIN"));
  const [owner, stranger] = await db.insert(s.member).values([
    { username: "agent-execution-owner", name: "执行验收", passwordHash: "isolated-no-login", status: "ACTIVE" },
    { username: "agent-execution-stranger", name: "另一账号", passwordHash: "isolated-no-login", status: "ACTIVE" },
  ]).returning();
  await db.insert(s.roleAssignment).values([owner!, stranger!].map(m => ({ memberId: m.id, roleId: r!.id, scopeType: "ORG", scopeId: null })));
  const actor = (await loadActor(owner!.id))!, other = (await loadActor(stranger!.id))!;
  const p = await createProject(actor, { key: "AGENTRUN", name: "执行闭环" });
  const conversation = await conv.createConversation(actor, { projectId: p.id, title: "接管验收" });
  const task = await work.createWorkItem(actor, p.id, { type: "TASK", title: "原任务" });
  const input = { requestId: randomUUID(), title: "两步业务", steps: [
    { toolName: "workitem.update", parameters: { workItemId: task.id, expectedVersion: task.version, title: "第一步" } },
    { toolName: "workitem.comment", parameters: { workItemId: task.id, body: "第二步结论" } },
  ] };
  const [one, same] = await Promise.all([proposal.proposeExecution(actor, conversation.id, input), proposal.proposeExecution(actor, conversation.id, input)]);
  assert.deepEqual(one.execution.steps.map(s => s.stepId), same.execution.steps.map(s => s.stepId));
  assert.equal((await work.getWorkItem(actor, task.id)).title, "原任务", "登记不能执行");
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, { ...input, title: "不同请求" }), { code: "CONFLICT" });
  await assert.rejects(conv.getExecution(other, conversation.id, input.requestId), { code: "NOT_FOUND" });
  const [a, b] = one.message.reply!.actions!;
  await conv.decideAction(actor, conversation.id, input.requestId, a!.id, "confirm");
  await assert.rejects(conv.decideAction(actor, conversation.id, input.requestId, b!.id, "confirm"), { code: "CONFLICT" });
  const partial = await conv.getExecution(actor, conversation.id, input.requestId);
  assert.equal(partial.execution.status, "PARTIAL");
  assert.equal(partial.execution.verifiedCount, 1);
  assert.equal(partial.execution.steps[1]!.status, "FAILED", "冲突原因在刷新后保留");
  assert.equal(partial.message.reply!.actions![1]!.lastFailure?.code, "CONFLICT");
  const revise = { replacementId: randomUUID(), parameters: { workItemId: task.id, body: "经当前任务复核的第二步结论" } };
  const corrected = await proposal.reviseExecutionAction(actor, conversation.id, input.requestId, b!.id, revise);
  const replacement = corrected.message.reply!.actions!.find(x => x.supersedesId === b!.id)!;
  assert.ok(replacement);
  const correctedAgain = await proposal.reviseExecutionAction(actor, conversation.id, input.requestId, b!.id, revise);
  assert.equal(correctedAgain.message.reply!.actions!.length, 3);
  await assert.rejects(proposal.reviseExecutionAction(actor, conversation.id, input.requestId, a!.id, revise), { code: "CONFLICT" });
  await conv.decideAction(actor, conversation.id, input.requestId, replacement.id, "confirm");
  await conv.decideAction(actor, conversation.id, input.requestId, a!.id, "confirm");
  assert.equal((await work.getWorkItem(actor, task.id)).version, task.version + 1);
  const [count] = await sql`select count(*)::int n from comment where target_id=${task.id}`;
  assert.equal(count!.n, 1);
  assert.equal((await conv.getExecution(actor, conversation.id, input.requestId)).execution.status, "VERIFIED");
  const before = await sql`select count(*)::int n from rag_message where conversation_id=${conversation.id}`;
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, { requestId: randomUUID(), title: "拒绝注入", steps: [input.steps[1]!, { toolName: "system.updateSettings", parameters: {} }] }));
  assert.deepEqual(await sql`select count(*)::int n from rag_message where conversation_id=${conversation.id}`, before);
  const credential = await tokens.createToken(actor, { name: "execution-test", tier: "READ_WRITE", projectWhitelist: [p.id] });
  const authenticated = await tokens.authenticateToken(credential.token, null);
  assert.ok(authenticated);
  const token = authenticated.ctx;
  await conv.getExecution(actor, conversation.id, input.requestId, [p.id], token);
  const foreignCredential = await tokens.createToken(other, { name: "foreign", tier: "READ_WRITE" });
  const foreign = (await tokens.authenticateToken(foreignCredential.token, null))!.ctx;
  await assert.rejects(conv.getExecution(actor, conversation.id, input.requestId, [p.id], foreign), { code: "FORBIDDEN" });
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, { ...input, requestId: randomUUID() }, [p.id], foreign), { code: "FORBIDDEN" });
  await db.update(s.apiToken).set({ tier: "READ_ONLY" }).where(eq(s.apiToken.id, token.tokenId));
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, input, [p.id], token), { code: "FORBIDDEN" });
  await db.update(s.apiToken).set({ tier: "READ_WRITE" }).where(eq(s.apiToken.id, token.tokenId));
  const outside = await createProject(actor, { key: "AGENTOUT", name: "其他项目" });
  const outsideTask = await work.createWorkItem(actor, outside.id, { type: "TASK", title: "范围外" });
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, { requestId: randomUUID(), title: "跨项目", steps: [{ toolName: "workitem.comment", parameters: { workItemId: outsideTask.id, body: "不能写入" } }] }));
  for (const key of ["userConfirmed", "idempotencyKey"]) {
    await assert.rejects(proposal.proposeExecution(actor, conversation.id, { requestId: randomUUID(), title: "注入确认", steps: [{ ...input.steps[1]!, parameters: { ...input.steps[1]!.parameters, [key]: true } }] }), { code: "VALIDATION" });
  }
  await db.insert(s.mcpToolPolicy).values({ tokenId: token.tokenId, toolName: "workitem.comment", effect: "DENY" });
  await assert.rejects(conv.getExecution(actor, conversation.id, input.requestId, [p.id], token), { code: "FORBIDDEN" });
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, { ...input, requestId: randomUUID(), steps: [input.steps[1]!] }, [p.id], token), { code: "FORBIDDEN" });
  await db.delete(s.mcpToolPolicy).where(eq(s.mcpToolPolicy.tokenId, token.tokenId));
  const { verifyAgentExecutionContracts } = await import("./agent-execution-contracts.ts");
  await verifyAgentExecutionContracts(actor, token, p.id, conversation.id, task.id);
  await db.update(s.apiToken).set({ revokedAt: new Date() }).where(eq(s.apiToken.id, token.tokenId));
  await assert.rejects(conv.getExecution(actor, conversation.id, input.requestId, [p.id], token), { code: "FORBIDDEN" });
  await assert.rejects(proposal.proposeExecution(actor, conversation.id, { ...input, requestId: randomUUID() }, [p.id], token), { code: "FORBIDDEN" });
  console.log("agent execution passed");
} finally { await sql.end({ timeout: 5 }); }
