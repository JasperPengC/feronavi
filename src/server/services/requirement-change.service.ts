import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import {
  member,
  requirementChange as change,
  requirementChangeImpact as impact,
  requirementRevision,
  workItem,
  testCase,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  acknowledgeImpactSchema,
  applyRequirementChangeSchema,
  changeListSchema,
  createRequirementChangeSchema,
  decideRequirementChangeSchema,
  type RequirementChangeContext,
  type RequirementChangeDetail,
  type RequirementChangePage,
  type RequirementChangeSummary,
  type RequirementImpact,
  type ImpactKind,
} from "../../shared/schemas/requirement-change.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import * as projects from "../repos/project.repo.ts";
import {
  collectRequirementImpacts,
  impactFingerprint,
} from "../repos/requirement-impact.repo.ts";
import { getWorkItem, updateWorkItem } from "./work-item.service.ts";
import { getRequirementRevision } from "./requirement-revision.service.ts";
import { isCollaborator } from "./collab.service.ts";
import * as plans from "./planning-access.ts";
import { lockProjectTree } from "./project-tree.ts";
import { recordBusinessEvent } from "./event-log.ts";

type Row = typeof change.$inferSelect;
const context = (actor: Actor) => ({
  memberId: actor.memberId,
  memberProjectIds: new Set<string>(),
  memberTeamIds: new Set<string>(),
});
const conflict = () =>
  new DomainError(
    "VERSION_CONFLICT",
    "需求或影响范围已变化，请重新读取并发起变更",
    null,
  );
const blocked = () =>
  new DomainError("BLOCKED_BY_PREREQUISITE", "当前变更状态不允许此操作", null);
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const p = schema.safeParse(raw);
  if (!p.success)
    throw new DomainError("VALIDATION", "变更参数不合法", p.error.issues);
  return p.data;
}
async function requirement(actor: Actor, id: string) {
  const row = await getWorkItem(actor, id);
  if (row.type !== "REQUIREMENT")
    throw new DomainError("VALIDATION", "变更仅适用于需求", null);
  return row;
}
function canManage(actor: Actor, projectId: string) {
  return can(actor, "project:update", { projectId }, context(actor));
}
async function canEdit(
  actor: Actor,
  row: Awaited<ReturnType<typeof requirement>>,
) {
  if (
    !(await projects.isVisibleTo(
      actor.memberId,
      row.projectId,
      actor.grants.some((g) => g.scopeType === "ORG"),
    ))
  )
    return false;
  return (
    can(
      actor,
      "work_item:update_any",
      { projectId: row.projectId, createdBy: row.reporterId },
      context(actor),
    ) ||
    can(
      actor,
      "work_item:update_own",
      { projectId: row.projectId, createdBy: row.reporterId },
      context(actor),
    ) ||
    (await isCollaborator(actor.memberId, row.id))
  );
}
async function writable(
  actor: Actor,
  row: Awaited<ReturnType<typeof requirement>>,
) {
  if (!(await canEdit(actor, row))) throw forbidden();
  await projectWritable(row.projectId);
}
async function projectWritable(projectId: string) {
  const p = await projects.findById(projectId);
  if (!p) throw forbidden();
  if (p.lifecycleLock || p.archivedAt)
    throw new DomainError("BLOCKED_BY_PREREQUISITE", "项目已锁定或归档", null);
}
async function latest(actor: Actor, id: string) {
  const [row] = await db
    .select({ id: requirementRevision.id })
    .from(requirementRevision)
    .where(eq(requirementRevision.workItemId, id))
    .orderBy(desc(requirementRevision.revisionNo))
    .limit(1);
  if (!row)
    throw new DomainError("BLOCKED_BY_PREREQUISITE", "需求尚无正文基线", null);
  return getRequirementRevision(actor, id, row.id);
}
async function assertFullProject(actor: Actor, projectId: string) {
  if (
    !(await projects.isVisibleTo(
      actor.memberId,
      projectId,
      actor.grants.some((g) => g.scopeType === "ORG"),
    ))
  )
    throw forbidden();
}
export async function getChangeContext(
  actor: Actor,
  id: string,
): Promise<RequirementChangeContext> {
  const row = await requirement(actor, id);
  await assertFullProject(actor, row.projectId);
  const impacts = await collectRequirementImpacts(row);
  const project = await projects.findById(row.projectId);
  return {
    workItemId: id,
    projectId: row.projectId,
    workItemVersion: row.version,
    baseRevision: await latest(actor, id),
    impacts,
    impactFingerprint: impactFingerprint(impacts),
    canCreate:
      !project?.lifecycleLock &&
      !project?.archivedAt &&
      (await canEdit(actor, row)),
  };
}
function summary(row: Row): RequirementChangeSummary {
  return {
    id: row.id,
    workItemId: row.workItemId,
    projectId: row.projectId,
    number: row.number,
    status: row.status,
    version: row.version,
    proposedTitle: row.proposedTitle,
    reason: row.reason,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    appliedBy: row.appliedBy,
    appliedAt: row.appliedAt?.toISOString() ?? null,
  };
}
async function find(actor: Actor, workItemId: string, id: string) {
  await requirement(actor, workItemId);
  const [row] = await db
    .select()
    .from(change)
    .where(and(eq(change.id, id), eq(change.workItemId, workItemId)))
    .limit(1);
  if (!row) throw forbidden();
  return row;
}
const planKind = (kind: Exclude<ImpactKind, "WORK_ITEM"|"TEST_CASE">) =>
  (
    ({
      MILESTONE: "milestone",
      ITERATION: "iteration",
      RELEASE: "release",
    }) as const
  )[kind];
