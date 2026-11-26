import assert from "node:assert/strict";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
await (
  await import("../../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts"),
  s = await import("../../src/db/schema.ts"),
  { eq, and } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts"),
  { createProject } =
    await import("../../src/server/services/project.service.ts");
const plans = await import("../../src/server/services/planning.service.ts"),
  lifecycle =
    await import("../../src/server/services/planning-lifecycle.service.ts"),
  gate = await import("../../src/server/services/release-gate.service.ts");
const sources =
    await import("../../src/server/services/delivery-source.service.ts"),
  integrations =
    await import("../../src/server/services/integration.service.ts");
const library = await import("../../src/server/services/test-case.service.ts"),
  execution = await import("../../src/server/services/test-run.service.ts"),
  wi = await import("../../src/server/services/work-item.service.ts");
const code = (expected: string) => (e: unknown) =>
  (e as { code?: string }).code === expected;
export async function runReleaseGateScenario() {
  const [r] = await db.select().from(s.role).where(eq(s.role.key, "ADMIN"));
  const [m] = await db
    .insert(s.member)
    .values({
      username: "release-owner",
      name: "发布验收",
      passwordHash: await (
        await import("../../src/server/auth/password.ts")
      ).hashPassword("release-fixture-password"),
      status: "ACTIVE",
    })
    .returning();
  await db
    .insert(s.roleAssignment)
    .values({
      memberId: m!.id,
      roleId: r!.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const actor = (await loadActor(m!.id))!,
    readonly = {
      ...actor,
      permissions: new Set<string>(),
      rolePermissions: new Map(),
    };
  const p = await createProject(actor, { key: "GATE", name: "发布门禁" }),
    foreign = await createProject(actor, { key: "GTX", name: "另一项目" });
  const release = (await plans.createPlan(actor, p.id, "release", {
    name: "0.3.0",
    versionTag: "v0.3.0",
  }))!;
  await assert.rejects(
    lifecycle.complete(actor, release.id, "release"),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  const task = await wi.createWorkItem(actor, p.id, {
    title: "发布范围",
    type: "TASK",
    releaseId: release.id,
  });
  const [terminal] = await db
    .select()
    .from(s.workflowState)
    .where(
      and(
        eq(s.workflowState.category, "TERMINAL"),
        eq(s.workflowState.workflowId, task.workflowId),
      ),
    );
  await db
    .update(s.workItem)
    .set({ statusId: terminal!.id })
    .where(eq(s.workItem.id, task.id));
  let requirement = await wi.createWorkItem(actor, p.id, {
    title: "独立验收的需求", type: "REQUIREMENT", releaseId: release.id,
  });
  for (const toStateKey of ["CONFIRMED", "SCHEDULED", "IN_PROGRESS", "DELIVERED", "VERIFIED"]) {
    requirement = await wi.transitionWorkItem(actor, requirement.id, { toStateKey, version: requirement.version });
  }
  assert.equal((await wi.getWorkItem(actor, requirement.id)).statusCategory, "TERMINAL");
  const i = await integrations.createIntegration(actor, {
    kind: "GITHUB",
    name: "发布仓库",
    baseUrl: "https://8.8.8.8",
    token: "test-token",
    projectId: p.id,
    config: { repo: "acme/app" },
  });
  const source = await sources.configureDeliverySource(actor, p.id, {
    integrationId: i.id,
    expectedVersion: 0,
    webhookSecret: "test-only-release-secret-1234",
  });
  const sha = "c".repeat(40),
    environment = "production";
  const tc = await library.createTestCase(actor, p.id, {
    title: "发布冒烟",
    status: "READY",
    steps: [{ action: "打开", expected: "可用" }],
  });
  let tp = await execution.createTestPlan(actor, p.id, {
    title: "发布测试",
    build: sha,
    environment,
    cases: [{ caseId: tc.id, revisionId: tc.currentRevisionId }],
  });
  const input = {
    sourceId: source.id,
    commitSha: sha,
    build: sha,
    environment,
    workflowIds: [7],
    testPlanIds: [tp.id],
    expectedCandidateNumber: 0,
  };
  await assert.rejects(
    gate.createReleaseCandidate(readonly, p.id, release.id, input),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    gate.createReleaseCandidate(actor, foreign.id, release.id, input),
    code("FORBIDDEN"),
  );
  const candidate = await gate.createReleaseCandidate(
    actor,
    p.id,
    release.id,
    input,
  );
  assert.equal(candidate.number, 1);
  await assert.rejects(
    gate.createReleaseCandidate(actor, p.id, release.id, input),
    code("VERSION_CONFLICT"),
  );
  await assert.rejects(
    gate.recordReleaseFeedback(actor, p.id, release.id, {
      workItemId: task.id,
      sourceUrl: "https://example.com/feedback",
      conclusion: "处理中",
      outcome: "FOLLOW_UP",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  let report = await gate.getReleaseGate(actor, p.id, release.id);
  assert.equal(report.passed, false);
  await (
    await import("../../src/server/services/delivery-evidence.service.ts")
  ).createDeliveryEvidence(actor, p.id, {
    kind: "CI",
    title: "自报成功",
    repository: "acme/app",
    commitSha: sha,
    build: sha,
    status: "SUCCEEDED",
    url: "https://example.com/local",
    workItemIds: [task.id],
  });
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    false,
  );
  // 仅隔离数据库夹具直接写provider记录；签名/API适配器由交付证据套件验证。
  async function proof(
    kind: "CI" | "PULL_REQUEST" | "DEPLOYMENT",
    status: "SUCCEEDED" | "FAILED",
    time: number,
    options: { commit?: string; environment?: string; attempt?: number } = {},
  ) {
    const commit = options.commit ?? sha,
      details =
        kind === "CI"
          ? {
              workflowId: 7,
              conclusion: status === "SUCCEEDED" ? "success" : "failure",
            }
          : kind === "PULL_REQUEST"
            ? { merged: status === "SUCCEEDED" }
            : {
                statusId: time,
                state: status === "SUCCEEDED" ? "success" : "failure",
              };
    const [e] = await db
      .insert(s.deliveryEvidence)
      .values({
        projectId: p.id,
        sourceId: source.id,
        sourceVersion: 1,
        kind,
        title: kind,
        repository: "acme/app",
        commitSha: commit,
        build: commit,
        environment:
          kind === "DEPLOYMENT" ? (options.environment ?? environment) : null,
        status,
        verification: "PROVIDER_API",
        externalId: kind === "CI" ? "10" : String(time),
        attempt: options.attempt ?? 1,
        providerUpdatedAt: new Date(1795600000000 + time * 1000),
        url: "https://example.com/evidence/" + time,
        details,
      })
      .returning();
    await db
      .insert(s.deliveryReceipt)
      .values({
        sourceId: source.id,
        sourceVersion: 1,
        deliveryId: crypto.randomUUID(),
        payloadHash: "d".repeat(64),
        eventType:
          kind === "CI"
            ? "workflow_run"
            : kind === "PULL_REQUEST"
              ? "pull_request"
              : "deployment_status",
        evidenceId: e!.id,
      });
    return e!;
  }
  await proof("CI", "SUCCEEDED", 1);
  await proof("PULL_REQUEST", "SUCCEEDED", 2);
  await proof("DEPLOYMENT", "SUCCEEDED", 3);
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    false,
    "测试未完成",
  );
  tp = await execution.transitionTestPlan(actor, p.id, tp.id, {
    expectedVersion: tp.version,
    action: "START",
  });
  let run = await execution.startTestRun(actor, p.id, tp.id, {
    planCaseId: tp.cases[0]!.id,
    source: "MANUAL",
  });
  run = await execution.recordTestRun(actor, p.id, run.id, {
    expectedVersion: run.version,
    results: [
      {
        stepIndex: 0,
        status: "PASSED",
        actual: "通过",
        evidence: ["https://example.com/test"],
      },
    ],
  });
  await execution.completeTestRun(actor, p.id, run.id, {
    expectedVersion: run.version,
  });
  await execution.transitionTestPlan(actor, p.id, tp.id, {
    expectedVersion: tp.version,
    action: "COMPLETE",
  });
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    true,
  );
  await proof("CI", "FAILED", 4, { attempt: 2 });
  await proof("CI", "SUCCEEDED", 0);
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    false,
    "晚到旧成功不覆盖新失败",
  );
  await assert.rejects(
    lifecycle.complete(actor, release.id, "release"),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  await proof("CI", "SUCCEEDED", 5, { attempt: 3 });
  await proof("DEPLOYMENT", "SUCCEEDED", 6, { commit: "e".repeat(40) });
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    false,
    "环境已部署其它提交",
  );
  await proof("DEPLOYMENT", "SUCCEEDED", 7);
  await db
    .update(s.workItem)
    .set({ version: task.version + 1 })
    .where(eq(s.workItem.id, task.id));
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    false,
    "冻结范围发生变化",
  );
  await gate.createReleaseCandidate(actor, p.id, release.id, {
    ...input,
    expectedCandidateNumber: 1,
  });
  await integrations.updateIntegration(actor, i.id, { name: "仓库已变更" });
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).passed,
    false,
    "集成变化后旧来源失效",
  );
  // 恢复原快照仅为隔离夹具，实际产品必须确认新source版本再接收新证据。
  const [sourceRow] = await db
    .select()
    .from(s.deliverySource)
    .where(eq(s.deliverySource.id, source.id));
  await db
    .update(s.integration)
    .set({ updatedAt: sourceRow!.integrationUpdatedAt })
    .where(eq(s.integration.id, i.id));
  report = await gate.getReleaseGate(actor, p.id, release.id);
  assert.equal(report.passed, true);
  const complete = await lifecycle.complete(actor, release.id, "release");
  assert.equal(complete.alreadyCompleted, false);
  assert.equal(
    (await lifecycle.complete(actor, release.id, "release")).alreadyCompleted,
    true,
  );
  assert.equal(
    (await sql`select count(*)::int n from release_verification`)[0]!.n,
    1,
  );
  await assert.rejects(
    gate.createReleaseCandidate(actor, p.id, release.id, {
      ...input,
      expectedCandidateNumber: 2,
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  const feedback = await gate.recordReleaseFeedback(actor, p.id, release.id, {
    workItemId: task.id,
    sourceUrl: "https://example.com/feedback/1",
    conclusion: "用户确认修复",
    outcome: "RESOLVED",
  });
  assert.equal(feedback.workItemId, task.id);
  assert.equal(
    (await gate.getReleaseGate(actor, p.id, release.id)).feedback.length,
    1,
  );
  await assert.rejects(
    db.transaction(() =>
      db
        .update(s.releaseCandidate)
        .set({ build: "changed" })
        .where(eq(s.releaseCandidate.id, candidate.id)),
    ),
  );
  console.log("release gate passed");

  return {
    actor,
    projectId: p.id,
    releaseId: release.id,
    workItemId: task.id,
    sourceId: source.id,
    testPlanId: tp.id,
  };
}
