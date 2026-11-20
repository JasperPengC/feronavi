/** Real isolated PostgreSQL + native synthetic provider SSE; never runs against preview data. */
import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import {
  member,
  role,
  roleAssignment,
  ragMessage,
  workItem,
  projectMembership,
  mcpToolPolicy,
} from "../src/db/schema.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { createProject } from "../src/server/services/project.service.ts";
import {
  listWorkItems,
  createWorkItem,
  getWorkItem,
  updateWorkItem,
} from "../src/server/services/work-item.service.ts";
import { createPlan } from "../src/server/services/planning.service.ts";
import {
  createPage,
  setPermissions,
} from "../src/server/services/wiki.service.ts";
import { assertAssistantReplyReadable } from "../src/server/services/assistant-access.ts";
import { collectAssistantResources } from "../src/server/services/assistant-projection.ts";
import { putSettings } from "../src/server/services/setting.service.ts";
import { listRagProjects } from "../src/server/services/rag.service.ts";
import * as service from "../src/server/services/rag-conversation.service.ts";
import {
  assistantRegistry,
  proposeAssistantAction,
  executeAssistantTool,
} from "../src/server/services/assistant-tools.ts";
import {
  createToken,
  authenticateToken,
  revokeToken,
} from "../src/server/services/token.service.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import type { RagActionProposal, RagChatResult } from "../src/shared/rag.ts";
assert.match(
  new URL(process.env.DATABASE_URL!).pathname,
  /^\/feronavi_test_[a-f0-9]{32}$/u,
);
const realFetch = globalThis.fetch;
let passed = 0;
const pass = (name: string) => {
  passed++;
  console.log(`PASS ${name}`);
};
try {
  await ensureInitialized();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [person] = await db
    .insert(member)
    .values({
      username: `assistant-${randomUUID()}`,
      name: "Assistant test",
      passwordHash: "no-login",
      status: "ACTIVE",
    })
    .returning();
  await db
    .insert(roleAssignment)
    .values({ memberId: person!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(person!.id))!;
  const project = await createProject(actor, {
    key: `UA${randomUUID().slice(0, 6).toUpperCase()}`,
    name: "隔离助手项目",
  });
  const other = await createProject(actor, {
    key: `UB${randomUUID().slice(0, 6).toUpperCase()}`,
    name: "隔离第二项目",
  });
  const item = (await createWorkItem(actor, project.id, {
    type: "TASK",
    title: "before",
  }))!;
  const machineReadable = await listWorkItems(actor, project.id);
  assert.equal(machineReadable.items[0]?.projectId, project.id);
  assert.equal(machineReadable.items[0]?.workflowId, item.workflowId);
  assert.equal(machineReadable.items[0]?.statusCategory, "NOT_STARTED");
  assert.ok(machineReadable.items[0]?.statusKey);
  pass("工作项列表携带可关联状态与项目机器可读事实");
  const readableItem = await getWorkItem(actor, item.id);
  assert.equal(readableItem.statusName, machineReadable.items[0]?.statusName);
  assert.equal(readableItem.statusKey, machineReadable.items[0]?.statusKey);
  assert.equal(readableItem.statusCategory, "NOT_STARTED");
  assert.ok(readableItem.statusName);
  pass("普通工作项详情安全关联当前工作流状态，与列表同源业务名称和分类一致");
  assert.deepEqual(await listRagProjects(actor, []), []);
  const registry = await assistantRegistry(),
    update = registry.find((t) => t.name === "workitem.update")!;
  assert.ok(update);
  assert.ok(registry.some((t) => t.name === "plan.listIterations"));
  assert.ok(
    registry.every(
      (t) => !t.name.includes("send") && !t.name.includes("webhook"),
    ),
  );
  pass("真实读写注册表与计划工具，零范围不扩权");
  const access = { actor, projectIds: [project.id], check: async () => {} };
  await assert.rejects(() =>
    executeAssistantTool({ ...access, projectIds: [] }, update, {
      workItemId: item.id,
      expectedVersion: item.version,
      title: "leak",
    }),
  );
  await assert.rejects(() =>
    executeAssistantTool(
      access,
      registry.find((t) => t.name === "workitem.list")!,
      { projectId: other.id },
    ),
  );
  pass("零范围与跨项目工具执行拒绝");
  const proposal = await proposeAssistantAction(access, update, {
    workItemId: item.id,
    expectedVersion: item.version,
    title: "confirmed",
  });
  assert.equal((await getWorkItem(actor, item.id)).title, "before");
  pass("建议生成没有业务写入");
  const conversation = await service.createConversation(actor, {
    projectId: project.id,
  });
  const save = async (action: RagActionProposal) => {
    const reply: RagChatResult = {
      ok: true,
      answer: "建议",
      mode: "none",
      citations: [],
      scope: { projectIds: [project.id], projectCount: 1 },
      actions: [action],
    };
    return (
      await db
        .insert(ragMessage)
        .values({
          conversationId: conversation.id,
          requestId: randomUUID(),
          question: "update",
          status: "completed",
          reply,
        })
        .returning()
    )[0]!;
  };
  const message = await save(proposal);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      service.decideAction(
        actor,
        conversation.id,
        message.requestId,
        proposal.id,
        "confirm",
      ),
    ),
  );
  assert.ok(
    results.every((r) => r.message.reply?.actions?.[0]?.status === "confirmed"),
  );
  const changed = await getWorkItem(actor, item.id);
  assert.equal(changed.title, "confirmed");
  assert.equal(changed.version, item.version + 1);
  pass("并发确认三次恰好写入一次，同事务持久化确认");
  await service.decideAction(
    actor,
    conversation.id,
    message.requestId,
    proposal.id,
    "reject",
  );
  assert.equal((await getWorkItem(actor, item.id)).version, changed.version);
  pass("完成建议拒绝重放不会再写");
  const second = await proposeAssistantAction(access, update, {
    workItemId: item.id,
    expectedVersion: changed.version,
    title: "rejected",
  });
  const rejected = await save(second);
  await service.decideAction(
    actor,
    conversation.id,
    rejected.requestId,
    second.id,
    "reject",
  );
  await service.decideAction(
    actor,
    conversation.id,
    rejected.requestId,
    second.id,
    "confirm",
  );
  assert.equal((await getWorkItem(actor, item.id)).title, "confirmed");
  pass("拒绝后确认无写入");
  const stale = await proposeAssistantAction(access, update, {
      workItemId: item.id,
      expectedVersion: changed.version,
      title: "stale",
    }),
    staleMessage = await save(stale);
  await updateWorkItem(actor, item.id, {
    title: "external",
    version: changed.version,
  });
  await assert.rejects(
    () =>
      service.decideAction(
        actor,
        conversation.id,
        staleMessage.requestId,
        stale.id,
        "confirm",
      ),
    { code: "CONFLICT" },
  );
  pass("对象版本过期不能覆盖其他修改");
  const expired = await save({
    ...stale,
    id: randomUUID(),
    expiresAt: new Date(0).toISOString(),
  });
  const expiredAction = expired.reply!.actions![0]!;
  assert.equal(
    (
      await service.decideAction(
        actor,
        conversation.id,
        expired.requestId,
        expiredAction.id,
        "confirm",
      )
    ).message.reply?.actions?.[0]?.status,
    "expired",
  );
  pass("到期建议不执行");
  await putSettings({
    "ai.chatBaseUrl": "https://1.1.1.1/v1",
    "ai.chatModel": "synthetic-unified",
  });
  let modelCalls = 0;
  let readToolName = "workitem_list";
  let readArgs: Record<string, unknown> = {
    projectId: project.id,
    pageSize: 10,
  };
  const events: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    modelCalls++;
    let delta: unknown;
    if (body.tools && modelCalls === 1)
      delta = {
        reasoning_content: "never expose",
        tool_calls: [
          {
            index: 0,
            id: "read-1",
            type: "function",
            function: {
              name: readToolName,
              arguments: JSON.stringify(readArgs),
            },
          },
        ],
      };
    else if (body.tools) delta = { content: "internal planning" };
    else delta = { content: "来自实时工作项的最终答案" };
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const usageBefore =
    await sql`select coalesce(sum(embedding_calls),0)::int as calls from ai_usage_counter where member_id=${actor.memberId} and period='DAY'`;
  const stream = await service.sendMessage(
    actor,
    conversation.id,
    { requestId: randomUUID(), question: "实时工作项" },
    undefined,
    {
      emit: async (event) => {
        events.push(event.type);
        if (event.type === "delta") assert.ok(!event.text.includes("internal"));
      },
    },
  );
  assert.equal(stream.message.status, "completed");
  assert.ok(
    stream.message.reply?.evidence?.some((e) => e.toolName === "workitem.list"),
  );
  assert.ok(events.indexOf("accepted") < events.indexOf("delta"));
  assert.equal(modelCalls, 3);
  pass("完整原生stream工具循环、真实业务证据和首delta");
  const usageAfter =
    await sql`select coalesce(sum(embedding_calls),0)::int as calls from ai_usage_counter where member_id=${actor.memberId} and period='DAY'`;
  assert.equal(usageAfter[0]!.calls, usageBefore[0]!.calls + 3);
  pass("每个成功供应商turn计一次真实用量");
  const actualMilestone = await createPlan(actor, project.id, "milestone", {
    name: "非空里程碑",
  });
  assert.ok(actualMilestone);
  const milestoneChild = (await createWorkItem(actor, project.id, {
    type: "TASK",
    title: "milestone child",
    milestoneId: actualMilestone.id,
  }))!;
  readToolName = "plan_getMilestone";
  readArgs = { milestoneId: actualMilestone.id };
  modelCalls = 0;
  const milestoneAnswer = await service.sendMessage(actor, conversation.id, {
    requestId: randomUUID(),
    question: "非空里程碑工作项",
  });
  assert.equal(milestoneAnswer.message.status, "completed");
  const milestoneRefs = milestoneAnswer.message.reply!.evidence![0]!.resources;
  assert.ok(
    milestoneRefs.some(
      (r) => r.kind === "milestone" && r.id === actualMilestone.id,
    ),
  );
  assert.ok(
    milestoneRefs.some(
      (r) => r.kind === "workItem" && r.id === milestoneChild.id,
    ),
  );
  await db
    .update(workItem)
    .set({ deletedAt: new Date() })
    .where(eq(workItem.id, milestoneChild.id));
  assert.equal(
    (await service.getConversation(actor, conversation.id)).messages.find(
      (m) => m.id === milestoneAnswer.message.id,
    )?.reply,
    null,
  );
  pass("真实非空里程碑证据分类正确，关联工作项删除后历史隐藏");
  const [readerRole] = await db
    .select()
    .from(role)
    .where(eq(role.key, "MEMBER"));
  const [reader] = await db
    .insert(member)
    .values({
      username: `acl-reader-${randomUUID()}`,
      name: "ACL reader",
      passwordHash: "no-login",
      status: "ACTIVE",
    })
    .returning();
  await db.insert(roleAssignment).values({
    memberId: reader!.id,
    roleId: readerRole!.id,
    scopeType: "PROJECT",
    scopeId: project.id,
  });
  const readerActor = (await loadActor(reader!.id))!;
  const safePage = (await createPage(actor, project.id, {
      title: "safe page",
      content: "safe",
    }))!,
    secretPage = (await createPage(actor, project.id, {
      title: "beyond-display-cap",
      content: "secret",
      visibility: "RESTRICTED",
    }))!;
  await setPermissions(actor, secretPage.id, [
    {
      principalType: "MEMBER",
      principalId: reader!.id,
      canRead: true,
      canWrite: false,
    },
  ]);
  const safeHits = Array.from({ length: 20 }, () => ({ pageId: safePage.id }));
  const allRefs = collectAssistantResources(
    "knowledge.search",
    { hits: [{ pageId: secretPage.id }] },
    project.id,
    collectAssistantResources(
      "knowledge.search",
      { hits: safeHits },
      project.id,
    ),
  );
  const aclConversation = await service.createConversation(readerActor, {
    projectId: project.id,
  });
  const aclReply: RagChatResult = {
    ok: true,
    answer: "secret beyond first20",
    mode: "keyword",
    scope: { projectIds: [project.id], projectCount: 1 },
    citations: Array.from({ length: 20 }, () => ({
      pageId: safePage.id,
      projectId: project.id,
      projectName: "project",
      title: "safe",
      headingPath: null,
      snippet: "safe",
    })),
    evidence: [
      {
        id: randomUUID(),
        toolName: "knowledge.search",
        projectId: project.id,
        observedAt: new Date().toISOString(),
        resources: allRefs,
        summary: "21 hits",
      },
    ],
  };
  const [aclMessage] = await db
    .insert(ragMessage)
    .values({
      conversationId: aclConversation.id,
      requestId: randomUUID(),
      question: "21 hits",
      status: "completed",
      reply: aclReply,
    })
    .returning();
  assert.ok(
    (await service.getConversation(readerActor, aclConversation.id))
      .messages[0]!.reply,
  );
  await setPermissions(actor, secretPage.id, [
    {
      principalType: "MEMBER",
      principalId: actor.memberId,
      canRead: true,
      canWrite: true,
    },
  ]);
  await assert.rejects(
    () => assertAssistantReplyReadable(readerActor, aclReply, [project.id]),
    { code: "FORBIDDEN" },
  );
  assert.equal(
    (await service.getConversation(readerActor, aclConversation.id))
      .messages[0]!.reply,
    null,
  );
  assert.equal(
    (await service.exportConversationData(readerActor)).messages.find(
      (m) => m.id === aclMessage!.id,
    )?.reply,
    null,
  );
  pass("真实第21命中不在展示引用仍保留ACL证据，撤权后历史与导出隐藏");

  const beforeNativeAction = await getWorkItem(actor, item.id);
  modelCalls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    modelCalls++;
    if (body.tools && modelCalls === 1)
      assert.ok(
        body.tools.some(
          (tool: { function: { name: string } }) =>
            tool.function.name === "propose_workitem_update",
        ),
        "模型提供的工具必须包含登记建议的内部别名",
      );
    const delta =
      body.tools && modelCalls === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: "proposal-1",
                type: "function",
                function: {
                  name: "propose_workitem_update",
                  arguments: JSON.stringify({
                    workItemId: item.id,
                    expectedVersion: beforeNativeAction.version,
                    title: "native-confirmed",
                  }),
                },
              },
            ],
          }
        : body.tools
          ? { content: "planning" }
          : { content: "请确认操作建议" };
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const nativeAction = await service.sendMessage(actor, conversation.id, {
    requestId: randomUUID(),
    question: "修改标题但需要确认",
  });
  assert.equal(nativeAction.message.reply?.actions?.length, 1);
  assert.equal(
    (await getWorkItem(actor, item.id)).title,
    beforeNativeAction.title,
  );
  await service.decideAction(
    actor,
    conversation.id,
    nativeAction.message.requestId,
    nativeAction.message.reply!.actions![0]!.id,
    "confirm",
  );
  assert.equal((await getWorkItem(actor, item.id)).title, "native-confirmed");
  pass("原生模型工具建议保存→确认→业务回读完整链");
  let releaseProvider!: () => void, startProvider!: () => void;
  const providerHeld = new Promise<void>((r) => {
      releaseProvider = r;
    }),
    providerStarted = new Promise<void>((r) => {
      startProvider = r;
    });
  globalThis.fetch = async () => {
    startProvider();
    await providerHeld;
    return new Response(
      'data: {"choices":[{"delta":{"content":"late"}}]}\n\ndata: [DONE]\n\n',
    );
  };
  const cancelRequest = { requestId: randomUUID(), question: "取消测试" };
  const running = service.sendMessage(actor, conversation.id, cancelRequest);
  await providerStarted;
  await service.cancelMessage(actor, conversation.id, cancelRequest.requestId);
  releaseProvider();
  assert.equal((await running).message.status, "cancelled");
  pass("取消中止后续工具与正文，迟到供应商结果不保存");
  const create = registry.find((t) => t.name === "workitem.create")!;
  const creation = await proposeAssistantAction(access, create, {
      projectId: project.id,
      type: "TASK",
      title: "created-once",
    }),
    createMessage = await save(creation);
  await Promise.all(
    [1, 2].map(() =>
      service.decideAction(
        actor,
        conversation.id,
        createMessage.requestId,
        creation.id,
        "confirm",
      ),
    ),
  );
  assert.equal(
    (
      await db
        .select()
        .from(workItem)
        .where(
          and(
            eq(workItem.projectId, project.id),
            eq(workItem.title, "created-once"),
          ),
        )
    ).length,
    1,
  );
  pass("创建建议并发确认复用既有幂等只创建一次");

  // Proposal policy projection must be independent of allowed read evidence.
  const proposalToken = await createToken(actor, {
    name: "proposal-policy",
    tier: "READ_WRITE",
    projectWhitelist: [project.id],
  });
  const proposalIdentity = (await authenticateToken(
    proposalToken.token,
    null,
  ))!;
  const policyAccess = { ...access, token: proposalIdentity.ctx };
  for (const mixed of [false, true]) {
    const current = await getWorkItem(actor, item.id);
    const pending = await proposeAssistantAction(policyAccess, update, {
      workItemId: item.id,
      expectedVersion: current.version,
      title: "must-not-write",
    });
    const saved = await save(pending);
    if (mixed) {
      saved.reply!.evidence = [
        {
          id: randomUUID(),
          projectId: project.id,
          toolName: "workitem.get",
          observedAt: new Date().toISOString(),
          summary: "read",
          resources: [],
        },
      ];
      await db
        .update(ragMessage)
        .set({ reply: saved.reply })
        .where(eq(ragMessage.id, saved.id));
    }
    const visible = await service.getConversation(
      actor,
      conversation.id,
      undefined,
      [project.id],
      proposalIdentity.ctx,
    );
    assert.ok(
      visible.messages.find((m) => m.id === saved.id)?.reply?.actions?.length,
    );
    await db.insert(mcpToolPolicy).values({
      tokenId: proposalIdentity.ctx.tokenId,
      toolName: "workitem.update",
      effect: "DENY",
    });
    const hidden = await service.getConversation(
      actor,
      conversation.id,
      undefined,
      [project.id],
      proposalIdentity.ctx,
    );
    assert.equal(hidden.messages.find((m) => m.id === saved.id)?.reply, null);
    await assert.rejects(
      () =>
        service.sendMessage(
          actor,
          conversation.id,
          { requestId: saved.requestId, question: saved.question },
          [project.id],
          { token: proposalIdentity.ctx },
        ),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      () =>
        service.cancelMessage(
          actor,
          conversation.id,
          saved.requestId,
          [project.id],
          proposalIdentity.ctx,
        ),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      () =>
        service.decideAction(
          actor,
          conversation.id,
          saved.requestId,
          pending.id,
          "confirm",
          [project.id],
          proposalIdentity.ctx,
        ),
      { code: "FORBIDDEN" },
    );
    assert.equal((await getWorkItem(actor, item.id)).title, current.title);
    assert.equal((await getWorkItem(actor, item.id)).version, current.version);
    await db
      .delete(mcpToolPolicy)
      .where(eq(mcpToolPolicy.tokenId, proposalIdentity.ctx.tokenId));
    pass(
      `建议${mixed ? "与允许读取证据混合" : "独立"}的当前DENY隐藏历史并阻止重放/取消/确认，零业务写入`,
    );
  }
  for (const mixed of [false, true]) {
    const beforeDeniedStream = await getWorkItem(actor, item.id);
    let deniedTurns = 0;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      deniedTurns++;
      if (!body.tools)
        await db.insert(mcpToolPolicy).values({
          tokenId: proposalIdentity.ctx.tokenId,
          toolName: "workitem.update",
          effect: "DENY",
        });
      const delta =
        deniedTurns === 1
          ? {
              tool_calls: [
                ...(mixed
                  ? [
                      {
                        index: 1,
                        id: "allowed-read",
                        type: "function",
                        function: {
                          name: "workitem_get",
                          arguments: JSON.stringify({ workItemId: item.id }),
                        },
                      },
                    ]
                  : []),
                {
                  index: 0,
                  id: "denied-stream",
                  type: "function",
                  function: {
                    name: "propose_workitem_update",
                    arguments: JSON.stringify({
                      workItemId: item.id,
                      expectedVersion: beforeDeniedStream.version,
                      title: "must-not-stream",
                    }),
                  },
                },
              ],
            }
          : { content: "不得交付的建议正文" };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const deniedEvents: { type: string }[] = [];
    const deniedStream = await service.sendMessage(
      actor,
      conversation.id,
      { requestId: randomUUID(), question: "生成建议后策略撤销" },
      [project.id],
      {
        token: proposalIdentity.ctx,
        emit: async (event) => {
          deniedEvents.push(event);
        },
      },
    );
    assert.equal(deniedStream.message.status, "failed");
    assert.equal(deniedStream.message.reply, null);
    assert.ok(deniedEvents.some((e) => e.type === "reset"));
    assert.ok(!deniedEvents.some((e) => e.type === "delta"));
    assert.equal(
      (await getWorkItem(actor, item.id)).title,
      beforeDeniedStream.title,
    );
    assert.equal(
      (await getWorkItem(actor, item.id)).version,
      beforeDeniedStream.version,
    );
    await db
      .delete(mcpToolPolicy)
      .where(eq(mcpToolPolicy.tokenId, proposalIdentity.ctx.tokenId));
    pass(
      `建议${mixed ? "混合允许读取证据" : "独立"}登记后新增领域DENY：最终流reset、无delta、无持久化建议及业务写入`,
    );
  }
  await revokeToken(actor, proposalIdentity.ctx.tokenId);

  const madeToken = await createToken(actor, {
    name: "isolated-policy",
    tier: "READ_WRITE",
    projectWhitelist: [project.id],
  });
  const identity = (await authenticateToken(madeToken.token, null))!;
  await db.insert(mcpToolPolicy).values({
    tokenId: identity.ctx.tokenId,
    toolName: "workitem.list",
    effect: "DENY",
  });
  await assert.rejects(
    () =>
      executeAssistantTool(
        { ...access, token: identity.ctx },
        registry.find((t) => t.name === "workitem.list")!,
        { projectId: project.id },
      ),
    { code: "FORBIDDEN" },
  );
  pass("真实Bearer DENY策略不被内部网关绕过");
  const hidden = await service.getConversation(
    actor,
    conversation.id,
    undefined,
    [project.id],
    identity.ctx,
  );
  assert.equal(
    hidden.messages.find((m) => m.id === stream.message.id)?.reply,
    null,
  );
  pass("历史业务证据尊重当前Bearer工具策略");
  await assert.rejects(
    () =>
      service.cancelMessage(
        actor,
        conversation.id,
        stream.message.requestId,
        [project.id],
        identity.ctx,
      ),
    { code: "FORBIDDEN" },
  );
  pass("取消已完成回答的出口不能绕过Bearer历史DENY");
  await revokeToken(actor, identity.ctx.tokenId);
  await assert.rejects(
    () =>
      service.decideAction(
        actor,
        conversation.id,
        message.requestId,
        proposal.id,
        "confirm",
        [project.id],
        identity.ctx,
      ),
    { code: "FORBIDDEN" },
  );
  pass("已撤销令牌不能确认旧建议");
  await service.updateConversation(actor, conversation.id, { deleted: true });
  const deletion = await save({ ...stale, id: randomUUID() });
  await assert.rejects(
    () =>
      service.decideAction(
        actor,
        conversation.id,
        deletion.requestId,
        deletion.reply!.actions![0]!.id,
        "confirm",
      ),
    { code: "NOT_FOUND" },
  );
  pass("删除会话不能确认");
  await service.updateConversation(actor, conversation.id, { deleted: false });
  await db
    .delete(roleAssignment)
    .where(eq(roleAssignment.memberId, actor.memberId));
  await db
    .delete(projectMembership)
    .where(eq(projectMembership.memberId, actor.memberId));
  const history = await service.getConversation(actor, conversation.id);
  assert.ok(
    history.messages.every(
      (m) => m.status === "unavailable" && m.reply === null,
    ),
  );
  await assert.rejects(() =>
    service.decideAction(
      actor,
      conversation.id,
      message.requestId,
      proposal.id,
      "confirm",
    ),
  );
  pass("权限撤销历史与确认按当前权限投影");
  console.log(`统一助手隔离验证 ${passed} 项通过`);
} finally {
  globalThis.fetch = realFetch;
  await closeCache();
  await sql.end();
}
