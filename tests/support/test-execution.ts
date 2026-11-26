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
const library = await import("../../src/server/services/test-case.service.ts");
const execution = await import("../../src/server/services/test-run.service.ts");
const wi = await import("../../src/server/services/work-item.service.ts");
const code = (value: string) => (error: unknown) =>
  (error as { code?: string }).code === value;
try {
  const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
  const [m, outsider] = await db
    .insert(member)
    .values([
      {
        username: "run-owner",
        name: "执行验收",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
      {
        username: "run-outsider",
        name: "不可见成员",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
    ])
    .returning();
  await db.insert(roleAssignment).values({
    memberId: m!.id,
    roleId: adminRole!.id,
    scopeType: "ORG",
    scopeId: null,
  });
  const actor = (await loadActor(m!.id))!,
    denied = (await loadActor(outsider!.id))!;
  const p = await createProject(actor, { key: "RUN", name: "执行项目" }),
    foreign = await createProject(actor, { key: "RUNX", name: "外部项目" });
  let first = await library.createTestCase(actor, p.id, {
    title: "第一用例",
    status: "READY",
    steps: [
      { action: "打开", expected: "显示" },
      { action: "保存", expected: "成功" },
    ],
  });
  const second = await library.createTestCase(actor, p.id, {
    title: "第二用例",
    status: "READY",
    steps: [{ action: "退出", expected: "结束会话" }],
  });
  const draft = await library.createTestCase(actor, p.id, {
    title: "草稿用例",
  });
  await assert.rejects(
    execution.createTestPlan(actor, p.id, {
      title: "不应成功",
      build: "abc123",
      environment: "local",
      cases: [{ caseId: draft.id, revisionId: draft.currentRevisionId }],
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  let plan = await execution.createTestPlan(actor, p.id, {
    title: "第一轮回归",
    build: "build-abc123",
    environment: "local-51476",
    cases: [
      { caseId: first.id, revisionId: first.currentRevisionId },
      { caseId: second.id, revisionId: second.currentRevisionId },
    ],
  });
  assert.equal(plan.key, "RUN-TP-1");
  assert.equal(plan.status, "DRAFT");
  assert.equal(plan.cases.length, 2);
  await assert.rejects(
    execution.getTestPlan(denied, p.id, plan.id),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    execution.getTestPlan(actor, foreign.id, plan.id),
    code("FORBIDDEN"),
  );
  first = await library.updateTestCase(actor, p.id, first.id, {
    expectedVersion: first.version,
    steps: [{ action: "已更新动作", expected: "已更新预期" }],
  });
  assert.equal(
    (await execution.getTestPlan(actor, p.id, plan.id)).cases[0]!.revisionId,
    plan.cases[0]!.revisionId,
    "后续用例更新不改提测固定版本",
  );
  plan = await execution.transitionTestPlan(actor, p.id, plan.id, {
    expectedVersion: plan.version,
    action: "START",
  });
  await assert.rejects(
    execution.updateTestPlan(actor, p.id, plan.id, {
      expectedVersion: plan.version,
      build: "偷换构建",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  await assert.rejects(
    execution.transitionTestPlan(actor, p.id, plan.id, {
      expectedVersion: plan.version,
      action: "COMPLETE",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  let run = await execution.startTestRun(actor, p.id, plan.id, {
    planCaseId: plan.cases[0]!.id,
    source: "MANUAL",
  });
  assert.equal(run.revision.steps.length, 2);
  assert.equal(run.status, "IN_PROGRESS");
  await assert.rejects(
    execution.startTestRun(actor, p.id, plan.id, {
      planCaseId: plan.cases[0]!.id,
      source: "MANUAL",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  await assert.rejects(
    execution.completeTestRun(actor, p.id, run.id, {
      expectedVersion: run.version,
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  const race = await Promise.allSettled(
    ["A", "B"].map((actual) =>
      execution.recordTestRun(actor, p.id, run.id, {
        expectedVersion: run.version,
        results: [{ stepIndex: 0, status: "PASSED", actual, evidence: [] }],
      }),
    ),
  );
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  run = await execution.getTestRun(actor, p.id, run.id);
  run = await execution.recordTestRun(actor, p.id, run.id, {
    expectedVersion: run.version,
    results: [
      {
        stepIndex: 1,
        status: "FAILED",
        actual: "保存按钮无响应",
        evidence: ["http://127.0.0.1:51476/projects/" + p.id + "/testing"],
      },
    ],
  });
  run = await execution.completeTestRun(actor, p.id, run.id, {
    expectedVersion: run.version,
  });
  assert.equal(run.status, "FAILED");
  await assert.rejects(
    execution.recordTestRun(actor, p.id, run.id, {
      expectedVersion: run.version,
      results: [
        { stepIndex: 1, status: "PASSED", actual: "篡改", evidence: [] },
      ],
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  const defect = await execution.createTestRunDefect(actor, p.id, run.id, {
    title: "保存按钮无响应",
    priority: "HIGH",
    severity: "S2",
  });
  assert.equal(defect.defect.type, "DEFECT");
  assert.equal(defect.defect.projectId, p.id);
  const repeated = await execution.createTestRunDefect(actor, p.id, run.id, {
    title: "保存按钮无响应",
    priority: "HIGH",
    severity: "S2",
  });
  assert.equal(
    repeated.defect.id,
    defect.defect.id,
    "每条失败执行自动建单不重复",
  );
  const external = (await wi.createWorkItem(actor, foreign.id, {
    type: "DEFECT",
    title: "跨项目缺陷",
  }))!;
  await assert.rejects(
    execution.linkTestRunDefect(actor, p.id, run.id, { defectId: external.id }),
    code("FORBIDDEN"),
  );
  let retest = await execution.startTestRun(actor, p.id, plan.id, {
    planCaseId: plan.cases[0]!.id,
    retestOf: run.id,
    build: "fixed-build",
    environment: "local-fixed",
    source: "AGENT",
    sourceReference: "local-codex-run-1",
  });
  assert.equal(retest.attempt, 2);
  assert.equal(retest.build, "fixed-build");
  assert.equal(run.build, "build-abc123");
  assert.equal(retest.retestOf, run.id);
  assert.equal(retest.revision.id, run.revision.id);
  assert.equal(retest.sourceVerification, "SELF_REPORTED");
  retest = await execution.recordTestRun(actor, p.id, retest.id, {
    expectedVersion: retest.version,
    results: [
      { stepIndex: 0, status: "PASSED", actual: "显示正常", evidence: [] },
      {
        stepIndex: 1,
        status: "PASSED",
        actual: "修复后保存成功",
        evidence: [],
      },
    ],
  });
  retest = await execution.completeTestRun(actor, p.id, retest.id, {
    expectedVersion: retest.version,
  });
  assert.equal(retest.status, "PASSED");
  assert.equal(
    (await wi.getWorkItem(actor, defect.defect.id)).statusKey,
    "NEW",
    "复测不自动关闭缺陷",
  );
  assert.equal(
    (await execution.getTestRun(actor, p.id, run.id)).status,
    "FAILED",
  );
  let last = await execution.startTestRun(actor, p.id, plan.id, {
    planCaseId: plan.cases[1]!.id,
    source: "AUTOMATION",
    sourceReference: "local-fixture-1",
  });
  last = await execution.recordTestRun(actor, p.id, last.id, {
    expectedVersion: last.version,
    results: [
      {
        stepIndex: 0,
        status: "BLOCKED",
        actual: "依赖服务不可用",
        evidence: [],
      },
    ],
  });
  last = await execution.completeTestRun(actor, p.id, last.id, {
    expectedVersion: last.version,
  });
  assert.equal(last.status, "BLOCKED");
  const report = await execution.getTestPlanReport(actor, p.id, plan.id);
  assert.equal(report.testedBuild,null,"混合构建不能冒充同一构建报告");
  assert.equal(report.totalAttempts, 3);
  assert.equal(report.latestResults.PASSED, 1);
  assert.equal(report.latestResults.BLOCKED, 1);
  assert.equal(report.latestResults.FAILED, 0);
  assert.equal(report.allAttempts.FAILED, 1);
  assert.equal(report.passed, false);
  assert.equal(report.cases[0]!.runs[0]!.defects[0]!.id, defect.defect.id);
  plan = await execution.transitionTestPlan(actor, p.id, plan.id, {
    expectedVersion: plan.version,
    action: "COMPLETE",
  });
  assert.equal(plan.status, "COMPLETED");
  await assert.rejects(
    execution.startTestRun(actor, p.id, plan.id, {
      planCaseId: plan.cases[0]!.id,
      retestOf: retest.id,
      build: "fixed-build",
      environment: "local-fixed",
      source: "MANUAL",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  await assert.rejects(
    sql`update test_run set status='PASSED' where id=${run.id}`,
    /immutable/u,
  );
  await assert.rejects(
    sql`update test_plan set build='changed' where id=${plan.id}`,
    /immutable/u,
  );
  await assert.rejects(
    sql`insert into test_plan_case(plan_id,case_id,revision_id,position) values(${plan.id},${draft.id},${draft.currentRevisionId},2)`,
    /immutable/u,
  );
  let cancel = await execution.createTestPlan(actor, p.id, {
    title: "取消仍保留执行记录",
    build: "cancel-build",
    environment: "local",
    cases: [{ caseId: second.id, revisionId: second.currentRevisionId }],
  });
  cancel = await execution.transitionTestPlan(actor, p.id, cancel.id, {
    expectedVersion: cancel.version,
    action: "START",
  });
  await assert.rejects(
    execution.startTestRun(actor, p.id, cancel.id, {
      planCaseId: cancel.cases[0]!.id,
      source: "AGENT",
    }),
    code("VALIDATION"),
  );
  const cancelledRun = await execution.startTestRun(actor, p.id, cancel.id, {
    planCaseId: cancel.cases[0]!.id,
  });
  await assert.rejects(
    execution.recordTestRun(actor, p.id, cancelledRun.id, {
      expectedVersion: 1,
      results: [
        {
          stepIndex: 0,
          status: "PASSED",
          actual: "bad link",
          evidence: ["/Users/example/file.png"],
        },
      ],
    }),
    code("VALIDATION"),
  );
  cancel = await execution.transitionTestPlan(actor, p.id, cancel.id, {
    expectedVersion: cancel.version,
    action: "CANCEL",
    reason: "环境撤回",
  });
  assert.equal(cancel.status, "CANCELLED");
  const cancelled = await execution.getTestRun(actor, p.id, cancelledRun.id);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancelReason, "环境撤回");
  assert.equal(
    (await execution.getTestPlanReport(actor, p.id, cancel.id)).passed,
    false,
  );
  const noExecute = {
    ...actor,
    permissions: new Set<string>(),
    rolePermissions: new Map<string, ReadonlySet<string>>(),
  };
  await assert.rejects(
    execution.createTestPlan(noExecute, p.id, {
      title: "无权限",
      build: "abc",
      environment: "dev",
      cases: [],
    }),
    code("FORBIDDEN"),
  );
  await (
    await import("./test-execution-contracts.ts")
  ).verifyExecutionContracts(
    actor,
    denied,
    p.id,
    foreign.id,
    second.id,
    second.currentRevisionId,
  );
  console.log("test execution domain passed");
} finally {
  await sql.end({ timeout: 5 });
}
