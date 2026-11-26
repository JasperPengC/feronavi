import assert from "node:assert/strict";
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
const library = await import("../../src/server/services/test-case.service.ts");
const changes =
  await import("../../src/server/services/requirement-change.service.ts");
const code = (value: string) => (error: unknown) =>
  (error as { code?: string }).code === value;
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [owner, outsider] = await db
    .insert(member)
    .values([
      {
        username: "case-owner",
        name: "用例负责人",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
      {
        username: "case-outsider",
        name: "无权限成员",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
    ])
    .returning();
  await db
    .insert(roleAssignment)
    .values({
      memberId: owner!.id,
      roleId: adminRole!.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const actor = (await loadActor(owner!.id))!,
    denied = (await loadActor(outsider!.id))!;
  const project = await createProject(actor, {
    key: "CASE",
    name: "正式用例库",
  });
  const foreign = await createProject(actor, {
    key: "CASEX",
    name: "其它项目",
  });
  const req = (await wi.createWorkItem(actor, project.id, {
    type: "REQUIREMENT",
    title: "登录失效跳转",
    description: "保留返回地址",
  }))!;
  const baseline = await changes.getChangeContext(actor, req.id);
  const suite = await library.createTestSuite(actor, project.id, {
    name: "研发日常回归",
    description: "正式验收套件",
  });
  const input = {
    title: "会话失效返回登录",
    preconditions: "已登录且位于需求详情",
    steps: [
      {
        action: "使会话失效并打开受保护页面",
        expected: "跳转登录并保留返回地址",
      },
    ],
    requirements: [
      { workItemId: req.id, revisionId: baseline.baseRevision.id },
    ],
    suiteId: suite.id,
    priority: "HIGH",
    status: "READY",
  };
  const reader = {
    ...actor,
    permissions: new Set<string>(),
    rolePermissions: new Map<string, ReadonlySet<string>>(),
  };
  await assert.rejects(
    library.createTestCase(reader, project.id, input),
    code("FORBIDDEN"),
  );
  let item = await library.createTestCase(actor, project.id, input);
  assert.equal(item.key, "CASE-TC-1");
  assert.equal(item.revision.revisionNo, 1);
  assert.equal(
    item.revision.requirements[0]!.revisionId,
    baseline.baseRevision.id,
  );
  assert.equal(
    (await library.listTestCases(actor, project.id, {})).items.length,
    1,
  );
  await assert.rejects(
    library.getTestCase(denied, project.id, item.id),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    library.getTestCase(actor, foreign.id, item.id),
    code("FORBIDDEN"),
  );
  const original = item.revision;
  item = await library.updateTestCase(actor, project.id, item.id, {
    expectedVersion: item.version,
    priority: "URGENT",
  });
  assert.equal(item.revision.id, original.id, "优先级变动不新增正文版本");
  item = await library.updateTestCase(actor, project.id, item.id, {
    expectedVersion: item.version,
    title: "会话失效后回到原需求",
    steps: [...input.steps, { action: "重新登录", expected: "返回原需求详情" }],
  });
  assert.equal(item.revision.revisionNo, 2);
  assert.equal(
    (await library.getTestCaseRevision(actor, project.id, item.id, original.id))
      .steps.length,
    1,
  );
  const race = await Promise.allSettled(
    ["变化A", "变化B"].map((title) =>
      library.updateTestCase(actor, project.id, item.id, {
        expectedVersion: item.version,
        title,
      }),
    ),
  );
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    race.some(
      (r) => r.status === "rejected" && code("VERSION_CONFLICT")(r.reason),
    ),
  );
  item = await library.getTestCase(actor, project.id, item.id);
  await assert.rejects(
    library.updateTestSuite(actor, project.id, suite.id, {
      expectedVersion: suite.version,
      archived: true,
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  await assert.rejects(
    library.updateTestCase(actor, project.id, item.id, {
      expectedVersion: item.version,
      steps: [],
    }),
    code("VALIDATION"),
  );
  const foreignReq = (await wi.createWorkItem(actor, foreign.id, {
    type: "REQUIREMENT",
    title: "不可串项目",
  }))!;
  const foreignCtx = await changes.getChangeContext(actor, foreignReq.id);
  await assert.rejects(
    library.createTestCase(actor, project.id, {
      ...input,
      requirements: [
        { workItemId: foreignReq.id, revisionId: foreignCtx.baseRevision.id },
      ],
    }),
    code("FORBIDDEN"),
  );
  const ctx = await changes.getChangeContext(actor, req.id);
  assert.ok(
    ctx.impacts.some((i) => i.kind === "TEST_CASE" && i.targetId === item.id),
  );
  let proposal = await changes.createRequirementChange(actor, req.id, {
    title: "登录后回到原页面",
    description: req.description,
    baseRevisionId: ctx.baseRevision.id,
    expectedWorkItemVersion: ctx.workItemVersion,
    impactFingerprint: ctx.impactFingerprint,
    reason: "补充回跳验收",
  });
  item = await library.updateTestCase(actor, project.id, item.id, {
    expectedVersion: item.version,
    preconditions: "会话已过期",
  });
  await assert.rejects(
    changes.decideRequirementChange(actor, req.id, proposal.id, {
      expectedVersion: proposal.version,
      decision: "APPROVE",
    }),
    code("VERSION_CONFLICT"),
  );
  proposal = await changes.decideRequirementChange(actor, req.id, proposal.id, {
    expectedVersion: proposal.version,
    decision: "CANCEL",
  });
  const fresh = await changes.getChangeContext(actor, req.id);
  proposal = await changes.createRequirementChange(actor, req.id, {
    title: "登录后回到原页面",
    description: req.description,
    baseRevisionId: fresh.baseRevision.id,
    expectedWorkItemVersion: fresh.workItemVersion,
    impactFingerprint: fresh.impactFingerprint,
    reason: "基于最新用例重新评审",
  });
  proposal = await changes.decideRequirementChange(actor, req.id, proposal.id, {
    expectedVersion: proposal.version,
    decision: "APPROVE",
  });
  proposal = await changes.applyRequirementChange(actor, req.id, proposal.id, {
    expectedVersion: proposal.version,
    expectedWorkItemVersion: req.version,
  });
  const impact = proposal.impacts.find((i) => i.kind === "TEST_CASE")!;
  assert.ok(impact.canAcknowledge);
  proposal = await changes.acknowledgeRequirementImpact(
    actor,
    req.id,
    proposal.id,
    {
      impactId: impact.id,
      expectedVersion: proposal.version,
      note: "用例已评估，保持原需求基线可追溯",
    },
  );
  assert.equal(
    proposal.impacts.find((i) => i.id === impact.id)?.acknowledgedBy,
    actor.memberId,
  );
  assert.equal(
    (await library.getTestCase(actor, project.id, item.id)).revision
      .requirements[0]!.revisionId,
    baseline.baseRevision.id,
    "变更确认不偷偷改用例原基线",
  );
  await assert.rejects(
    sql`update test_case_revision set title='篡改历史' where id=${original.id}`,
    /immutable/u,
  );
  item = await library.updateTestCase(actor, project.id, item.id, {
    expectedVersion: item.version,
    status: "ARCHIVED",
  });
  await assert.rejects(
    library.updateTestCase(actor, project.id, item.id, {
      expectedVersion: item.version,
      status: "ARCHIVED",
      title: "绕过归档修改正文",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  assert.equal(
    (await library.listTestCases(actor, project.id, {})).items.length,
    0,
  );
  assert.ok(
    !(await changes.getChangeContext(actor, req.id)).impacts.some(
      (i) => i.targetId === item.id,
    ),
  );
  let archived = await library.updateTestSuite(actor, project.id, suite.id, {
    expectedVersion: suite.version,
    archived: true,
  });
  await assert.rejects(
    library.updateTestCase(actor, project.id, item.id, {
      expectedVersion: item.version,
      status: "READY",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  archived = await library.updateTestSuite(actor, project.id, suite.id, {
    expectedVersion: archived.version,
    archived: false,
  });
  item = await library.updateTestCase(actor, project.id, item.id, {
    expectedVersion: item.version,
    status: "READY",
  });
  assert.equal(
    (await library.listTestCases(actor, project.id, { suiteId: archived.id }))
      .items.length,
    1,
  );
  await (await import("./test-case-contracts.ts")).verifyTestCaseContracts(actor, denied, project.id, foreign.id);
  await sql`update project set archived_at=now() where id=${project.id}`;
  await assert.rejects(
    library.updateTestCase(actor, project.id, item.id, {
      expectedVersion: item.version,
      title: "归档拒绝",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  assert.equal(
    (await library.getTestCase(actor, project.id, item.id)).canManage,
    false,
  );
  console.log("test case library passed");
} finally {
  await sql.end({ timeout: 5 });
}
