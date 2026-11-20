import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RagActionProposal } from "../../src/shared/rag.ts";
assert.match(new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname, /^\/feronavi_test_[a-f0-9]{32}$/u);
const { db, sql, createIndependentSql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment, ragMessage, projectMembership } = await import("../../src/db/schema.ts");
const { eq, and } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } = await import("../../src/server/services/project.service.ts");
const planning = await import("../../src/server/services/planning.service.ts");
const workItems = await import("../../src/server/services/work-item.service.ts");
const milestones = await import("../../src/server/services/milestone-detail.service.ts");
const issues = await import("../../src/server/services/issues.service.ts");
const ideas = await import("../../src/server/services/idea.service.ts");
const collaboration = await import("../../src/server/services/collab.service.ts");
const transfers = await import("../../src/server/services/work-item-transfer.service.ts");
const timeLogs = await import("../../src/server/services/prefs-time.service.ts");
const fields = await import("../../src/server/services/custom-field.service.ts");
const capacity = await import("../../src/server/services/mcp-work-planning.service.ts");
const sla = await import("../../src/server/services/sla.service.ts");
const workflow = await import("../../src/server/services/workflow-config.service.ts");
const approvals = await import("../../src/server/services/approval.service.ts");
const { closeCache } = await import("../../src/server/auth/cache.ts");
const { ensureInitialized } = await import("../../scripts/_test-helpers.ts");
const assistant = await import("../../src/server/services/assistant-tools.ts");
const conversations = await import("../../src/server/services/rag-conversation.service.ts");
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${(error as Error).message}`); }
}
async function assertExternalUpdateLocked(query: string, parameters: string[]) {
  const connection = createIndependentSql();
  try {
    const session = await connection.reserve();
    try {
      await session`BEGIN`;
      try {
        await session`SET LOCAL lock_timeout = '150ms'`;
        await assert.rejects(session.unsafe(query, parameters), { code: "55P03" });
      } finally { await session`ROLLBACK`; }
    } finally { session.release(); }
  } finally { await connection.end({ timeout: 5 }); }
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db.insert(member).values({ username: "assistant-closure-more", name: "Assistant", passwordHash: "no-login", status: "ACTIVE", mustChangePassword: false }).returning();
  await db.insert(roleAssignment).values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const project = await createProject(actor, { key: "CLOSEMORE", name: "助手剩余闭环" });
  const [peer] = await db.insert(member).values({ username: "closure-more-peer", name: "交接成员", passwordHash: "no-login", status: "ACTIVE", mustChangePassword: false }).returning();
  await db.insert(projectMembership).values({ projectId: project.id, memberId: peer!.id, roleId: adminRole!.id });
  const access = { actor, projectIds: [project.id], check: async () => {} };
  const registry = await assistant.assistantRegistry();
  const tool = (name: string) => { const found = registry.find(t => t.name === name); assert.ok(found, `missing tool ${name}`); return found; };
  const propose = (name: string, args: Record<string, unknown>) => assistant.proposeAssistantAction(access, tool(name), args);
  const conversation = await conversations.createConversation(actor, { projectId: project.id });
  const save = async (action: RagActionProposal) => (await db.insert(ragMessage).values({
    conversationId: conversation.id, requestId: randomUUID(), question: "建议", status: "completed",
    reply: { ok: true, answer: "请确认", citations: [], mode: "none", scope: { projectIds: [project.id], projectCount: 1 }, actions: [action] },
  }).returning())[0]!;
  const decide = (message: typeof ragMessage.$inferSelect, action: RagActionProposal, decision: "confirm" | "reject" = "confirm") => conversations.decideAction(actor, conversation.id, message.requestId, action.id, decision);
  const confirm = async (name: string, args: Record<string, unknown>) => {
    const action = await propose(name, args);
    assert.ok(action.presentation?.title, `${name}: missing presentation`);
    assert.ok(action.observations?.length, `${name}: missing current facts`);
    const message = await save(action);
    const result = await decide(message, action);
    const confirmed = result.message.reply!.actions![0]!;
    assert.equal(confirmed.status, "confirmed", name);
    assert.ok(Array.isArray(confirmed.result?.value.observations), `${name}: missing reread observations`);
    assert.deepEqual((await decide(message, action)).message.reply!.actions![0]!.result, confirmed.result);
    return confirmed.result!;
  };

  for (const kind of ["milestone", "iteration", "release", "module"] as const) {
    await check(`${kind} archive and unarchive persist and reread the original plan`, async () => {
      const extra = kind === "iteration" ? { startDate: "2026-11-01", endDate: "2026-11-14" } : {};
      const plan = (await planning.createPlan(actor, project.id, kind, { name: `${kind}-lifecycle`, ...extra }))!;
      const label = kind[0]!.toUpperCase() + kind.slice(1), key = `${kind}Id`;
      if (kind === "iteration" || kind === "release") await confirm(`plan.complete${label}`, { [key]: plan.id });
      await confirm(`plan.archive${label}`, { [key]: plan.id });
      assert.ok((await planning.get(actor, plan.id, kind)).archivedAt);
      const restored = await confirm(`plan.unarchive${label}`, { [key]: plan.id });
      assert.equal((await planning.get(actor, plan.id, kind)).archivedAt, null);
      assert.ok(restored.resources.some(resource => resource.kind === kind && resource.id === plan.id));
    });
  }
  await check("empty release completes through confirmation and rereads completion time", async () => {
    const release = (await planning.createPlan(actor, project.id, "release", { name: "无遗留任务版本" }))!;
    const action = await propose("plan.completeRelease", { releaseId: release.id });
    const message = await save(action);
    assert.equal((await planning.get(actor, release.id, "release")).completedAt, null);
    await Promise.all([decide(message, action), decide(message, action)]);
    assert.ok((await planning.get(actor, release.id, "release")).completedAt);
  });
  await check("iteration capacity rejects changed collection before writing and confirms fresh proposal", async () => {
    const iteration = (await planning.createPlan(actor, project.id, "iteration", { name: "成员容量", startDate: "2026-11-01", endDate: "2026-11-14" }))!;
    const action = await propose("plan.setIterationCapacity", { iterationId: iteration.id, memberId: peer!.id, capacityPoints: 8 });
    const message = await save(action);
    await capacity.setIterationCapacity(actor, iteration.id, peer!.id, { capacityPoints: 13 });
    await assert.rejects(decide(message, action), { code: "CONFLICT" });
    assert.equal((await capacity.iterationCapacityList(actor, iteration.id)).members.find(row => row.memberId === peer!.id)!.capacityPoints, 13);
    await confirm("plan.setIterationCapacity", { iterationId: iteration.id, memberId: peer!.id, capacityHours: 24 });
    const current = (await capacity.iterationCapacityList(actor, iteration.id)).members.find(row => row.memberId === peer!.id)!;
    assert.equal(current.capacityHours, 24); assert.equal(current.capacityPoints, null);
  });
  await check("milestone progress adds once and deletes by its own identity", async () => {
    const milestone = (await planning.createPlan(actor, project.id, "milestone", { name: "验收节点" }))!;
    await confirm("plan.addMilestoneProgressUpdate", { milestoneId: milestone.id, summary: "自动化回归通过", nextSteps: "验收", blockers: null });
    const detail = await milestones.milestoneDetail(actor, milestone.id);
    assert.equal(detail.progressUpdates.length, 1);
    assert.equal(detail.progressUpdates[0]!.summary, "自动化回归通过");
    await confirm("plan.deleteMilestoneProgressUpdate", { milestoneId: milestone.id, milestoneProgressUpdateId: detail.progressUpdates[0]!.id });
    assert.equal((await milestones.milestoneDetail(actor, milestone.id)).progressUpdates.length, 0);
  });
  await check("work item progress deletion removes only the selected record", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "独立进展记录" }))!;
    const removed = (await issues.addProgressUpdate(actor, item.id, { summary: "过时记录" }))!;
    const kept = (await issues.addProgressUpdate(actor, item.id, { summary: "有效记录" }))!;
    await confirm("workitem.deleteProgressUpdate", { workItemId: item.id, workItemProgressUpdateId: removed.id });
    assert.deepEqual((await issues.listProgressUpdates(actor, item.id)).map(row => row.id), [kept.id]);
  });
  await check("idea submission confirms once then unvote rereads the idea without own vote", async () => {
    const result = await confirm("idea.submit", { projectId: project.id, title: "追踪部署结果", description: "关联验收记录" });
    const ref = result.resources.find(resource => resource.kind === "idea"); assert.ok(ref);
    const idea = await ideas.getIdea(actor, ref.id);
    assert.equal(idea.title, "追踪部署结果");
    await confirm("idea.vote", { ideaId: idea.id, weight: 3 });
    assert.equal((await ideas.getIdea(actor, idea.id)).voteCount, 1);
    await confirm("idea.unvote", { ideaId: idea.id });
    assert.equal((await ideas.getIdea(actor, idea.id)).voteCount, 0);
  });
  await check("transfer uses current version and collaborator removal verifies the collection", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "负责人交接" }))!;
    await collaboration.addCollaborator(actor, item.id, peer!.id);
    await confirm("workitem.removeCollaborator", { workItemId: item.id, memberId: peer!.id });
    assert.equal((await collaboration.listCollaborators(actor, item.id)).length, 0);
    const action = await propose("workitem.transfer", { workItemId: item.id, assigneeId: peer!.id, version: item.version, reason: "模块交接" });
    assert.equal((await workItems.getWorkItem(actor, item.id)).assigneeId, null);
    const message = await save(action);
    await Promise.all([decide(message, action), decide(message, action)]);
    assert.equal((await workItems.getWorkItem(actor, item.id)).assigneeId, peer!.id);
    const history = await transfers.listTransfers(actor, item.id);
    assert.equal(history.length, 1); assert.equal(history[0]!.reason, "模块交接");
  });
  await check("custom fields use definition identity, increment version and expose typed reread values", async () => {
    const definition = (await fields.createDef(actor, project.id, { key: "test_number", name: "验收数量", type: "NUMBER" }))!;
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "字段验收" }))!;
    await confirm("customField.setValues", { workItemId: item.id, expectedVersion: item.version, values: { [definition.id]: 7 } });
    assert.equal((await fields.getValues(actor, item.id)).find(row => row.defId === definition.id)!.value, 7);
    assert.equal((await workItems.getWorkItem(actor, item.id)).version, item.version + 1);
    await assert.rejects(propose("customField.setValues", { workItemId: item.id, expectedVersion: item.version, values: { [definition.id]: 99 } }), { code: "VERSION_CONFLICT" });
    assert.equal((await fields.getValues(actor, item.id)).find(row => row.defId === definition.id)!.value, 7);
    assert.equal((await workItems.getWorkItem(actor, item.id)).version, item.version + 1);
  });
  await check("SLA pause and resume preserve clocks and reread current paused state", async () => {
    await sla.createPolicy(actor, project.id, { name: "受控SLA", responseMinutes: 60, resolveMinutes: 120 });
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "SLA验收" }))!;
    await sla.ensureSla(item.id);
    const original = (await sla.getSla(item.id))!; assert.ok(original);
    await confirm("sla.pause", { workItemId: item.id });
    assert.ok((await sla.getSla(item.id))!.pausedAt);
    await confirm("sla.resume", { workItemId: item.id });
    const current = (await sla.getSla(item.id))!;
    assert.equal(current.pausedAt, null); assert.ok(current.pausedMs >= 0);
    assert.equal(current.responseDueAt.getTime() - original.responseDueAt.getTime(), current.pausedMs);
    assert.equal(current.resolveDueAt.getTime() - original.resolveDueAt.getTime(), current.pausedMs);
  });
  await check("approval approve and reject confirm through assistant and preserve real transition outcome", async () => {
    for (const decision of ["approve", "reject"] as const) {
      const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: `审批-${decision}` }))!;
      const edge = (await workflow.listTransitions(actor, item.workflowId)).find(row => row.fromStateId === item.statusId)!;
      const destination = (await workflow.listStates(actor, item.workflowId)).find(row => row.id === edge.toStateId)!;
      await workflow.updateTransition(actor, item.workflowId, edge.id, { requiresApproval: true, approverRoleKeys: ["ADMIN"] });
      const transition = await propose("workitem.transition", { workItemId: item.id, toStateKey: destination.key, version: item.version });
      await decide(await save(transition), transition);
      const requests = await approvals.listForItem(actor, item.id);
      assert.equal(requests.length, 1); assert.equal(requests[0]!.status, "PENDING");
      assert.equal((await workItems.getWorkItem(actor, item.id)).statusId, item.statusId);
      const approvalAction = await propose(`approval.${decision}`, { approvalId: requests[0]!.id, comment: `真实助手${decision}` });
      const presentation = approvalAction.presentation!.fields.map(field => field.value).join(" ");
      assert.ok(presentation.includes(item.key) && presentation.includes(item.title), "审批确认必须显示父工作项");
      assert.ok(requests[0]!.fromStateName && requests[0]!.toStateName);
      assert.ok(presentation.includes(`${requests[0]!.fromStateName} → ${requests[0]!.toStateName}`), "审批确认必须显示原状态到目标状态名称");
      const message = await save(approvalAction);
      const confirmed = await decide(message, approvalAction);
      const result = confirmed.message.reply!.actions![0]!.result!;
      assert.equal(confirmed.message.reply!.actions![0]!.status, "confirmed");
      assert.deepEqual((await decide(message, approvalAction)).message.reply!.actions![0]!.result, result);
      assert.ok(result.resources.some(resource => resource.kind === "workItem" && resource.id === item.id));
      const approved = (await approvals.listForItem(actor, item.id))[0]!;
      assert.equal(approved.status, decision === "approve" ? "APPROVED" : "REJECTED");
      assert.equal((await workItems.getWorkItem(actor, item.id)).statusId, decision === "approve" ? destination.id : item.statusId);
    }
  });
  await check("capacity row stays locked between observed facts check and actual write", async () => {
    const iteration = (await planning.createPlan(actor, project.id, "iteration", { name: "容量并发锁", startDate: "2026-11-01", endDate: "2026-11-14" }))!;
    await capacity.setIterationCapacity(actor, iteration.id, peer!.id, { capacityPoints: 5 });
    const action = await propose("plan.setIterationCapacity", { iterationId: iteration.id, memberId: peer!.id, capacityPoints: 8 });
    const message = await save(action), definition = tool("plan.setIterationCapacity"), original = definition.handler;
    let entered = 0;
    definition.handler = async (ctx, args) => {
      entered++;
      await assertExternalUpdateLocked("UPDATE iteration_capacity SET capacity_points = 99 WHERE iteration_id = $1 AND member_id = $2", [iteration.id, peer!.id]);
      return original(ctx, args);
    };
    try { await decide(message, action); }
    finally { definition.handler = original; }
    assert.equal(entered, 1);
    assert.equal((await capacity.iterationCapacityList(actor, iteration.id)).members.find(row => row.memberId === peer!.id)!.capacityPoints, 8);
  });
  await check("time log row stays locked between observed facts check and actual write", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "工时并发锁" }))!;
    const log = (await timeLogs.addTimeLog(actor, item.id, { minutes: 30, loggedDate: "2026-11-16", note: "原始记录" }))!;
    const action = await propose("timeLog.update", { timeLogId: log.id, minutes: 45 });
    const message = await save(action), definition = tool("timeLog.update"), original = definition.handler;
    let entered = 0;
    definition.handler = async (ctx, args) => {
      entered++;
      await assertExternalUpdateLocked("UPDATE time_log SET minutes = 99 WHERE id = $1", [log.id]);
      return original(ctx, args);
    };
    try { await decide(message, action); }
    finally { definition.handler = original; }
    assert.equal(entered, 1);
    assert.equal((await timeLogs.listTimeLogs(actor, item.id))[0]!.minutes, 45);
  });
  await check("time log deletion presents date, minutes and parent work item before confirmation", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "工时删除上下文" }))!;
    const log = (await timeLogs.addTimeLog(actor, item.id, { minutes: 35, loggedDate: "2026-11-16" }))!;
    const action = await propose("timeLog.delete", { timeLogId: log.id });
    const presentation = action.presentation!.fields.map(field => field.value).join(" ");
    assert.ok(presentation.includes("2026-11-16"), "工时确认必须显示登记日期");
    assert.ok(presentation.includes("35 分钟"), "工时确认必须显示分钟数");
    assert.ok(presentation.includes(item.title) && presentation.includes(item.key), "工时确认必须显示父工作项");
    await decide(await save(action), action);
    assert.equal((await timeLogs.listTimeLogs(actor, item.id)).length, 0);
  });
  await check("unassignment explicitly presents removal of the current assignee", async () => {
    const item = (await workItems.createWorkItem(actor, project.id, { type: "TASK", title: "解除负责人确认", assigneeId: peer!.id }))!;
    const action = await propose("workitem.transfer", { workItemId: item.id, assigneeId: null, version: item.version, reason: "回到待分配" });
    assert.ok(action.presentation!.fields.some(field => field.label === "负责人" && field.value.includes("解除负责人")), "确认必须明确显示解除负责人");
    await decide(await save(action), action);
    assert.equal((await workItems.getWorkItem(actor, item.id)).assigneeId, null);
  });
  await check("idea promotion waits for project lock before locking the idea row", async () => {
    const idea = (await ideas.createIdea(actor, project.id, { title: "想法转化锁序" }))!;
    const connection = createIndependentSql();
    let promotion: Promise<PromiseSettledResult<Awaited<ReturnType<typeof ideas.promote>>>> | undefined;
    let promoted: PromiseSettledResult<Awaited<ReturnType<typeof ideas.promote>>> | undefined;
    try {
      const session = await connection.reserve();
      try {
        await session`BEGIN`;
        try {
          await session`SELECT id FROM project WHERE id = ${project.id} FOR UPDATE`;
          const [holder] = await session<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          let started!: (pid: number) => void;
          const ready = new Promise<number>(resolve => { started = resolve; });
          // A uses a native independent connection; B enters a fresh service transaction.
          promotion = db.transaction(async () => {
            const [backend] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            started(backend!.pid);
            return ideas.promote(actor, idea.id, { type: "TASK" });
          }).then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
          const backendId = await ready;
          let blocked = false;
          const deadline = Date.now() + 10_000;
          while (!blocked && Date.now() < deadline) {
            await session`SELECT pg_stat_clear_snapshot()`;
            const [waiting] = await session<{ blocked_by: number[]; wait_event_type: string | null }[]>`
              SELECT pg_blocking_pids(pid) AS blocked_by, wait_event_type
              FROM pg_stat_activity WHERE pid = ${backendId}`;
            blocked = waiting?.wait_event_type === "Lock" && waiting.blocked_by.includes(holder!.pid);
          }
          assert.ok(blocked, "转化事务必须已明确等待A持有的项目锁");
          // Holding project then taking idea must succeed: B must not invert this order.
          await session`SELECT id FROM idea WHERE id = ${idea.id} FOR UPDATE NOWAIT`;
        } finally { await session`ROLLBACK`; }
      } finally { session.release(); }
    } finally {
      // Release A before awaiting B even on a red assertion, so no blocked task survives.
      if (promotion) promoted = await promotion;
      await connection.end({ timeout: 5 });
    }
    assert.equal(promoted?.status, "fulfilled", "释放项目锁后转化事务应完成");
    assert.ok((await ideas.getIdea(actor, idea.id)).promotedWorkItemId);
  });
  await check("confirmation reloads revoked role before archival and leaves pending action unchanged", async () => {
    const plan = (await planning.createPlan(actor, project.id, "module", { name: "失权不能归档" }))!;
    const action = await propose("plan.archiveModule", { moduleId: plan.id });
    const message = await save(action);
    const [guest] = await db.select().from(role).where(eq(role.key, "GUEST"));
    await db.insert(roleAssignment).values({ memberId: actor.memberId, roleId: guest!.id, scopeType: "ORG" });
    await db.delete(roleAssignment).where(and(eq(roleAssignment.memberId, actor.memberId), eq(roleAssignment.roleId, adminRole!.id)));
    try {
      await assert.rejects(decide(message, action), { code: "FORBIDDEN" });
      const current = (await loadActor(actor.memberId))!;
      assert.equal((await planning.get(current, plan.id, "module")).archivedAt, null);
      const history = await conversations.getConversation(current, conversation.id);
      assert.equal(history.messages.find(row => row.id === message.id)!.reply!.actions![0]!.status, "pending");
    } finally {
      await db.insert(roleAssignment).values({ memberId: actor.memberId, roleId: adminRole!.id, scopeType: "ORG" });
      await db.delete(roleAssignment).where(and(eq(roleAssignment.memberId, actor.memberId), eq(roleAssignment.roleId, guest!.id)));
    }
  });
  assert.deepEqual(failures, []);
  console.log("assistant remaining closure contracts passed");
} finally { await closeCache(); await sql.end({ timeout: 5 }); }
