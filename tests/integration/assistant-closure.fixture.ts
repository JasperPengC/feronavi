import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RagActionProposal } from "../../src/shared/rag.ts";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname,
  /^\/feronavi_test_[a-f0-9]{32}$/u,
);
const { eq } = await import("drizzle-orm");
const { db, sql } = await import("../../src/db/index.ts");
const {
  member,
  role,
  roleAssignment,
  ragMessage,
  projectMembership,
  mcpToolPolicy,
} = await import("../../src/db/schema.ts");

const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } =
  await import("../../src/server/services/project.service.ts");
const planning = await import("../../src/server/services/planning.service.ts");
const wiki = await import("../../src/server/services/wiki.service.ts");
const workItems =
  await import("../../src/server/services/work-item.service.ts");
const { closeCache } = await import("../../src/server/auth/cache.ts");
const { ensureInitialized } = await import("../../scripts/_test-helpers.ts");
const assistant = await import("../../src/server/services/assistant-tools.ts");
const conversations =
  await import("../../src/server/services/rag-conversation.service.ts");
const { createToken, authenticateToken } =
  await import("../../src/server/services/token.service.ts");
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message}`);
  }
}
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db
    .insert(member)
    .values({
      username: "assistant-closure",
      name: "Assistant",
      passwordHash: "no-login",
      status: "ACTIVE",
      mustChangePassword: false,
    })
    .returning();
  await db
    .insert(roleAssignment)
    .values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const project = await createProject(actor, {
    key: "CLOSURE",
    name: "助手业务",
  });
  const other = await createProject(actor, {
    key: "CLOSEOTHER",
    name: "范围外项目",
  });
  const access = { actor, projectIds: [project.id], check: async () => {} };
  const registry = await assistant.assistantRegistry();
  const tool = (name: string) => {
    const found = registry.find((t) => t.name === name);
    assert.ok(found, `missing tool ${name}`);
    return found;
  };
  const propose = (name: string, args: Record<string, unknown>) =>
    assistant.proposeAssistantAction(access, tool(name), args);
  const conversation = await conversations.createConversation(actor, {
    projectId: project.id,
  });
  const save = async (action: RagActionProposal) =>
    (
      await db
        .insert(ragMessage)
        .values({
          conversationId: conversation.id,
          requestId: randomUUID(),
          question: "建议",
          status: "completed",
          reply: {
            ok: true,
            answer: "请确认",
            citations: [],
            mode: "none",
            scope: { projectIds: [project.id], projectCount: 1 },
            actions: [action],
          },
        })
        .returning()
    )[0]!;
  const decide = (
    message: typeof ragMessage.$inferSelect,
    action: RagActionProposal,
    decision: "confirm" | "reject" = "confirm",
  ) =>
    conversations.decideAction(
      actor,
      conversation.id,
      message.requestId,
      action.id,
      decision,
    );

  await check(
    "document restoration appends once and rereads the page rather than revision id",
    async () => {
      const doc = await wiki.createPage(actor, project.id, {
        title: "验收方案",
        content: "初稿",
      });
      await wiki.updatePage(actor, doc.id, { content: "二稿" });
      const revisions = await wiki.listRevisions(actor, doc.id);
      const original = revisions.find((row) => row.revisionNo === 1)!;
      const action = await propose("page.restore", {
        pageId: doc.id,
        revisionId: original.id,
      });
      assert.ok(action.presentation?.title);
      const message = await save(action);
      assert.equal((await wiki.getPage(actor, doc.id)).content, "二稿");
      await Promise.all([decide(message, action), decide(message, action)]);
      const current = await wiki.getPage(actor, doc.id);
      assert.equal(current.content, "初稿");
      assert.equal(current.revisionNo, 3);
    },
  );
  await check(
    "iteration completion explicitly carries unfinished work and validates both project scopes",
    async () => {
      const source = (await planning.createPlan(
        actor,
        project.id,
        "iteration",
        { name: "冲刺一", startDate: "2026-11-01", endDate: "2026-11-14" },
      ))!;
      const next = (await planning.createPlan(actor, project.id, "iteration", {
        name: "冲刺二",
        startDate: "2026-11-15",
        endDate: "2026-11-28",
      }))!;
      const foreign = (await planning.createPlan(actor, other.id, "iteration", {
        name: "不能结转到这里",
        startDate: "2026-11-15",
        endDate: "2026-11-28",
      }))!;
      const item = (await workItems.createWorkItem(actor, project.id, {
        type: "TASK",
        title: "支付重试验收",
        iterationId: source.id,
      }))!;
      await assert.rejects(
        propose("plan.completeIteration", {
          iterationId: source.id,
          targetIterationId: foreign.id,
        }),
        { code: "NOT_FOUND" },
      );
      const rejected = await propose("plan.completeIteration", {
        iterationId: source.id,
        targetIterationId: next.id,
      });
      await decide(await save(rejected), rejected, "reject");
      assert.equal(
        (await workItems.getWorkItem(actor, item.id)).iterationId,
        source.id,
      );
      const action = await propose("plan.completeIteration", {
        iterationId: source.id,
        targetIterationId: next.id,
      });
      const result = await decide(await save(action), action);
      assert.equal(
        (await workItems.getWorkItem(actor, item.id)).iterationId,
        next.id,
      );
      assert.ok(
        (await planning.get(actor, source.id, "iteration")).completedAt,
      );
      assert.ok(result.message.reply!.actions![0]!.result?.value);
    },
  );
  await check(
    "dependencies validate both ends, reject stale collections and reread removals",
    async () => {
      const a = (await workItems.createWorkItem(actor, project.id, {
        type: "TASK",
        title: "后端接口",
      }))!;
      const b = (await workItems.createWorkItem(actor, project.id, {
        type: "TASK",
        title: "前端联调",
      }))!;
      const c = (await workItems.createWorkItem(actor, other.id, {
        type: "TASK",
        title: "范围外",
      }))!;
      await assert.rejects(
        propose("workitem.link", {
          fromWorkItemId: a.id,
          toWorkItemId: c.id,
          type: "BLOCKS",
        }),
        { code: "NOT_FOUND" },
      );
      const action = await propose("workitem.link", {
        fromWorkItemId: a.id,
        toWorkItemId: b.id,
        type: "BLOCKS",
      });
      const message = await save(action);
      const relations =
        await import("../../src/server/services/relation.service.ts");
      const edge = await relations.addRelation(actor, a.id, {
        targetId: b.id,
        type: "RELATES_TO",
      });
      await assert.rejects(decide(message, action), { code: "CONFLICT" });
      const unlink = await propose("workitem.unlink", {
        workItemId: a.id,
        relationId: edge!.id,
      });
      const done = await decide(await save(unlink), unlink);
      assert.equal(done.message.reply!.actions![0]!.status, "confirmed");
      assert.equal(
        JSON.stringify(done.message.reply!.actions![0]!.result!.value).includes(
          edge!.id,
        ),
        false,
      );
    },
  );
  await check(
    "idea evaluation vote and promotion reread actual work item",
    async () => {
      const ideas = await import("../../src/server/services/idea.service.ts");
      const draft = (await ideas.createIdea(actor, project.id, {
        title: "对账失败自动告警",
        description: "减少重复工单",
      }))!;
      for (const [name, parameters] of [
        ["idea.update", { ideaId: draft.id, status: "PLANNED" }],
        ["idea.vote", { ideaId: draft.id, weight: 2 }],
        ["idea.promote", { ideaId: draft.id, type: "TASK" }],
      ] as const) {
        const action = await propose(name, parameters);
        await decide(await save(action), action);
      }
      const current = await ideas.getIdea(actor, draft.id);
      assert.ok(current.promotedWorkItemId);
      assert.equal(
        (await workItems.getWorkItem(actor, current.promotedWorkItemId!)).title,
        draft.title,
      );
    },
  );
  await check(
    "collaboration, progress and time logs execute once and expose reread collections",
    async () => {
      const [peer] = await db
        .insert(member)
        .values({
          username: "closure-peer",
          name: "联调协作者",
          passwordHash: "no-login",
          status: "ACTIVE",
          mustChangePassword: false,
        })
        .returning();
      await db
        .insert(projectMembership)
        .values({
          projectId: project.id,
          memberId: peer!.id,
          roleId: adminRole!.id,
        });
      const item = (await workItems.createWorkItem(actor, project.id, {
        type: "TASK",
        title: "上线检查",
      }))!;
      for (const [name, parameters] of [
        [
          "workitem.addCollaborator",
          { workItemId: item.id, memberId: peer!.id },
        ],
        [
          "workitem.addProgressUpdate",
          {
            workItemId: item.id,
            summary: "主流程验收通过",
            nextSteps: "灰度观察",
          },
        ],
        [
          "timeLog.create",
          {
            workItemId: item.id,
            minutes: 45,
            loggedDate: "2026-11-16",
            note: "真实业务验收",
          },
        ],
      ] as const) {
        const action = await propose(name, parameters);
        const message = await save(action);
        const results = await Promise.all([
          decide(message, action),
          decide(message, action),
          decide(message, action),
        ]);
        const result = results[0]!.message.reply!.actions![0]!.result!;
        assert.ok(Array.isArray(result.value.observations));
      }
      const time =
        await import("../../src/server/services/prefs-time.service.ts");
      assert.equal((await time.listTimeLogs(actor, item.id)).length, 1);
      const log = (await time.listTimeLogs(actor, item.id))[0]!;
      const edit = await propose("timeLog.update", {
        timeLogId: log.id,
        minutes: 60,
      });
      await decide(await save(edit), edit);
      assert.equal((await time.listTimeLogs(actor, item.id))[0]!.minutes, 60);
      const remove = await propose("timeLog.delete", { timeLogId: log.id });
      await decide(await save(remove), remove);
      assert.equal((await time.listTimeLogs(actor, item.id)).length, 0);
    },
  );
  await check(
    "new collection proposal respects revoked tool policy and cross-project scope",
    async () => {
      const item = (await workItems.createWorkItem(actor, project.id, {
        type: "TASK",
        title: "权限复核",
      }))!;
      const action = await propose("workitem.addProgressUpdate", {
        workItemId: item.id,
        summary: "不能在失权后写入",
      });
      const message = await save(action);
      const issued = await createToken(actor, {
        name: "closure-limited",
        tier: "READ_WRITE",
        projectWhitelist: [project.id],
      });
      const token = (await authenticateToken(issued.token, null))!;
      await db
        .insert(mcpToolPolicy)
        .values({
          tokenId: token.ctx.tokenId,
          toolName: "workitem.addProgressUpdate",
          effect: "DENY",
        });
      await assert.rejects(
        conversations.decideAction(
          actor,
          conversation.id,
          message.requestId,
          action.id,
          "confirm",
          [project.id],
          token.ctx,
        ),
        { code: "FORBIDDEN" },
      );
      const issues =
        await import("../../src/server/services/issues.service.ts");
      assert.equal(
        (await issues.listProgressUpdates(actor, item.id)).length,
        0,
      );
    },
  );
  assert.deepEqual(failures, []);
  console.log("assistant closure contracts passed");
} finally {
  await closeCache();
  await sql.end({ timeout: 5 });
}
