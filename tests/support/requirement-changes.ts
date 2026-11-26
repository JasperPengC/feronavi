import assert from "node:assert/strict";
import Fastify from "fastify";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolCtx } from "../../src/server/application/capabilities/tools.ts";
import { describeTool } from "../../src/server/application/capabilities/contracts.ts";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
await (
  await import("../../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts");
const { member, role, roleAssignment } = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } =
  await import("../../src/server/services/project.service.ts");
const wi = await import("../../src/server/services/work-item.service.ts");
const plan = await import("../../src/server/services/planning.service.ts");
const changes =
  await import("../../src/server/services/requirement-change.service.ts");
const errorCode = (expected: string) => (e: unknown) =>
  (e as { code?: string }).code === expected;
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [owner, other] = await db
    .insert(member)
    .values([
      {
        username: "change-owner",
        name: "变更负责人",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
      {
        username: "change-other",
        name: "受影响人",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
    ])
    .returning();
  assert.ok(owner && other && adminRole);
  await db
    .insert(roleAssignment)
    .values({
      memberId: owner.id,
      roleId: adminRole.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const actor = (await loadActor(owner.id))!;
  const outsider = (await loadActor(other.id))!;
  const reader = {
    ...actor,
    memberId: other.id,
    permissions: new Set<string>(),
    rolePermissions: new Map<string, ReadonlySet<string>>(),
  };
  const project = await createProject(actor, {
    key: "CHANGE",
    name: "需求变更验收",
  });
  const milestone = await plan.createPlan(actor, project.id, "milestone", {
    name: "需求交付",
  });
  let requirement = (await wi.createWorkItem(actor, project.id, {
    type: "REQUIREMENT",
    title: "原需求",
    description: "原文",
    milestoneId: milestone.id,
  }))!;
  const task = (await wi.createWorkItem(actor, project.id, {
    type: "TASK",
    title: "受影响任务",
    parentId: requirement.id,
    assigneeId: other.id,
  }))!;
  const makeInput = async (title: string) => {
    const c = await changes.getChangeContext(actor, requirement.id);
    return {
      baseRevisionId: c.baseRevision.id,
      expectedWorkItemVersion: c.workItemVersion,
      impactFingerprint: c.impactFingerprint,
      title,
      description: "变更正文",
      reason: "业务规则调整",
    };
  };
  const context = await changes.getChangeContext(actor, requirement.id);
  assert.deepEqual(
    new Set(context.impacts.map((i) => i.targetId)),
    new Set([task.id, milestone.id]),
  );
  const input = await makeInput("修订后的需求");
  await assert.rejects(
    changes.createRequirementChange(reader, requirement.id, input),
    errorCode("FORBIDDEN"),
  );
  let request = await changes.createRequirementChange(
    actor,
    requirement.id,
    input,
  );
  assert.equal(request.status, "PENDING");
  assert.equal((await wi.getWorkItem(actor, requirement.id)).title, "原需求");
  assert.equal(request.baseRevision.id, context.baseRevision.id);
  await assert.rejects(
    changes.getRequirementChange(outsider, requirement.id, request.id),
    errorCode("FORBIDDEN"),
  );
  await assert.rejects(
    changes.decideRequirementChange(reader, requirement.id, request.id, {
      decision: "APPROVE",
      expectedVersion: request.version,
    }),
    errorCode("FORBIDDEN"),
  );
  await assert.rejects(
    changes.applyRequirementChange(actor, requirement.id, request.id, {
      expectedVersion: request.version,
      expectedWorkItemVersion: requirement.version,
    }),
    errorCode("BLOCKED_BY_PREREQUISITE"),
  );
  const reviewed = await Promise.allSettled(
    [1, 2].map(() =>
      changes.decideRequirementChange(actor, requirement.id, request.id, {
        decision: "APPROVE",
        expectedVersion: request.version,
        note: "范围已核对",
      }),
    ),
  );
  assert.equal(reviewed.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    reviewed.some(
      (r) => r.status === "rejected" && errorCode("VERSION_CONFLICT")(r.reason),
    ),
  );
  request = await changes.getRequirementChange(
    actor,
    requirement.id,
    request.id,
  );
  assert.equal(request.status, "APPROVED");
  const before =
    await sql`select count(*)::int n from requirement_revision where work_item_id=${requirement.id}`;
  request = await changes.applyRequirementChange(
    actor,
    requirement.id,
    request.id,
    {
      expectedVersion: request.version,
      expectedWorkItemVersion: requirement.version,
    },
  );
  assert.equal(request.status, "APPLIED");
  assert.ok(request.appliedRevisionId);
  requirement = await wi.getWorkItem(actor, requirement.id);
  assert.equal(requirement.title, input.title);
  assert.equal(
    (
      await sql`select count(*)::int n from requirement_revision where work_item_id=${requirement.id}`
    )[0]!.n,
    before[0]!.n + 1,
  );
  assert.equal(request.baseRevision.description, "原文");
  assert.equal(
    (
      await sql`select title from requirement_revision where id=${request.appliedRevisionId}`
    )[0]!.title,
    input.title,
  );
  const impact = request.impacts.find((i) => i.targetId === task.id)!;
  request = await changes.acknowledgeRequirementImpact(
    reader,
    requirement.id,
    request.id,
    {
      impactId: impact.id,
      expectedVersion: request.version,
      note: "已评估，需要更新实现",
    },
  );
  assert.equal(
    request.impacts.find((i) => i.id === impact.id)?.acknowledgedBy,
    other.id,
  );
  assert.equal(
    (await wi.getWorkItem(actor, task.id)).version,
    task.version,
    "确认不能冒充任务完成",
  );
  await assert.rejects(
    changes.acknowledgeRequirementImpact(reader, requirement.id, request.id, {
      impactId: request.impacts.find((i) => i.targetId === milestone.id)!.id,
      expectedVersion: request.version,
    }),
    errorCode("FORBIDDEN"),
  );
  await assert.rejects(
    sql`update requirement_change set proposed_title='篡改' where id=${request.id}`,
    /immutable/u,
  );

  let stale = await changes.createRequirementChange(
    actor,
    requirement.id,
    await makeInput("即将过期"),
  );
  requirement = (await wi.updateWorkItem(actor, requirement.id, {
    title: "另一个编辑",
    version: requirement.version,
  }))!;
  await assert.rejects(
    changes.decideRequirementChange(actor, requirement.id, stale.id, {
      decision: "APPROVE",
      expectedVersion: stale.version,
    }),
    errorCode("VERSION_CONFLICT"),
  );
  stale = await changes.decideRequirementChange(
    actor,
    requirement.id,
    stale.id,
    {
      decision: "REJECT",
      expectedVersion: stale.version,
      note: "需要基于新版本重新提出",
    },
  );
  assert.equal(stale.status, "REJECTED");

  let changedImpact = await changes.createRequirementChange(
    actor,
    requirement.id,
    await makeInput("新增影响前"),
  );
  changedImpact = await changes.decideRequirementChange(
    actor,
    requirement.id,
    changedImpact.id,
    {
      decision: "APPROVE",
      expectedVersion: changedImpact.version,
      note: "原影响范围评审通过",
    },
  );
  await wi.createWorkItem(actor, project.id, {
    type: "TASK",
    title: "新加入的任务",
    parentId: requirement.id,
  });
  await assert.rejects(
    changes.applyRequirementChange(actor, requirement.id, changedImpact.id, {
      expectedVersion: changedImpact.version,
      expectedWorkItemVersion: requirement.version,
    }),
    errorCode("VERSION_CONFLICT"),
  );
  assert.equal(
    (await wi.getWorkItem(actor, requirement.id)).title,
    "另一个编辑",
  );
  changedImpact = await changes.decideRequirementChange(
    actor,
    requirement.id,
    changedImpact.id,
    {
      decision: "CANCEL",
      expectedVersion: changedImpact.version,
      note: "新增影响需重新评审",
    },
  );
  assert.equal(changedImpact.status, "CANCELLED");
  assert.equal(
    changedImpact.reviewNote,
    "原影响范围评审通过",
    "撤回不能覆盖原评审意见",
  );

  let atomic = await changes.createRequirementChange(
    actor,
    requirement.id,
    await makeInput("事务验证"),
  );
  atomic = await changes.decideRequirementChange(
    actor,
    requirement.id,
    atomic.id,
    { decision: "APPROVE", expectedVersion: atomic.version },
  );
  await sql`create function fail_change_fixture() returns trigger language plpgsql as $$ begin raise exception 'change fixture failure'; end $$`;
  await sql`create trigger fail_change_fixture before insert on requirement_revision for each row execute function fail_change_fixture()`;
  await assert.rejects(
    changes.applyRequirementChange(actor, requirement.id, atomic.id, {
      expectedVersion: atomic.version,
      expectedWorkItemVersion: requirement.version,
    }),
    (e) => (e as { cause?: Error }).cause?.message === "change fixture failure",
  );
  assert.equal(
    (await changes.getRequirementChange(actor, requirement.id, atomic.id))
      .status,
    "APPROVED",
  );
  assert.equal(
    (await wi.getWorkItem(actor, requirement.id)).version,
    requirement.version,
  );
  await sql`drop trigger fail_change_fixture on requirement_revision`;
  await sql`drop function fail_change_fixture()`;
  assert.equal(
    (await changes.listRequirementChanges(actor, requirement.id, { limit: 2 }))
      .items.length,
    2,
  );
  assert.ok(
    request.participants.some(
      (p) => p.id === other.id && p.name === "受影响人",
    ),
  );
  const again = await changes.acknowledgeRequirementImpact(
    reader,
    requirement.id,
    request.id,
    { impactId: impact.id, expectedVersion: request.version },
  );
  assert.equal(again.version, request.version, "确认重放不改版本");
  await assert.rejects(
    changes.acknowledgeRequirementImpact(reader, requirement.id, request.id, {
      impactId: impact.id,
      expectedVersion: request.version - 1,
    }),
    errorCode("VERSION_CONFLICT"),
  );
  await sql`update project set lifecycle_lock=true where id=${project.id}`;
  await assert.rejects(
    changes.createRequirementChange(
      actor,
      requirement.id,
      await makeInput("锁定拒绝"),
    ),
    errorCode("BLOCKED_BY_PREREQUISITE"),
  );
  await sql`update project set lifecycle_lock=false,archived_at=now() where id=${project.id}`;
  await assert.rejects(
    changes.decideRequirementChange(actor, requirement.id, atomic.id, {
      decision: "CANCEL",
      expectedVersion: atomic.version,
    }),
    errorCode("BLOCKED_BY_PREREQUISITE"),
  );
  await sql`update project set archived_at=null where id=${project.id}`;
  // 申请人仍有权限，但原评审人被撤权后不能沿用旧批准。
  await db
    .insert(roleAssignment)
    .values({
      memberId: other.id,
      roleId: adminRole.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const reviewer = (await loadActor(other.id))!;
  let revoked = await changes.createRequirementChange(
    actor,
    requirement.id,
    await makeInput("撤权评审"),
  );
  revoked = await changes.decideRequirementChange(
    reviewer,
    requirement.id,
    revoked.id,
    { expectedVersion: revoked.version, decision: "APPROVE" },
  );
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, other.id));
  await assert.rejects(
    changes.applyRequirementChange(actor, requirement.id, revoked.id, {
      expectedVersion: revoked.version,
      expectedWorkItemVersion: requirement.version,
    }),
    errorCode("BLOCKED_BY_PREREQUISITE"),
  );
  const relations =
      await import("../../src/server/services/relation.service.ts"),
    links = await import("../../src/server/services/work-item-link.service.ts");
  const linked = (await wi.createWorkItem(actor, project.id, {
    type: "TASK",
    title: "直接关联",
  }))!;
  const relation = await relations.addRelation(actor, requirement.id, {
    targetId: linked.id,
    type: "RELATES_TO",
  });
  assert.ok(
    (await changes.getChangeContext(actor, requirement.id)).impacts.some(
      (i) => i.targetId === linked.id,
    ),
  );
  const linkedProposal = await changes.createRequirementChange(
    actor,
    requirement.id,
    await makeInput("影响发生变化"),
  );
  await wi.updateWorkItem(actor, linked.id, {
    title: "关联任务已修改",
    version: linked.version,
  });
  await assert.rejects(
    changes.decideRequirementChange(actor, requirement.id, linkedProposal.id, {
      expectedVersion: linkedProposal.version,
      decision: "APPROVE",
    }),
    errorCode("VERSION_CONFLICT"),
  );
  await relations.removeRelation(actor, requirement.id, relation!.id);
  assert.ok(
    !(await changes.getChangeContext(actor, requirement.id)).impacts.some(
      (i) => i.targetId === linked.id,
    ),
  );
  const link = await links.createLink(actor, requirement.id, {
    targetId: linked.id,
    targetType: "WORK_ITEM",
  });
  assert.ok(
    (await changes.getChangeContext(actor, requirement.id)).impacts.some(
      (i) => i.targetId === linked.id,
    ),
  );
  await links.deleteLink(actor, link.id);
  const otherProject = await createProject(actor, {
    key: "CHANGEX",
    name: "其它项目",
  });
  const external = (await wi.createWorkItem(actor, otherProject.id, {
    type: "TASK",
    title: "跨项目关联",
  }))!;
  await relations.addRelation(actor, requirement.id, {
    targetId: external.id,
    type: "RELATES_TO",
  });
  assert.ok(
    !(await changes.getChangeContext(actor, requirement.id)).impacts.some(
      (i) => i.targetId === external.id,
    ),
  );
  await sql`update work_item set deleted_at=now() where id=${task.id}`;
  const deleted = await changes.getRequirementChange(
    actor,
    requirement.id,
    request.id,
  );
  assert.equal(
    deleted.impacts.find((i) => i.targetId === task.id)?.available,
    false,
  );
  assert.equal(
    deleted.impacts.find((i) => i.targetId === task.id)?.title,
    "受影响任务",
  );
  const { ALL_TOOLS } =
    await import("../../src/server/application/capabilities/tools.ts");
  const ctx = {
    actor,
    token: {
      tokenId: "changes-contract",
      memberId: actor.memberId,
      tier: "READ_WRITE",
      projectWhitelist: [project.id],
    },
  } as ToolCtx;
  const validator = new AjvJsonSchemaValidator();
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = ALL_TOOLS.find((t) => t.name === `requirementChange.${name}`)!;
    const out = await tool.handler(ctx, {
      workItemId: requirement.id,
      ...args,
    });
    assert.equal(
      validator.getValidator(describeTool(tool).outputSchema!)(JSON.parse(JSON.stringify(out)))
        .valid,
      true,
      name,
    );
    return out;
  };
  const mcpContext = (await call("context", {})) as Awaited<
    ReturnType<typeof changes.getChangeContext>
  >;
  const payload = {
    workItemId: requirement.id,
    ...(await makeInput("MCP完整流程")),
    baseRevisionId: mcpContext.baseRevision.id,
    userConfirmed: true,
    idempotencyKey: "change-once",
  };
  let mcp = (await call("create", payload)) as typeof request;
  assert.equal(((await call("create", payload)) as typeof request).id, mcp.id);
  const create = ALL_TOOLS.find((t) => t.name === "requirementChange.create")!;
  await assert.rejects(
    create.handler({ ...ctx, actor: { ...actor, grants: [] } }, payload),
    errorCode("FORBIDDEN"),
  );
  await assert.rejects(
    create.handler(
      { ...ctx, token: { ...ctx.token, tier: "READ_ONLY" } },
      payload,
    ),
    errorCode("FORBIDDEN"),
  );
  await assert.rejects(
    create.handler(ctx, { ...payload, userConfirmed: false }),
    errorCode("COMMAND_CONFIRMATION_REQUIRED"),
  );
  await assert.rejects(
    create.handler(
      { ...ctx, token: { ...ctx.token, projectWhitelist: [otherProject.id] } },
      payload,
    ),
    errorCode("NOT_FOUND"),
  );
  await call("list", { limit: 2 });
  await call("get", { changeId: mcp.id });
  mcp = (await call("decide", {
    changeId: mcp.id,
    expectedVersion: mcp.version,
    decision: "APPROVE",
    userConfirmed: true,
  })) as typeof request;
  mcp = (await call("apply", {
    changeId: mcp.id,
    expectedVersion: mcp.version,
    expectedWorkItemVersion: requirement.version,
    userConfirmed: true,
  })) as typeof request;
  await call("acknowledge", {
    changeId: mcp.id,
    impactId: mcp.impacts[0]!.id,
    expectedVersion: mcp.version,
    userConfirmed: true,
  });
  const app = Fastify();
  app.decorate("csrfProtection", async () => {});
  app.addHook("onRequest", async (req) => {
    req.actor = req.headers["x-denied"] ? outsider : actor;
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as { httpStatus?: number; code?: string };
    reply.status(e.httpStatus ?? 500).send({ code: e.code });
  });
  await (
    await import("../../src/server/routes/requirement-changes.ts")
  ).registerRequirementChangeRoutes(app);
  try {
    const base = `/api/v1/work-items/${requirement.id}/changes`;
    assert.equal(
      (await app.inject({ method: "GET", url: base + "/context" })).statusCode,
      200,
    );
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: await makeInput("REST流程"),
    });
    assert.equal(created.statusCode, 201);
    let value = created.json();
    assert.equal(
      (await app.inject({ method: "GET", url: base + `/${value.id}` })).json()
        .status,
      "PENDING",
    );
    assert.equal(
      (await app.inject({ method: "GET", url: base })).statusCode,
      200,
    );
    value = (
      await app.inject({
        method: "POST",
        url: base + `/${value.id}/decide`,
        payload: { decision: "APPROVE", expectedVersion: value.version },
      })
    ).json();
    const current = await wi.getWorkItem(actor, requirement.id);
    value = (
      await app.inject({
        method: "POST",
        url: base + `/${value.id}/apply`,
        payload: {
          expectedVersion: value.version,
          expectedWorkItemVersion: current.version,
        },
      })
    ).json();
    assert.equal(value.status, "APPLIED");
    const ack = await app.inject({
      method: "POST",
      url: base + `/${value.id}/acknowledge`,
      payload: {
        expectedVersion: value.version,
        impactId: value.impacts[0].id,
      },
    });
    assert.equal(ack.statusCode, 200);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: base,
          headers: { "x-denied": "1" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
  console.log("requirement changes contracts passed");
} finally {
  await sql.end({ timeout: 5 });
}
