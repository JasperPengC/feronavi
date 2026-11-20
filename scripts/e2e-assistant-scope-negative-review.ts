/** 只对随机隔离库执行：复现助手范围/归档/历史闭环边界。 */
import "./_env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { ensureInitialized } from "./_test-helpers.ts";
assert.match(
  new URL(process.env.DATABASE_URL!).pathname,
  /^\/feronavi_test_[a-f0-9]{32}$/u,
);
await ensureInitialized();
const { db, sql } = await import("../src/db/index.ts");
const { member, role, roleAssignment } =
  await import("../src/db/schema.ts");
const { loadActor } = await import("../src/server/auth/actor-loader.ts");
const projects = await import("../src/server/services/project.service.ts");
const gateway = await import("../src/server/services/assistant-tools.ts");
const { listRagProjects } =
  await import("../src/server/services/rag-projects.ts");
const service =
  await import("../src/server/services/rag-conversation.service.ts");
const repo = await import("../src/server/repos/rag-conversation.repo.ts");
const records: {
  name: string;
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}[] = [];
async function capture(name: string, f: () => Promise<unknown>) {
  try {
    const value = await f();
    records.push({ name, ok: true, value });
  } catch (error) {
    records.push({
      name,
      ok: false,
      code: (error as { code?: string }).code,
      message: (error as Error).message,
    });
  }
}
try {
  const [m] = await db
    .insert(member)
    .values({
      username: `scope-negative-${randomUUID().slice(0, 8)}`,
      name: "范围审查",
      passwordHash: "fixture-no-login",
      status: "ACTIVE",
    })
    .returning();
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  await db
    .insert(roleAssignment)
    .values({ memberId: m!.id, roleId: adminRole!.id, scopeType: "ORG" });
  const actor = (await loadActor(m!.id))!;
  const registry = await gateway.assistantRegistry();
  const getTool = (name: string) => {
    const tool = registry.find((t) => t.name === name);
    assert.ok(tool, name);
    return tool;
  };
  const p = await projects.createProject(actor, {
    key: "NEGATIVE",
    name: "归档边界项目",
  });
  let visible = (await listRagProjects(actor, undefined, true)).map(
    (p) => p.id,
  );
  let access = {
    actor,
    projectIds: visible,
    allowAccount: true,
    check: async () => {},
  };
  await capture("全范围项目归档可生成真实待确认卡", async () => {
    const action = await gateway.proposeAssistantAction(
      access,
      getTool("project.archive"),
      { projectId: p.id },
    );
    const c = await service.createConversation(actor, {});
    const requestId = randomUUID();
    await repo.insertMessage({
      conversationId: c.id,
      requestId,
      question: "归档这个项目",
      status: "completed",
      reply: {
        ok: true,
        answer: "请确认归档",
        citations: [],
        mode: "none",
        scope: { projectIds: visible, projectCount: visible.length },
        actions: [action],
      },
    });
    const confirmed = await service.decideAction(
      actor,
      c.id,
      requestId,
      action.id,
      "confirm",
    );
    const row = await repo.findMessage(c.id, requestId);
    const history = await service.getConversation(actor, c.id);
    assert.equal(confirmed.message.status, "completed");
    assert.ok(confirmed.message.reply);
    assert.equal(row?.reply?.actions?.[0]?.status, "confirmed");
    assert.equal(
      history.messages.find((message) => message.requestId === requestId)
        ?.status,
      "completed",
    );
    return {
      returnedStatus: confirmed.message.status,
      returnedReply: !!confirmed.message.reply,
      databaseAction: row?.reply?.actions?.[0]?.status,
      historyStatus: history.messages.find(
        (message) => message.requestId === requestId,
      )?.status,
    };
  });
  visible = (await listRagProjects(actor, undefined, true)).map((p) => p.id);
  access = {
    actor,
    projectIds: visible,
    allowAccount: true,
    check: async () => {},
  };
  await capture("已归档项目可以从全范围生成恢复卡", async () => {
    const action = await gateway.proposeAssistantAction(
      access,
      getTool("project.unarchive"),
      { projectId: p.id },
    );
    assert.equal(action.status, "pending");
    return { status: action.status };
  });
  await getTool("project.unarchive").handler(
    {
      actor,
      token: {
        memberId: actor.memberId,
        tokenId: "assistant-session",
        tier: "READ_WRITE",
        projectWhitelist: [],
      },
    },
    { projectId: p.id, userConfirmed: true },
  );
  await capture("固定项目添加成员保留全范围候选目录边界", async () => {
    await assert.rejects(
      () =>
        gateway.proposeAssistantAction(
          {
            actor,
            projectIds: [p.id],
            allowAccount: false,
            check: async () => {},
          },
          getTool("project.member.add"),
          {
            projectId: p.id,
            memberId: actor.memberId,
            roleIds: [adminRole!.id],
          },
        ),
      { code: "FORBIDDEN" },
    );
    return { requiresAccountScope: true };
  });
  await capture("固定项目移除成员逐条确认、写后复读与重放", async () => {
    const [target] = await db
      .insert(member)
      .values({
        username: `scope-remove-${randomUUID().slice(0, 8)}`,
        name: "待移除项目成员",
        passwordHash: "fixture-no-login",
        status: "ACTIVE",
      })
      .returning();
    const [memberRole] = await db
      .select()
      .from(role)
      .where(eq(role.key, "MEMBER"));
    const members =
      await import("../src/server/services/project-member.service.ts");
    await members.addProjectMember(actor, p.id, {
      memberId: target!.id,
      roleIds: [memberRole!.id],
    });
    const action = await gateway.proposeAssistantAction(
      { actor, projectIds: [p.id], allowAccount: false, check: async () => {} },
      getTool("project.member.remove"),
      { projectId: p.id, memberId: target!.id },
    );
    const c = await service.createConversation(actor, { projectId: p.id });
    const requestId = randomUUID();
    await repo.insertMessage({
      conversationId: c.id,
      requestId,
      question: "移除项目中的这个成员",
      status: "completed",
      reply: {
        ok: true,
        answer: "请确认成员移除",
        citations: [],
        mode: "none",
        scope: { projectIds: [p.id], projectCount: 1 },
        actions: [action],
      },
    });
    assert.ok(
      (await projects.membersOf(actor, p.id)).some(
        (row) => row.id === target!.id,
      ),
      "确认前不执行移除",
    );
    const confirmed = await service.decideAction(
      actor,
      c.id,
      requestId,
      action.id,
      "confirm",
    );
    assert.equal(confirmed.message.status, "completed");
    const saved = confirmed.message.reply!.actions![0]!;
    assert.equal(saved.status, "confirmed");
    assert.deepEqual(saved.result?.verificationReads, [
      { toolName: "project.members", parameters: { projectId: p.id } },
    ]);
    assert.ok(
      !(await projects.membersOf(actor, p.id)).some(
        (row) => row.id === target!.id,
      ),
    );
    const replayed = await service.decideAction(
      actor,
      c.id,
      requestId,
      action.id,
      "confirm",
    );
    assert.equal(replayed.message.reply!.actions![0]!.status, "confirmed");
    assert.equal(
      (await service.getConversation(actor, c.id)).messages[0]!.status,
      "completed",
    );
    return {
      checks: 7,
      status: saved.status,
      projectScope: p.id,
      verificationTools: saved.result?.verificationReads?.map(
        (read) => read.toolName,
      ),
      removed: true,
      replay: true,
    };
  });
  await capture(
    "归档发现仍遵守项目可见性、显式空集合和Token白名单",
    async () => {
      await getTool("project.archive").handler(
        {
          actor,
          token: {
            memberId: actor.memberId,
            tokenId: "assistant-session",
            tier: "READ_WRITE",
            projectWhitelist: [],
          },
        },
        { projectId: p.id, userConfirmed: true },
      );
      const other = await projects.createProject(actor, {
        key: "OTHERNEG",
        name: "不可见归档项目",
      });
      await getTool("project.archive").handler(
        {
          actor,
          token: {
            memberId: actor.memberId,
            tokenId: "assistant-session",
            tier: "READ_WRITE",
            projectWhitelist: [],
          },
        },
        { projectId: other.id, userConfirmed: true },
      );
      const [reader] = await db
        .insert(member)
        .values({
          username: `scope-reader-${randomUUID().slice(0, 8)}`,
          name: "项目读者",
          passwordHash: "fixture-no-login",
          status: "ACTIVE",
        })
        .returning();
      const [memberRole] = await db
        .select()
        .from(role)
        .where(eq(role.key, "MEMBER"));
      const [grant] = await db
        .insert(roleAssignment)
        .values({
          memberId: reader!.id,
          roleId: memberRole!.id,
          scopeType: "PROJECT",
          scopeId: p.id,
        })
        .returning();
      const readerActor = (await loadActor(reader!.id))!;
      const scoped = await listRagProjects(readerActor, undefined, true);
      assert.deepEqual(
        scoped.map((p) => p.id),
        [p.id],
      );
      assert.equal(scoped[0]!.archived, true);
      assert.deepEqual(await listRagProjects(actor, [], true), []);
      assert.deepEqual((await listRagProjects(actor, [p.id], true)).map(row => row.id), [p.id]);
      const filtered = (await getTool("project.list").handler(
        {
          actor,
          token: {
            memberId: actor.memberId,
            tokenId: "assistant-session",
            tier: "READ_ONLY",
            projectWhitelist: [p.id],
          },
        },
        { page: 1, pageSize: 1 },
      )) as { items: { id: string }[]; total: number };
      assert.equal(filtered.total, 0);
      assert.deepEqual(
        filtered.items.map((item) => item.id),
        [],
      );
      await db.delete(roleAssignment).where(eq(roleAssignment.id, grant!.id));
      const revoked = (await loadActor(reader!.id))!;
      assert.deepEqual(await listRagProjects(revoked, undefined, true), []);
      await assert.rejects(
        () =>
          gateway.proposeAssistantAction(
            {
              actor: revoked,
              projectIds: [p.id],
              allowAccount: true,
              check: async () => {},
            },
            getTool("project.unarchive"),
            { projectId: p.id },
          ),
        (error) =>
          ["FORBIDDEN", "NOT_FOUND"].includes((error as { code: string }).code),
      );
      const { assertAssistantReplyReadable } =
        await import("../src/server/services/assistant-access.ts");
      await assert.rejects(
        () =>
          assertAssistantReplyReadable(
            revoked,
            {
              ok: true,
              answer: "归档项目旧回答",
              citations: [],
              mode: "none",
              scope: { projectIds: [p.id], projectCount: 1 },
              evidence: [
                {
                  id: randomUUID(),
                  toolName: "project.get",
                  projectId: p.id,
                  scope: { kind: "project", projectIds: [p.id] },
                  observedAt: new Date().toISOString(),
                  resources: [],
                  summary: "隔离验收项目证据",
                  verificationReads: [
                    {
                      toolName: "project.get",
                      parameters: { projectId: p.id },
                    },
                  ],
                },
              ],
            },
            [],
          ),
        { code: "FORBIDDEN" },
      );
      return {
        checks: 8,
        archivedVisibility: true,
        emptyScope: true,
        tokenFilter: true,
        revokedProposal: "denied",
        revokedHistory: "denied",
      };
    },
  );
  await mkdir(".cache/full-business-closure", {
    recursive: true,
  });
  await writeFile(
    ".cache/full-business-closure/assistant-scope-negative-review.json",
    JSON.stringify({ records }, null, 2),
  );
  console.log(JSON.stringify({ records }, null, 2));
  assert.ok(
    records.every((record) => record.ok),
    "范围与生命周期验收存在未通过项，见结构化证据",
  );
} finally {
  await (await import("../src/server/auth/cache.ts")).closeCache();
  await sql.end();
}
