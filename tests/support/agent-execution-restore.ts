import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assertIsolatedTestEnvironment } from "../../scripts/test-environment.mjs";
import { backupFixture } from "./system-backup-fixture.ts";
import { manifestSchema } from "../../src/shared/schemas/system-backup.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";
import { importDatasets } from "../../src/server/services/system-backup/import-data.ts";
assertIsolatedTestEnvironment();
const { db, sql, inTransaction } = await import("../../src/db/index.ts"), s = await import("../../src/db/schema.ts");
const { hashPassword } = await import("../../src/server/auth/password.ts");
await (await import("../../src/server/application/bootstrap-business-effects.ts")).bootstrapBusinessEffects();
const { loadActor } = await import("../../src/server/auth/actor-loader.ts"), work = await import("../../src/server/services/work-item.service.ts"), conv = await import("../../src/server/services/rag-conversation.service.ts"), proposal = await import("../../src/server/services/agent-proposal.service.ts");
const rollback = new Error("rollback fixture"), rows: Record<string, Record<string, unknown>[]> = {};
let ownerId = "", conversationId = "", taskId = "", requestId = "", firstId = "", secondId = "", replacementId = "";
let expected: unknown;
try {
  await assert.rejects(inTransaction(async () => {
    await db.insert(s.organization).values({ name: "运行恢复" });
    const [m] = await db.insert(s.member).values({ username: "run-restore", name: "恢复测试", status: "ACTIVE", passwordHash: await hashPassword("isolated-restore-password") }).returning();
    const [r] = await db.select().from(s.role).where(eq(s.role.key, "ADMIN"));
    ownerId = m!.id;
    await db.insert(s.roleAssignment).values({ memberId: ownerId, roleId: r!.id, scopeType: "ORG", scopeId: null });
    const actor = (await loadActor(ownerId))!, { createProject } = await import("../../src/server/services/project.service.ts");
    const p = await createProject(actor, { key: "RUNREST", name: "恢复项目" });
    const task = await work.createWorkItem(actor, p.id, { type: "TASK", title: "恢复前" }); taskId = task.id;
    const c = await conv.createConversation(actor, { projectId: p.id }); conversationId = c.id; requestId = randomUUID();
    const run = await proposal.proposeExecution(actor, c.id, { requestId, title: "恢复步骤", steps: [
      { toolName: "workitem.update", parameters: { workItemId: task.id, expectedVersion: task.version, title: "只执行一次" } },
      { toolName: "workitem.comment", parameters: { workItemId: task.id, body: "待修正" } },
    ] });
    [firstId, secondId] = run.execution.steps.map(x => x.stepId) as [string, string];
    await conv.decideAction(actor, c.id, requestId, firstId, "confirm");
    await assert.rejects(conv.decideAction(actor, c.id, requestId, secondId, "confirm"), { code: "CONFLICT" });
    const revision = await proposal.reviseExecutionAction(actor, c.id, requestId, secondId, { replacementId: randomUUID(), parameters: { workItemId: task.id, body: "恢复后继续" } });
    replacementId = revision.message.reply!.actions!.find(x => x.supersedesId === secondId)!.id;
    expected = revision.message.reply;
    for (const d of orderedDatasets("safe")) rows[d.name] = (await sql`select * from ${sql(d.tableName)}`).map(row => d.encodeRow(row, { mode: "safe", purpose: "migration" })).filter((r): r is Record<string, unknown> => r !== null);
    throw rollback;
  }), e => e === rollback);
  const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, { datasetRows: rows, manifest: { requiredFeatures: ["persistent-collaboration-and-conversations", "requirement-history", "document-folders", "product-attribution", "requirement-changes", "test-case-library", "test-execution", "test-execution-builds", "delivery-evidence", "release-gate"] } });
  await assert.rejects(inTransaction(async () => {
    await importDatasets(fixture.innerPath, manifestSchema.parse(fixture.manifest));
    const actor = (await loadActor(ownerId))!;
    const restored = await conv.getExecution(actor, conversationId, requestId);
    assert.deepEqual(restored.message.reply, expected);
    assert.equal(restored.message.reply!.actions![1]!.lastFailure!.code, "CONFLICT");
    const version = (await work.getWorkItem(actor, taskId)).version;
    await conv.decideAction(actor, conversationId, requestId, firstId, "confirm");
    await conv.decideAction(actor, conversationId, requestId, secondId, "confirm");
    await conv.decideAction(actor, conversationId, requestId, replacementId, "confirm");
    assert.equal((await work.getWorkItem(actor, taskId)).version, version);
    assert.equal((await sql`select count(*)::int n from comment where target_id=${taskId}`)[0]!.n, 1);
    assert.equal((await conv.getExecution(actor, conversationId, requestId)).execution.status, "VERIFIED");
    await sql`set constraints all immediate`;
    throw rollback;
  }), e => e === rollback);
  console.log("agent execution restore passed");
} finally { await sql.end({ timeout: 5 }); }
