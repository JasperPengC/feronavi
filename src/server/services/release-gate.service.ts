import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  release,
  releaseCandidate,
  releaseVerification,
  releaseFeedback,
  deliverySource,
  deliveryEvidence,
  deliveryReceipt,
  integration,
  workItem,
  workflowState,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  createReleaseCandidateSchema,
  releaseFeedbackSchema,
  type ReleaseCandidateView,
  type ReleaseGateView,
  type ReleaseGateCheck,
  type ReleaseGateSnapshot,
  type ReleaseFeedbackView,
} from "../../shared/schemas/release-gate.ts";
import type { Actor } from "../permission/actor.ts";
import {
  readDeliveryProject,
  parseDelivery,
  withDeliveryWrite,
  assertDeliveryWrite,
} from "./delivery-access.ts";
import { deliverySourceIsCurrent } from "./delivery-source.service.ts";
import { getTestPlan, getTestPlanReport } from "./test-execution-read.ts";
import { assertDeliveryItems } from "./delivery-evidence.service.ts";
import { lockProjectTree } from "./project-tree.ts";
import { recordBusinessEvent } from "./event-log.ts";
type Candidate = typeof releaseCandidate.$inferSelect;
type Evidence = typeof deliveryEvidence.$inferSelect;
const candidateView = (r: Candidate): ReleaseCandidateView => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
});
const feedbackView = (
  r: typeof releaseFeedback.$inferSelect,
): ReleaseFeedbackView => ({ ...r, createdAt: r.createdAt.toISOString() });
export async function assertReleaseTarget(
  actor: Actor,
  projectId: string,
  releaseId: string,
) {
  await readDeliveryProject(actor, projectId);
  const [row] = await db
    .select()
    .from(release)
    .where(and(eq(release.id, releaseId), eq(release.projectId, projectId)));
  if (!row) throw forbidden();
  return row;
}
async function latest(releaseId: string) {
  return (
    await db
      .select()
      .from(releaseCandidate)
      .where(eq(releaseCandidate.releaseId, releaseId))
      .orderBy(desc(releaseCandidate.number))
      .limit(1)
  )[0];
}
async function scope(projectId: string, releaseId: string) {
  return db
    .select({
      id: workItem.id,
      key: workItem.key,
      title: workItem.title,
      version: workItem.version,
    })
    .from(workItem)
    .where(
      and(
        eq(workItem.projectId, projectId),
        eq(workItem.releaseId, releaseId),
        isNull(workItem.deletedAt),
      ),
    )
    .orderBy(asc(workItem.id))
    .for("update");
}
export async function createReleaseCandidate(
  actor: Actor,
  projectId: string,
  releaseId: string,
  raw: unknown,
): Promise<ReleaseCandidateView> {
  const input = parseDelivery(createReleaseCandidateSchema, raw);
  return withDeliveryWrite(actor, projectId, "release:manage", async () => {
    const row = await assertReleaseTarget(actor, projectId, releaseId);
    if (row.completedAt || row.archivedAt)
      throw new DomainError(
        "BLOCKED_BY_PREREQUISITE",
        "已完成或归档的版本不能更换发布候选",
        null,
      );
    const previous = await latest(releaseId);
    if ((previous?.number ?? 0) !== input.expectedCandidateNumber)
      throw new DomainError(
        "VERSION_CONFLICT",
        "发布候选已变化，请重新读取",
        null,
      );
    const [source] = await db
      .select()
      .from(deliverySource)
      .where(
        and(
          eq(deliverySource.id, input.sourceId),
          eq(deliverySource.projectId, projectId),
        ),
      );
    if (!source) throw forbidden();
    for (const id of input.testPlanIds) await getTestPlan(actor, projectId, id);
    const { expectedCandidateNumber: _number, ...fields } = input;
    const [candidate] = await db
      .insert(releaseCandidate)
      .values({
        ...fields,
        projectId,
        releaseId,
        number: (previous?.number ?? 0) + 1,
        sourceVersion: source.version,
        repository: source.repository,
        workItems: await scope(projectId, releaseId),
        createdBy: actor.memberId,
      })
      .returning();
    await recordBusinessEvent({
      actor,
      projectId,
      action: "delivery.candidate.created",
      targetType: "RELEASE",
      targetId: releaseId,
      summary: `${actor.name} 建立了「${row.name}」发布候选 #${candidate!.number}`,
      changes: { candidateId: candidate!.id, commitSha: input.commitSha },
    });
    return candidateView(candidate!);
  });
}
/** 先折叠同一远端对象的重试，再比较不同对象的更新时间；同时间冲突时失败关闭。 */
function newest(rows: Evidence[]): Evidence | undefined {
  const objects = new Map<string, Evidence[]>();
  for (const row of rows) {
    const group = objects.get(row.externalId) ?? [];
    group.push(row);
    objects.set(row.externalId, group);
  }
  const time = (e: Evidence) => e.providerUpdatedAt?.getTime() ?? 0;
  const tie = (a: Evidence, b: Evidence) =>
    Number(a.status === "SUCCEEDED") - Number(b.status === "SUCCEEDED") ||
    a.id.localeCompare(b.id);
  const winners = [...objects.values()].map(
    (group) =>
      group.sort(
        (a, b) => b.attempt - a.attempt || time(b) - time(a) || tie(a, b),
      )[0]!,
  );
  return winners.sort((a, b) => time(b) - time(a) || tie(a, b))[0];
}
async function inspect(
  actor: Actor,
  projectId: string,
  releaseId: string,
): Promise<ReleaseGateView> {
  const row = await assertReleaseTarget(actor, projectId, releaseId),
    candidate = await latest(releaseId);
  const [verification] = await db
    .select()
    .from(releaseVerification)
    .where(eq(releaseVerification.releaseId, releaseId));
  const feedback = (
    await db
      .select()
      .from(releaseFeedback)
      .where(eq(releaseFeedback.releaseId, releaseId))
      .orderBy(asc(releaseFeedback.createdAt), asc(releaseFeedback.id))
  ).map(feedbackView);
  if (row.completedAt)
    return {
      releaseId,
      completedAt: row.completedAt.toISOString(),
      candidate: candidate ? candidateView(candidate) : null,
      passed: verification?.snapshot.passed ?? false,
      checks: verification?.snapshot.checks ?? [
        {
          key: "history",
          passed: false,
          message: "历史版本没有发布核验快照",
          evidenceIds: [],
        },
      ],
      verification: verification?.snapshot ?? null,
      feedback,
    };
  const checks: ReleaseGateCheck[] = [];
  const add = (
    key: string,
    passed: boolean,
    message: string,
    evidence?: Evidence,
    testPlanId?: string,
  ) => {
    checks.push({
      key,
      passed,
      message,
      evidenceIds: evidence ? [evidence.id] : [],
      ...(testPlanId ? { testPlanId } : {}),
    });
  };
  if (!candidate) add("candidate", false, "尚未建立发布候选");
  else {
    add(
      "scope",
      JSON.stringify(await scope(projectId, releaseId)) ===
        JSON.stringify(candidate.workItems),
      "工作项范围与版本须和候选一致",
    );
    const states = await db
      .select({ category: workflowState.category })
      .from(workItem)
      .innerJoin(workflowState, eq(workItem.statusId, workflowState.id))
      .where(
        and(eq(workItem.releaseId, releaseId), isNull(workItem.deletedAt)),
      );
    add(
      "workItems",
      states.every((s) => s.category === "TERMINAL"),
      "版本中的工作项须全部完成",
    );
    const [s] = await db
      .select()
      .from(deliverySource)
      .where(eq(deliverySource.id, candidate.sourceId));
    // 集成修改与回调持久化采用同样锁顺序，完成核验后直到版本落库都保持锁。
    const [i] = s?.integrationId
      ? await db
          .select()
          .from(integration)
          .where(eq(integration.id, s.integrationId))
          .for("update")
      : [];
    const [locked] = await db
      .select()
      .from(deliverySource)
      .where(eq(deliverySource.id, candidate.sourceId))
      .for("update");
    add(
      "source",
      !!locked &&
        locked.version === candidate.sourceVersion &&
        locked.repository === candidate.repository &&
        deliverySourceIsCurrent(locked, i),
      "交付来源须有效且与候选版本一致",
    );
    const proofs = await db
      .select({ evidence: deliveryEvidence })
      .from(deliveryEvidence)
      .innerJoin(
        deliveryReceipt,
        and(
          eq(deliveryReceipt.evidenceId, deliveryEvidence.id),
          eq(deliveryReceipt.sourceId, deliveryEvidence.sourceId),
          eq(deliveryReceipt.sourceVersion, deliveryEvidence.sourceVersion),
        ),
      )
      .where(
        and(
          eq(deliveryEvidence.projectId, projectId),
          eq(deliveryEvidence.sourceId, candidate.sourceId),
          eq(deliveryEvidence.sourceVersion, candidate.sourceVersion),
          eq(deliveryEvidence.repository, candidate.repository),
          eq(deliveryEvidence.verification, "PROVIDER_API"),
        ),
      );
    const evidence = proofs.map((p) => p.evidence),
      sameBuild = (e: Evidence) =>
        e.commitSha === candidate.commitSha && e.build === candidate.build;
    const commitEvidence = evidence.filter(sameBuild);
    const pr = newest(commitEvidence.filter((e) => e.kind === "PULL_REQUEST"));
    add(
      "merge",
      pr?.status === "SUCCEEDED" && pr.details.merged === true,
      "候选提交须有已核验的合并记录",
      pr,
    );
    for (const workflowId of candidate.workflowIds) {
      const ci = newest(
        commitEvidence.filter(
          (e) => e.kind === "CI" && e.details.workflowId === workflowId,
        ),
      );
      add(
        "workflow:" + workflowId,
        ci?.status === "SUCCEEDED",
        `流水线 ${workflowId} 的最新结果须通过`,
        ci,
      );
    }
    const deploy = newest(
      evidence.filter(
        (e) =>
          e.kind === "DEPLOYMENT" && e.environment === candidate.environment,
      ),
    );
    add(
      "deployment",
      !!deploy && sameBuild(deploy) && deploy.status === "SUCCEEDED",
      "目标环境的最新部署须与候选提交及构建一致",
      deploy,
    );
    for (const id of candidate.testPlanIds) {
      const report = await getTestPlanReport(actor, projectId, id);
      add(
        "test:" + id,
        report.passed &&
          report.testedBuild === candidate.build &&
          report.testedEnvironment === candidate.environment,
        `测试计划「${report.plan.title}」须在相同构建和环境完成并全部通过`,
        undefined,
        id,
      );
      checks.at(-1)!.testRunIds = report.cases.flatMap((c) =>
        c.runs.at(-1) ? [c.runs.at(-1)!.id] : [],
      );
    }
  }
  return {
    releaseId,
    completedAt: null,
    candidate: candidate ? candidateView(candidate) : null,
    passed: checks.length > 0 && checks.every((c) => c.passed),
    checks,
    verification: null,
    feedback,
  };
}
export async function getReleaseGate(
  actor: Actor,
  projectId: string,
  releaseId: string,
): Promise<ReleaseGateView> {
  await assertReleaseTarget(actor, projectId, releaseId);
  return db.transaction(async () => {
    await lockProjectTree(projectId);
    return inspect(actor, projectId, releaseId);
  });
}
/** 只由生命周期完成事务调用；核验与完成原子提交，任何旧REST/MCP入口都不能跳过。 */
export async function recordReleaseVerification(
  actor: Actor,
  projectId: string,
  releaseId: string,
): Promise<ReleaseGateSnapshot> {
  await assertDeliveryWrite(actor, projectId, "release:manage");
  const report = await inspect(actor, projectId, releaseId),
    c = report.candidate;
  if (!report.passed || !c)
    throw new DomainError(
      "BLOCKED_BY_PREREQUISITE",
      "发布核验未通过，请补齐或更新交付证据",
      { checks: report.checks },
    );
  const snapshot: ReleaseGateSnapshot = {
    candidateId: c.id,
    candidateNumber: c.number,
    commitSha: c.commitSha,
    build: c.build,
    environment: c.environment,
    sourceId: c.sourceId,
    sourceVersion: c.sourceVersion,
    repository: c.repository,
    passed: true,
    checks: report.checks,
    checkedAt: new Date().toISOString(),
  };
  await db
    .insert(releaseVerification)
    .values({
      projectId,
      releaseId,
      candidateId: c.id,
      snapshot,
      createdBy: actor.memberId,
    });
  return snapshot;
}
export async function recordReleaseFeedback(
  actor: Actor,
  projectId: string,
  releaseId: string,
  raw: unknown,
): Promise<ReleaseFeedbackView> {
  const input = parseDelivery(releaseFeedbackSchema, raw);
  return withDeliveryWrite(actor, projectId, "release:manage", async () => {
    const row = await assertReleaseTarget(actor, projectId, releaseId);
    if (!row.completedAt)
      throw new DomainError(
        "BLOCKED_BY_PREREQUISITE",
        "完成版本后才能登记发布反馈结论",
        null,
      );
    await assertDeliveryItems(actor, projectId, [input.workItemId]);
    const c = await latest(releaseId),
      items = c?.workItems ?? (await scope(projectId, releaseId));
    if (!items.some((i) => i.id === input.workItemId))
      throw new DomainError(
        "VALIDATION",
        "反馈须关联该版本范围内的原始工作项",
        null,
      );
    const [record] = await db
      .insert(releaseFeedback)
      .values({ ...input, projectId, releaseId, createdBy: actor.memberId })
      .returning();
    await recordBusinessEvent({
      actor,
      projectId,
      action: "delivery.feedback.recorded",
      targetType: "RELEASE",
      targetId: releaseId,
      summary: `${actor.name} 记录了「${row.name}」发布反馈`,
      changes: {
        feedbackId: record!.id,
        workItemId: input.workItemId,
        outcome: input.outcome,
      },
    });
    return feedbackView(record!);
  });
}
