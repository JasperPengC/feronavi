import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/db/index.ts";
import { deliveryEvidence, deliveryReceipt } from "../../src/db/schema.ts";
import type { Actor } from "../../src/server/permission/actor.ts";
import { createIntegration } from "../../src/server/services/integration.service.ts";
import { configureDeliverySource } from "../../src/server/services/delivery-source.service.ts";
import { createTestCase } from "../../src/server/services/test-case.service.ts";
import * as testing from "../../src/server/services/test-run.service.ts";
import { createReleaseCandidate, getReleaseGate } from "../../src/server/services/release-gate.service.ts";
import { assertIsolatedTestEnvironment } from "../../scripts/test-environment.mjs";

/** 为已有生命周期测试准备完整门禁；只在随机隔离库中写入模拟远端证明。 */
export async function prepareReadyRelease(actor: Actor, projectId: string, releaseId: string) {
  assertIsolatedTestEnvironment();
  const repository = `fixture/app-${releaseId}`;
  const integration = await createIntegration(actor, {
    kind: "GITHUB", name: `隔离发布 ${releaseId}`, projectId,
    baseUrl: "https://8.8.8.8", token: "isolated-fixture-token", config: { repo: repository },
  });
  const source = await configureDeliverySource(actor, projectId, {
    integrationId: integration.id, expectedVersion: 0, webhookSecret: "isolated-fixture-secret-1234",
  });
  const sha = "a".repeat(40), environment = "isolated-test";
  const tc = await createTestCase(actor, projectId, {
    title: "生命周期门禁冒烟", status: "READY", steps: [{ action: "验证", expected: "通过" }],
  });
  let plan = await testing.createTestPlan(actor, projectId, {
    title: "生命周期门禁测试", build: sha, environment, cases: [{ caseId: tc.id, revisionId: tc.currentRevisionId }],
  });
  plan = await testing.transitionTestPlan(actor, projectId, plan.id, { expectedVersion: plan.version, action: "START" });
  let run = await testing.startTestRun(actor, projectId, plan.id, { planCaseId: plan.cases[0]!.id, source: "MANUAL" });
  run = await testing.recordTestRun(actor, projectId, run.id, {
    expectedVersion: run.version, results: [{ stepIndex: 0, status: "PASSED", actual: "通过", evidence: [] }],
  });
  await testing.completeTestRun(actor, projectId, run.id, { expectedVersion: run.version });
  await testing.transitionTestPlan(actor, projectId, plan.id, { expectedVersion: plan.version, action: "COMPLETE" });
  for (const kind of ["PULL_REQUEST", "CI", "DEPLOYMENT"] as const) {
    const [evidence] = await db.insert(deliveryEvidence).values({
      projectId, sourceId: source.id, sourceVersion: source.version,
      kind, title: `隔离夹具 ${kind}`, repository, commitSha: sha, build: sha,
      environment: kind === "DEPLOYMENT" ? environment : null,
      status: "SUCCEEDED", verification: "PROVIDER_API", externalId: randomUUID(), attempt: 1,
      providerUpdatedAt: new Date(), url: "https://example.com/isolated-evidence",
      details: kind === "CI" ? { workflowId: 7, conclusion: "success" }
        : kind === "PULL_REQUEST" ? { merged: true } : { statusId: 1, state: "success" },
    }).returning();
    await db.insert(deliveryReceipt).values({
      sourceId: source.id, sourceVersion: source.version, deliveryId: randomUUID(), payloadHash: "b".repeat(64),
      eventType: kind === "CI" ? "workflow_run" : kind === "PULL_REQUEST" ? "pull_request" : "deployment_status",
      evidenceId: evidence!.id,
    });
  }
  await createReleaseCandidate(actor, projectId, releaseId, {
    sourceId: source.id, commitSha: sha, build: sha, environment,
    workflowIds: [7], testPlanIds: [plan.id], expectedCandidateNumber: 0,
  });
  assert.equal((await getReleaseGate(actor, projectId, releaseId)).passed, true);
}
