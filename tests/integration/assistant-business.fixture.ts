import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RagActionProposal, RagChatResult } from "../../src/shared/rag.ts";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, ragMessage, milestone, pagePermission, apiToken, mcpToolPolicy } = await import("../../src/db/schema.ts");
const { eq, and } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const planning = await import("../../src/server/services/planning.service.ts");
const wiki = await import("../../src/server/services/wiki.service.ts");
const comments = await import("../../src/server/services/comment.service.ts");
const workItems = await import("../../src/server/services/work-item.service.ts");
const { closeCache } = await import("../../src/server/auth/cache.ts");
const { ensureInitialized } = await import("../../scripts/_test-helpers.ts");
const assistant = await import("../../src/server/services/assistant-tools.ts");
const conversations = await import("../../src/server/services/rag-conversation.service.ts");
const { assertAssistantReplyReadable } = await import("../../src/server/services/assistant-access.ts");
const { collectAssistantResources } = await import("../../src/server/services/assistant-projection.ts");
const { createToken, authenticateToken } = await import("../../src/server/services/token.service.ts");
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${(error as Error).message}`); }
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: "assistant-business", name: "Assistant", passwordHash: "no-login", status: "ACTIVE", mustChangePassword: false }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const project = await createProject(actor, { key: "ASSISTBUS", name: "助手业务" });
  const other = await createProject(actor, { key: "ASSISTOTHER", name: "范围外项目" });
  const access = { actor, projectIds: [project.id], check: async () => {} };
  const registry = await assistant.assistantRegistry();
  const tool = (name: string) => { const found = registry.find(t => t.name === name); assert.ok(found, `missing tool ${name}`); return found; };
  const propose = (name: string, args: Record<string, unknown>) => assistant.proposeAssistantAction(access, tool(name), args);
  const conversation = await conversations.createConversation(actor, { projectId: project.id });
  const save = async (action: RagActionProposal, artifactIds?: string[]) => (await db.insert(ragMessage).values({
    conversationId: conversation.id, requestId: randomUUID(), question: "建议", status: "completed",
    ...(artifactIds ? { requestMetadata: { artifactIds } } : {}),
    reply: { ok: true, answer: "请确认", citations: [], mode: "none", scope: { projectIds: [project.id], projectCount: 1 }, actions: [action] },
  }).returning())[0]!;
  const decide = (message: typeof ragMessage.$inferSelect, action: RagActionProposal, decision: "confirm" | "reject" = "confirm") => conversations.decideAction(actor, conversation.id, message.requestId, action.id, decision);

  await check("workflow tools have explicit confirmation contracts and keep secrets outside model schemas", async () => {
    for (const name of ["page.list", "page.revisions", "workitem.comments", "workitem.children", "plan.getIteration", "plan.getRelease", "plan.listModules", "plan.getModule", "plan.createMilestone", "plan.updateMilestone", "plan.createIteration", "plan.updateIteration", "plan.createRelease", "plan.updateRelease", "plan.createModule", "plan.updateModule", "page.create", "page.update", "workitem.comment", "comment.update"]) tool(name);
    const { ASSISTANT_CLOSURE_POLICIES } = await import("../../src/server/services/assistant-closure.ts");
    const { ASSISTANT_WORKFLOW_CONTRACTS } = await import("../../src/server/services/assistant-workflow-contracts.ts");
    const { assistantInputSchema } = await import("../../src/server/services/assistant-model-tools.ts");
    for (const entry of registry.filter(t => t.kind === "write")) {
      assert.ok(ASSISTANT_CLOSURE_POLICIES[entry.name] || ASSISTANT_WORKFLOW_CONTRACTS[entry.name] || ["workitem.create", "workitem.update", "workitem.transition", "workitem.assign", "workitem.comment", "comment.update", "page.create", "page.update", "plan.createMilestone", "plan.updateMilestone", "plan.createIteration", "plan.updateIteration", "plan.createRelease", "plan.updateRelease", "plan.createModule", "plan.updateModule"].includes(entry.name), `missing confirmation contract ${entry.name}`);
    }
    assert.ok(registry.every(t => !/^(?:workitem\.delete$|page\.delete$|idea\.delete$|token\.|system\.|backup\.)/u.test(t.name)));
    for (const name of ["attachment.upload", "import.create"]) {
      const properties = assistantInputSchema(tool(name)).properties!;
      assert.equal(Object.hasOwn(properties, "token"), false);
      assert.equal(Object.hasOwn(properties, "contentBase64"), false);
      assert.ok(Object.hasOwn(properties, "artifactId"));
      assert.equal(Object.hasOwn(properties, "dataBase64"), false);
      assert.equal(Object.hasOwn(properties, "userConfirmed"), false);
    }
    assert.ok(registry.every(t => !/^(integration|webhook|im)\./u.test(t.name)));
    await assert.rejects(propose("plan.createMilestone", { projectId: project.id, name: "self-confirm", userConfirmed: true }), { code: "VALIDATION" });
    await assert.rejects(propose("plan.createMilestone", { projectId: other.id, name: "escape" }), { code: "NOT_FOUND" });
  });
  await check("controlled attachment confirmation maps server file bytes and rejects scope, confirmation and size tampering", async () => {
    const files = await import("../../src/server/services/assistant-artifact.service.ts");
    const attachments = await import("../../src/server/services/attachment.service.ts");
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "附件确认" }))!;
    const file = await files.createAssistantFile(actor, { filename: "confirmed.txt", mimeType: "text/plain", data: Buffer.from("服务器受控附件"), projectIds: [project.id] });
    const scopedAccess = { ...access, artifactIds: [file.artifactId] };
    const args = { workItemId: item.id, originalName: "confirmed.txt", mimeType: "text/plain", artifactId: file.artifactId };
    await assert.rejects(assistant.proposeAssistantAction(scopedAccess, tool("attachment.upload"), { ...args, userConfirmed: true }), { code: "VALIDATION" });
    await assert.rejects(assistant.proposeAssistantAction(scopedAccess, tool("attachment.upload"), { ...args, dataBase64: Buffer.from("tampered").toString("base64") }), { code: "VALIDATION" });
    await assert.rejects(assistant.proposeAssistantAction(access, tool("attachment.upload"), args), { code: "FORBIDDEN" });
    const action = await assistant.proposeAssistantAction(scopedAccess, tool("attachment.upload"), args);
    assert.equal((await attachments.listAttachments(actor, "WORK_ITEM", item.id)).length, 0);
    assert.equal(JSON.stringify(action).includes(Buffer.from("服务器受控附件").toString("base64")), false);
    const message = await save(action, [file.artifactId]);
    await decide(message, action); await decide(message, action);
    const stored = await attachments.listAttachments(actor, "WORK_ITEM", item.id);
    assert.equal(stored.length, 1);
    assert.equal((await attachments.download(actor, stored[0]!.id)).data.toString(), "服务器受控附件");
    const download = await assistant.executeAssistantTool(access, tool("attachment.download"), { attachmentId: stored[0]!.id });
    assert.equal((download.value as { sizeBytes: number }).sizeBytes, Buffer.byteLength("服务器受控附件"));
    assert.equal(JSON.stringify(download.value).includes("dataBase64"), false);
    const foreign = await files.createAssistantFile(actor, { filename: "foreign.txt", mimeType: "text/plain", data: Buffer.from("foreign"), projectIds: [other.id] });
    await assert.rejects(assistant.proposeAssistantAction({ ...access, artifactIds: [foreign.artifactId] }, tool("attachment.upload"), { ...args, originalName: "foreign.txt", artifactId: foreign.artifactId }), { code: "NOT_FOUND" });
    const large = await files.createAssistantFile(actor, { filename: "large.txt", mimeType: "text/plain", data: Buffer.alloc(512 * 1024 + 1, 65), projectIds: [project.id] });
    await assert.rejects(assistant.proposeAssistantAction({ ...access, artifactIds: [large.artifactId] }, tool("attachment.upload"), { ...args, originalName: "large.txt", artifactId: large.artifactId }), { code: "VALIDATION" });
    assert.equal((await attachments.listAttachments(actor, "WORK_ITEM", item.id)).length, 1);
  });
  await check("plan proposal carries generic fingerprint and reject never mutates", async () => {
    const plan = (await planning.createPlan(actor, project.id, "milestone", { name: "before" }))!;
    const action = await propose("plan.updateMilestone", { milestoneId: plan.id, name: "rejected" });
    assert.equal(action.target?.kind, "milestone");
    assert.match(action.target!.fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal((await planning.get(actor, plan.id, "milestone")).name, "before");
    const message = await save(action);
    await decide(message, action, "reject"); await decide(message, action);
    assert.equal((await planning.get(actor, plan.id, "milestone")).name, "before");
  });
  await check("unversioned planning edits invalidate a pending confirmation", async () => {
    const plan = (await planning.createPlan(actor, project.id, "iteration", { name: "before", startDate: "2026-11-01", endDate: "2026-12-01" }))!;
    const action = await propose("plan.updateIteration", { iterationId: plan.id, name: "stale" });
    const message = await save(action);
    await planning.updatePlan(actor, plan.id, "iteration", { name: "external" });
    await assert.rejects(decide(message, action), { code: "CONFLICT" });
    assert.equal((await planning.get(actor, plan.id, "iteration")).name, "external");
  });
  await check("page revision guarded confirmation stores reread result and concurrent replay writes once", async () => {
    const page = await wiki.createPage(actor, project.id, { title: "page-before", content: "before" });
    const action = await propose("page.update", { pageId: page.id, expectedRevisionId: page.currentRevisionId, content: "confirmed" });
    assert.equal(action.target?.kind, "page");
    const message = await save(action);
    const results = await Promise.all([decide(message, action), decide(message, action), decide(message, action)]);
    assert.ok(results.every(r => r.message.reply?.actions?.[0]?.status === "confirmed"));
    const current = await wiki.getPage(actor, page.id);
    assert.equal(current.content, "confirmed"); assert.equal(current.revisionNo, 2);
    const result = results[0]!.message.reply!.actions![0]!.result!;
    assert.deepEqual(result.resources, [{ kind: "page", id: page.id }]);
    assert.equal((result.value as { content: string }).content, "confirmed");
    await assert.rejects(propose("page.update", { pageId: page.id, expectedRevisionId: page.currentRevisionId, content: "stale" }), { code: "CONFLICT" });
  });
  await check("confirmed plan creation rereads result and never duplicates on retry", async () => {
    const action = await propose("plan.createMilestone", { projectId: project.id, name: "create-once", idempotencyKey: "model-collision" });
    const message = await save(action);
    const first = await decide(message, action); const replay = await decide(message, action);
    const result = first.message.reply!.actions![0]!.result!;
    assert.equal(result.resources[0]?.kind, "milestone");
    assert.equal((result.value as { name: string }).name, "create-once");
    assert.deepEqual(replay.message.reply!.actions![0]!.result, result);
    const created = await db.select().from(milestone).where(and(eq(milestone.projectId, project.id), eq(milestone.name, "create-once")));
    assert.equal(created.length, 1);
    const another = await propose("plan.createMilestone", { projectId: project.id, name: "create-another", idempotencyKey: "model-collision" });
    const second = await decide(await save(another), another);
    assert.equal((second.message.reply!.actions![0]!.result!.value as { name: string }).name, "create-another");
  });
  await check("comment parents resolve as comments and stale comment edits are refused", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "discussion" }))!;
    const parent = (await comments.createComment(actor, { targetType: "WORK_ITEM", targetId: item.id, body: "parent" }))!;
    const action = await propose("workitem.comment", { workItemId: item.id, parentId: parent.id, body: "confirmed reply" });
    const result = await decide(await save(action), action);
    assert.equal(result.message.reply!.actions![0]!.result!.resources[0]?.kind, "comment");
    const replies = await comments.listComments(actor, "WORK_ITEM", item.id, { parentId: parent.id });
    assert.equal(replies.length, 1); assert.equal(replies[0]!.body, "confirmed reply");
    const edit = await propose("comment.update", { commentId: parent.id, body: "stale" });
    const message = await save(edit);
    await comments.updateComment(actor, parent.id, "external");
    await assert.rejects(decide(message, edit), { code: "CONFLICT" });
  });
  await check("page list and comment evidence is hidden after parent document ACL revocation", async () => {
    const page = await wiki.createPage(actor, project.id, { title: "restricted", content: "secret", visibility: "RESTRICTED" });
    const comment = (await comments.createComment(actor, { targetType: "PAGE", targetId: page.id, body: "secret comment" }))!;
    const resources = collectAssistantResources("page.list", { pages: [page] }, project.id);
    assert.deepEqual(resources, [{ kind: "page", id: page.id }]);
    const pending = await propose("page.update", { pageId: page.id, expectedRevisionId: page.currentRevisionId, content: "must-not-write" });
    const pendingMessage = await save(pending);
    const reply: RagChatResult = { ok: true, answer: "secret", citations: [], mode: "none", scope: { projectIds: [project.id], projectCount: 1 }, evidence: [{ id: randomUUID(), toolName: "page.list", projectId: project.id, observedAt: new Date().toISOString(), summary: "secret", resources: [...resources, { kind: "comment", id: comment.id }] }] };
    await assertAssistantReplyReadable(actor, reply, [project.id]);
    const [saved] = await db.insert(ragMessage).values({ conversationId: conversation.id, requestId: randomUUID(), question: "secret", status: "completed", reply }).returning();
    await db.delete(pagePermission).where(eq(pagePermission.pageId, page.id));
    await assert.rejects(decide(pendingMessage, pending), { code: "FORBIDDEN" });
    await assert.rejects(assertAssistantReplyReadable(actor, reply, [project.id]));
    const commentOnly = structuredClone(reply); commentOnly.evidence![0]!.resources = [{ kind: "comment", id: comment.id }];
    await assert.rejects(assertAssistantReplyReadable(actor, commentOnly, [project.id]));
    const history = await conversations.getConversation(actor, conversation.id);
    assert.equal(history.messages.find(row => row.id === saved!.id)?.reply, null);
  });
  await check("latest account write role is checked again at confirmation", async () => {
    const plan = (await planning.createPlan(actor, project.id, "milestone", { name: "role-before" }))!;
    const action = await propose("plan.updateMilestone", { milestoneId: plan.id, name: "must-not-write" });
    const message = await save(action);
    const [guest] = await db.select().from(role).where(eq(role.key, "GUEST"));
    await db.insert(roleAssignment).values({ memberId: actor.memberId, roleId: guest!.id, scopeType: "ORG" });
    await db.delete(roleAssignment).where(and(eq(roleAssignment.memberId, actor.memberId), eq(roleAssignment.roleId, adminRole!.id)));
    try {
      await assert.rejects(decide(message, action), { code: "FORBIDDEN" });
      assert.equal((await planning.get((await loadActor(actor.memberId))!, plan.id, "milestone")).name, "role-before");
    } finally {
      await db.insert(roleAssignment).values({ memberId: actor.memberId, roleId: adminRole!.id, scopeType: "ORG" });
      await db.delete(roleAssignment).where(and(eq(roleAssignment.memberId, actor.memberId), eq(roleAssignment.roleId, guest!.id)));
    }
  });
  await check("latest token tier, whitelist and per-tool deny block confirmation", async () => {
    const made = await createToken(actor, { name: "assistant-business-policy", tier: "READ_WRITE", projectWhitelist: [project.id] });
    const identity = (await authenticateToken(made.token, null))!;
    const plan = (await planning.createPlan(actor, project.id, "release", { name: "token-before" }))!;
    const action = await assistant.proposeAssistantAction({ ...access, token: identity.ctx }, tool("plan.updateRelease"), { releaseId: plan.id, name: "must-not-write" });
    const message = await save(action);
    const confirm = () => conversations.decideAction(actor, conversation.id, message.requestId, action.id, "confirm", undefined, identity.ctx);
    await db.update(apiToken).set({ tier: "READ_ONLY" }).where(eq(apiToken.id, identity.ctx.tokenId));
    await assert.rejects(confirm(), { code: "FORBIDDEN" });
    await db.update(apiToken).set({ tier: "READ_WRITE", projectWhitelist: [other.id] }).where(eq(apiToken.id, identity.ctx.tokenId));
    await assert.rejects(confirm(), { code: "FORBIDDEN" });
    await db.update(apiToken).set({ projectWhitelist: [project.id] }).where(eq(apiToken.id, identity.ctx.tokenId));
    await db.insert(mcpToolPolicy).values({ tokenId: identity.ctx.tokenId, toolName: "plan.updateRelease", effect: "DENY" });
    await assert.rejects(confirm(), { code: "FORBIDDEN" });
    assert.equal((await planning.get(actor, plan.id, "release")).name, "token-before");
  });
  await check("persisted legacy work-item proposals still confirm through their version", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "legacy-before" }))!;
    const action = await propose("workitem.update", { workItemId: item.id, expectedVersion: item.version, title: "legacy-confirmed" });
    delete action.target; delete action.resources;
    const confirmed = await decide(await save(action), action);
    assert.equal(confirmed.message.reply!.actions![0]!.status, "confirmed");
    assert.equal((await workItems.getWorkItem(actor, item.id)).title, "legacy-confirmed");
  });
  await check("approval transition confirmation commits one pending request and real approval alone changes status", async () => {
    const workflow = await import("../../src/server/services/workflow-config.service.ts");
    const approvals = await import("../../src/server/services/approval.service.ts");
    for (const decision of ["approve", "reject"] as const) {
      const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: `approval-${decision}` }))!;
      const edge = (await workflow.listTransitions(actor, item.workflowId)).find(row => row.fromStateId === item.statusId)!;
      const destination = (await workflow.listStates(actor, item.workflowId)).find(row => row.id === edge.toStateId)!;
      await workflow.updateTransition(actor, item.workflowId, edge.id, { requiresApproval: true, approverRoleKeys: ["ADMIN"] });
      const action = await propose("workitem.transition", { workItemId: item.id, toStateKey: destination.key, version: item.version });
      const message = await save(action);
      const confirmations = await Promise.all([decide(message, action), decide(message, action), decide(message, action)]);
      assert.ok(confirmations.every(row => row.message.reply!.actions![0]!.status === "confirmed"));
      const { validatedToolOutput } = await import("../../src/server/application/tool-contracts.ts");
      for (const confirmation of confirmations) validatedToolOutput({ name: "rag.conversation.action" }, confirmation);
      const result = confirmations[0]!.message.reply!.actions![0]!.result!;
      assert.equal(result.outcome, "approval_pending");
      assert.deepEqual(result.approval, { status: "PENDING" });
      assert.equal(result.value.statusId, item.statusId);
      const pending = await approvals.listForItem(actor, item.id);
      assert.equal(pending.length, 1); assert.equal(pending[0]!.status, "PENDING");
      assert.equal((await workItems.getWorkItem(actor, item.id)).statusId, item.statusId);
      await approvals.decide(actor, pending[0]!.id, decision);
      assert.equal((await workItems.getWorkItem(actor, item.id)).statusId, decision === "approve" ? destination.id : item.statusId);
      await decide(message, action);
      assert.equal((await approvals.listForItem(actor, item.id)).length, 1);
    }
  });
  await check("approval interception never swallows unrelated tool failures or invalid approval references", async () => {
    const { DomainError } = await import("../../src/shared/errors.ts");
    const approvals = await import("../../src/server/services/approval.service.ts");
    const workflow = await import("../../src/server/services/workflow-config.service.ts");
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "must-stay" }))!;
    const otherItem = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "other-approval" }))!;
    const edge = (await workflow.listTransitions(actor, item.workflowId)).find(row => row.fromStateId === item.statusId)!;
    const destination = (await workflow.listStates(actor, item.workflowId)).find(row => row.id === edge.toStateId)!;
    const unrelated = await approvals.requestApproval(actor, otherItem, { fromStateId: otherItem.statusId, toStateId: destination.id, approverRoleKeys: ["ADMIN"] });
    for (const scenario of [
      { name: "workitem.transition", details: null },
      { name: "workitem.transition", details: { approvalId: randomUUID() } },
      { name: "workitem.transition", details: { approvalId: unrelated.id } },
      { name: "workitem.update", details: { approvalId: unrelated.id } },
    ]) {
      const args = scenario.name === "workitem.update"
        ? { workItemId: item.id, expectedVersion: item.version, title: "must-not-write" }
        : { workItemId: item.id, toStateKey: destination.key, version: item.version };
      const action = await propose(scenario.name, args);
      const message = await save(action);
      const definition = tool(scenario.name), original = definition.handler;
      definition.handler = async () => { throw new DomainError("BLOCKED_BY_PREREQUISITE", "review-blocked", scenario.details); };
      try { await assert.rejects(decide(message, action), { code: "BLOCKED_BY_PREREQUISITE", message: "review-blocked" }); }
      finally { definition.handler = original; }
      const history = await conversations.getConversation(actor, conversation.id);
      assert.equal(history.messages.find(row => row.id === message.id)!.reply!.actions![0]!.status, "pending");
    }
    assert.equal((await workItems.getWorkItem(actor, item.id)).title, "must-stay");
    assert.equal((await approvals.listForItem(actor, item.id)).length, 0);
  });
  assert.deepEqual(failures, []);
  console.log("assistant business confirmation contracts passed");
} finally { await closeCache(); await sql.end({ timeout: 5 }); }