async function impactAccess(
  actor: Actor,
  row: typeof impact.$inferSelect,
  projectId: string,
) {
  try {
    if(row.kind==="TEST_CASE"){
      await assertFullProject(actor,projectId);
      const [current]=await db.select().from(testCase).where(and(eq(testCase.id,row.targetId),eq(testCase.projectId,projectId)));
      if(!current||current.status==="ARCHIVED")return null;
      return current.ownerId===actor.memberId||can(actor,"test_case:manage",{projectId},context(actor))||canManage(actor,projectId);
    }
    if (row.kind === "WORK_ITEM") {
      const current = await getWorkItem(actor, row.targetId);
      if (current.projectId !== projectId) throw forbidden();
      return (
        current.assigneeId === actor.memberId ||
        can(actor, "work_item:update_any", { projectId }, context(actor)) ||
        canManage(actor, projectId)
      );
    }
    const current = await plans.get(actor, row.targetId, planKind(row.kind));
    if (current.projectId !== projectId) throw forbidden();
    return (
      canManage(actor, projectId) ||
      can(actor, `${planKind(row.kind)}:manage`, { projectId }, context(actor))
    );
  } catch (error) {
    if (
      error instanceof DomainError &&
      ["FORBIDDEN", "NOT_FOUND"].includes(error.code)
    )
      return null;
    throw error;
  }
}
export async function getRequirementChange(
  actor: Actor,
  workItemId: string,
  id: string,
): Promise<RequirementChangeDetail> {
  const row = await find(actor, workItemId, id),
    item = await requirement(actor, workItemId),
    project = await projects.findById(item.projectId);
  const full = await projects.isVisibleTo(
    actor.memberId,
    item.projectId,
    actor.grants.some((g) => g.scopeType === "ORG"),
  );
  const stored = await db.select().from(impact).where(eq(impact.changeId, id));
  const impacts: RequirementImpact[] = [];
  for (const entry of stored) {
    const access = await impactAccess(actor, entry, row.projectId);
    if (access === null && !full) continue;
    impacts.push({
      ...entry.snapshot,
      id: entry.id,
      acknowledgedBy: entry.acknowledgedBy,
      acknowledgedAt: entry.acknowledgedAt?.toISOString() ?? null,
      note: entry.note,
      available: access !== null,
      canAcknowledge:
        access === true &&
        row.status === "APPLIED" &&
        !entry.acknowledgedAt &&
        !project?.lifecycleLock &&
        !project?.archivedAt,
    });
  }
  const baseRevision = await getRequirementRevision(
    actor,
    workItemId,
    row.baseRevisionId,
  );
  // 仅能看单项的协作者不能借影响分析读取全项目；其已授权快照仍逐项过滤。
  const stale =
    (await latest(actor, workItemId)).id !== row.baseRevisionId ||
    (full &&
      impactFingerprint(await collectRequirementImpacts(item)) !==
        row.impactFingerprint);
  const edit = await canEdit(actor, item),
    manage = canManage(actor, row.projectId),
    active = !project?.lifecycleLock && !project?.archivedAt;
  const participantIds = [
    ...new Set(
      [
        row.requestedBy,
        row.decidedBy,
        row.appliedBy,
        row.cancelledBy,
        ...impacts.map((i) => i.acknowledgedBy),
      ].filter((id): id is string => id !== null),
    ),
  ];
  const participants = participantIds.length
    ? await db
        .select({ id: member.id, name: member.name })
        .from(member)
        .where(inArray(member.id, participantIds))
    : [];
  return {
    ...summary(row),
    baseRevision,
    proposedDescription: row.proposedDescription,
    requestedWorkItemVersion: row.requestedWorkItemVersion,
    reviewNote: row.reviewNote,
    appliedRevisionId: row.appliedRevisionId,
    impacts,
    cancelledBy: row.cancelledBy,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelNote: row.cancelNote,
    participants,
    stale: row.status === "APPLIED" ? false : !!stale,
    canReview: active && manage && row.status === "PENDING",
    canApply: active && edit && row.status === "APPROVED" && !stale,
    canCancel:
      active &&
      ["PENDING", "APPROVED"].includes(row.status) &&
      (manage || (edit && row.requestedBy === actor.memberId)),
  };
}
export async function listRequirementChanges(
  actor: Actor,
  id: string,
  raw: unknown = {},
): Promise<RequirementChangePage> {
  await requirement(actor, id);
  const input = parse(changeListSchema, raw);
  const rows = await db
    .select()
    .from(change)
    .where(
      and(
        eq(change.workItemId, id),
        input.before ? lt(change.number, input.before) : undefined,
      ),
    )
    .orderBy(desc(change.number))
    .limit(input.limit + 1);
  return {
    items: rows.slice(0, input.limit).map(summary),
    nextCursor:
      rows.length > input.limit ? rows[input.limit - 1]!.number : null,
  };
}
async function withLockedRequirement<T>(
  actor: Actor,
  id: string,
  fn: (item: Awaited<ReturnType<typeof requirement>>) => Promise<T>,
) {
  const initial = await requirement(actor, id);
  return db.transaction(async () => {
    await lockProjectTree(initial.projectId);
    await db
      .select({ id: workItem.id })
      .from(workItem)
      .where(eq(workItem.id, id))
      .for("update");
    return fn(await requirement(actor, id));
  });
}
async function fresh(
  actor: Actor,
  item: Awaited<ReturnType<typeof requirement>>,
  row: { baseRevisionId: string; impactFingerprint: string },
) {
  await assertFullProject(actor, item.projectId);
  if ((await latest(actor, item.id)).id !== row.baseRevisionId)
    throw conflict();
  const impacts = await collectRequirementImpacts(item, true);
  if (impactFingerprint(impacts) !== row.impactFingerprint) throw conflict();
  return impacts;
}
async function event(actor: Actor, row: Row, action: string) {
  await recordBusinessEvent({
    actor,
    action: `requirement_change.${action}`,
    projectId: row.projectId,
    targetType: "REQUIREMENT_CHANGE",
    targetId: row.id,
    summary: `${actor.name} ${action === "created" ? "提出" : action === "applied" ? "应用" : action === "acknowledged" ? "确认影响" : "处理"}了需求变更 #${row.number}`,
    invalidation: {
      domain: "workitem",
      resourceType: "WORK_ITEM",
      resourceId: row.workItemId,
    },
  });
}
export async function assertChangeCreatable(actor: Actor, id: string) {
  const item = await requirement(actor, id);
  await writable(actor, item);
  return item;
}
export async function createRequirementChange(
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<RequirementChangeDetail> {
  const input = parse(createRequirementChangeSchema, raw);
  return withLockedRequirement(actor, id, async (item) => {
    await writable(actor, item);
    if (item.version !== input.expectedWorkItemVersion) throw conflict();
    const impacts = await fresh(actor, item, input);
    if (item.title === input.title && item.description === input.description)
      throw new DomainError("VALIDATION", "提案与当前正文相同", null);
    const [previous] = await db
      .select({ number: change.number })
      .from(change)
      .where(eq(change.workItemId, id))
      .orderBy(desc(change.number))
      .limit(1);
    const [row] = await db
      .insert(change)
      .values({
        workItemId: id,
        projectId: item.projectId,
        number: (previous?.number ?? 0) + 1,
        baseRevisionId: input.baseRevisionId,
        requestedWorkItemVersion: item.version,
        proposedTitle: input.title,
        proposedDescription: input.description,
        reason: input.reason,
        impactFingerprint: input.impactFingerprint,
        requestedBy: actor.memberId,
      })
      .returning();
    if (impacts.length)
      await db
        .insert(impact)
        .values(
          impacts.map((snapshot) => ({
            changeId: row!.id,
            kind: snapshot.kind,
            targetId: snapshot.targetId,
            snapshot,
          })),
        );
    await event(actor, row!, "created");
    return getRequirementChange(actor, id, row!.id);
  });
}
function checkVersion(row: Row, version: number) {
  if (row.version !== version)
    throw new DomainError(
      "VERSION_CONFLICT",
      "变更记录已更新，请重新读取",
      null,
    );
}
export async function decideRequirementChange(
  actor: Actor,
  workItemId: string,
  id: string,
  raw: unknown,
): Promise<RequirementChangeDetail> {
  const input = parse(decideRequirementChangeSchema, raw);
  return withLockedRequirement(actor, workItemId, async (item) => {
    const row = await find(actor, workItemId, id);
    await projectWritable(row.projectId);
    if (input.decision === "CANCEL") {
      if (
        !canManage(actor, row.projectId) &&
        !(row.requestedBy === actor.memberId && (await canEdit(actor, item)))
      )
        throw forbidden();
    } else if (!canManage(actor, row.projectId)) throw forbidden();
    checkVersion(row, input.expectedVersion);
    if (
      input.decision === "CANCEL"
        ? !["PENDING", "APPROVED"].includes(row.status)
        : row.status !== "PENDING"
    )
      throw blocked();
    if (input.decision === "APPROVE") await fresh(actor, item, row);
    await db
      .update(change)
      .set({
        status:
          input.decision === "APPROVE"
            ? "APPROVED"
            : input.decision === "REJECT"
              ? "REJECTED"
              : "CANCELLED",
        version: row.version + 1,
        ...(input.decision === "CANCEL"
          ? {
              cancelledBy: actor.memberId,
              cancelledAt: new Date(),
              cancelNote: input.note ?? null,
            }
          : {
              decidedBy: actor.memberId,
              decidedAt: new Date(),
              reviewNote: input.note ?? null,
            }),
      })
      .where(eq(change.id, id));
    await event(actor, row, input.decision.toLowerCase());
    return getRequirementChange(actor, workItemId, id);
  });
}
export async function applyRequirementChange(
  actor: Actor,
  workItemId: string,
  id: string,
  raw: unknown,
): Promise<RequirementChangeDetail> {
  const input = parse(applyRequirementChangeSchema, raw);
  return withLockedRequirement(actor, workItemId, async (item) => {
    await writable(actor, item);
    const row = await find(actor, workItemId, id);
    checkVersion(row, input.expectedVersion);
    if (row.status !== "APPROVED") throw blocked();
    const reviewer = row.decidedBy
      ? await (await import("../auth/actor-loader.ts")).loadActor(row.decidedBy)
      : null;
    if (!reviewer || !canManage(reviewer, row.projectId))
      throw new DomainError(
        "BLOCKED_BY_PREREQUISITE",
        "评审人的权限已变化，请撤回后重新评审",
        null,
      );
    if (item.version !== input.expectedWorkItemVersion) throw conflict();
    await fresh(actor, item, row);
    await updateWorkItem(actor, workItemId, {
      title: row.proposedTitle,
      description: row.proposedDescription,
      version: item.version,
    });
    const applied = await latest(actor, workItemId);
    await db
      .update(change)
      .set({
        status: "APPLIED",
        version: row.version + 1,
        appliedBy: actor.memberId,
        appliedAt: new Date(),
        appliedRevisionId: applied.id,
      })
      .where(eq(change.id, id));
    await event(actor, row, "applied");
    return getRequirementChange(actor, workItemId, id);
  });
}
export async function acknowledgeRequirementImpact(
  actor: Actor,
  workItemId: string,
  id: string,
  raw: unknown,
): Promise<RequirementChangeDetail> {
  const input = parse(acknowledgeImpactSchema, raw);
  return withLockedRequirement(actor, workItemId, async () => {
    const row = await find(actor, workItemId, id);
    await projectWritable(row.projectId);
    const [entry] = await db
      .select()
      .from(impact)
      .where(and(eq(impact.id, input.impactId), eq(impact.changeId, id)))
      .limit(1);
    if (!entry || !(await impactAccess(actor, entry, row.projectId)))
      throw forbidden();
    checkVersion(row, input.expectedVersion);
    if (row.status !== "APPLIED") throw blocked();
    if (!entry.acknowledgedAt) {
      await db
        .update(impact)
        .set({
          acknowledgedBy: actor.memberId,
          acknowledgedAt: new Date(),
          note: input.note ?? null,
        })
        .where(eq(impact.id, entry.id));
      await db
        .update(change)
        .set({ version: row.version + 1 })
        .where(eq(change.id, id));
      await event(actor, row, "acknowledged");
    }
    return getRequirementChange(actor, workItemId, id);
  });
}
