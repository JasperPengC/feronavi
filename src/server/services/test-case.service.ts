import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  sql as dsql,
} from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  member,
  requirementRevision,
  testCase,
  testCaseRequirement,
  testCaseRevision,
  testSuite,
  workItem,
} from "../../db/schema.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  createTestCaseSchema,
  createTestSuiteSchema,
  testCaseListSchema,
  updateTestCaseSchema,
  updateTestSuiteSchema,
  type TestCaseDetail,
  type TestCasePage,
  type TestCaseRevision,
  type TestCaseSummary,
  type TestStep,
  type TestSuite,
} from "../../shared/schemas/test-management.ts";
import type { Actor } from "../permission/actor.ts";
import { getRequirementRevision } from "./requirement-revision.service.ts";
import { getWorkItem } from "./work-item.service.ts";
import {
  readTestProject,
  canWriteTesting,
  withTestWrite,
  parseTesting,
  testVersion,
} from "./test-access.ts";
import * as projects from "../repos/project.repo.ts";
import { recordBusinessEvent } from "./event-log.ts";

const blocked = (message: string) =>
  new DomainError("BLOCKED_BY_PREREQUISITE", message, null);
async function event(
  actor: Actor,
  projectId: string,
  id: string,
  kind: "TEST_CASE" | "TEST_SUITE",
  action: string,
) {
  await recordBusinessEvent({
    actor,
    projectId,
    targetType: kind,
    targetId: id,
    action: `${kind.toLowerCase()}.${action}`,
    summary: `${actor.name} ${action === "created" ? "创建" : "更新"}了${kind === "TEST_CASE" ? "测试用例" : "测试套件"}`,
    invalidation: {
      domain: "project",
      resourceType: "PROJECT",
      resourceId: projectId,
    },
  });
}
async function findCase(projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(testCase)
    .where(and(eq(testCase.id, id), eq(testCase.projectId, projectId)));
  if (!row) throw forbidden();
  return row;
}
async function findSuite(projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(testSuite)
    .where(and(eq(testSuite.id, id), eq(testSuite.projectId, projectId)));
  if (!row) throw forbidden();
  return row;
}
async function suiteResult(
  actor: Actor,
  row: typeof testSuite.$inferSelect,
): Promise<TestSuite> {
  const [count] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(testCase)
    .where(and(eq(testCase.suiteId, row.id), ne(testCase.status, "ARCHIVED")));
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    activeCaseCount: count!.n,
    canManage: await canWriteTesting(actor, row.projectId, "test_case:manage"),
  };
}
export async function listTestSuites(
  actor: Actor,
  projectId: string,
  includeArchived = false,
): Promise<{ items: TestSuite[]; canManage: boolean }> {
  await readTestProject(actor, projectId);
  const rows = await db
    .select()
    .from(testSuite)
    .where(
      and(
        eq(testSuite.projectId, projectId),
        includeArchived ? undefined : isNull(testSuite.archivedAt),
      ),
    )
    .orderBy(testSuite.name, testSuite.id);
  const canManage = await canWriteTesting(actor, projectId, "test_case:manage");
  const counts = await db
    .select({ suiteId: testCase.suiteId, n: dsql<number>`count(*)::int` })
    .from(testCase)
    .where(
      and(eq(testCase.projectId, projectId), ne(testCase.status, "ARCHIVED")),
    )
    .groupBy(testCase.suiteId);
  const bySuite = new Map(counts.map((row) => [row.suiteId, row.n]));
  return {
    items: rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      version: row.version,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      activeCaseCount: bySuite.get(row.id) ?? 0,
      canManage,
    })),
    canManage,
  };
}
export async function getTestSuite(
  actor: Actor,
  projectId: string,
  id: string,
): Promise<TestSuite> {
  await readTestProject(actor, projectId);
  return suiteResult(actor, await findSuite(projectId, id));
}
export async function createTestSuite(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<TestSuite> {
  const input = parseTesting(createTestSuiteSchema, raw);
  return withTestWrite(actor, projectId, "test_case:manage", async () => {
    const [row] = await db
      .insert(testSuite)
      .values({ ...input, projectId, createdBy: actor.memberId })
      .returning();
    await event(actor, projectId, row!.id, "TEST_SUITE", "created");
    return suiteResult(actor, row!);
  });
}
export async function updateTestSuite(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestSuite> {
  const input = parseTesting(updateTestSuiteSchema, raw);
  return withTestWrite(actor, projectId, "test_case:manage", async () => {
    const row = await findSuite(projectId, id);
    testVersion(row.version, input.expectedVersion);
    if (input.archived && (await suiteResult(actor, row)).activeCaseCount)
      throw blocked("套件仍有有效用例，请先移动或归档用例");
    const [saved] = await db
      .update(testSuite)
      .set({
        name: input.name ?? row.name,
        description: input.description ?? row.description,
        archivedAt:
          input.archived === undefined
            ? row.archivedAt
            : input.archived
              ? (row.archivedAt ?? new Date())
              : null,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(testSuite.id, id))
      .returning();
    await event(actor, projectId, id, "TEST_SUITE", "updated");
    return suiteResult(actor, saved!);
  });
}
async function validateOwner(projectId: string, id: string | null) {
  if (!id) return;
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, id), eq(member.status, "ACTIVE")));
  if (!row)
    throw new DomainError("VALIDATION", "用例负责人必须是有效成员", null);
  const actor = await (await import("../auth/actor-loader.ts")).loadActor(id);
  if (
    !actor ||
    !(await projects.isVisibleTo(
      id,
      projectId,
      actor.grants.some((g) => g.scopeType === "ORG"),
    ))
  )
    throw forbidden();
}
type RequirementInput = { workItemId: string; revisionId: string };
async function validateReferences(
  actor: Actor,
  projectId: string,
  requirements: RequirementInput[],
) {
  for (const ref of requirements) {
    const item = await getWorkItem(actor, ref.workItemId);
    if (item.projectId !== projectId || item.type !== "REQUIREMENT")
      throw forbidden();
    await getRequirementRevision(actor, item.id, ref.revisionId);
  }
}
async function appendCaseRevision(
  actor: Actor,
  id: string,
  revisionNo: number,
  input: {
    title: string;
    preconditions: string;
    steps: TestStep[];
    requirements: RequirementInput[];
  },
) {
  const [revision] = await db
    .insert(testCaseRevision)
    .values({
      caseId: id,
      revisionNo,
      title: input.title,
      preconditions: input.preconditions,
      steps: input.steps,
      createdBy: actor.memberId,
    })
    .returning();
  if (input.requirements.length)
    await db
      .insert(testCaseRequirement)
      .values(
        input.requirements.map((ref) => ({
          caseRevisionId: revision!.id,
          workItemId: ref.workItemId,
          requirementRevisionId: ref.revisionId,
        })),
      );
  return revision!;
}
export async function getTestCaseRevision(
  actor: Actor,
  projectId: string,
  caseId: string,
  revisionId: string,
): Promise<TestCaseRevision> {
  await readTestProject(actor, projectId);
  await findCase(projectId, caseId);
  const [value] = await db
    .select({ revision: testCaseRevision, authorName: member.name })
    .from(testCaseRevision)
    .leftJoin(member, eq(member.id, testCaseRevision.createdBy))
    .where(
      and(
        eq(testCaseRevision.id, revisionId),
        eq(testCaseRevision.caseId, caseId),
      ),
    );
  if (!value) throw forbidden();
  const requirements = await db
    .select({
      workItemId: testCaseRequirement.workItemId,
      revisionId: testCaseRequirement.requirementRevisionId,
      key: workItem.key,
      title: requirementRevision.title,
      revisionNo: requirementRevision.revisionNo,
    })
    .from(testCaseRequirement)
    .innerJoin(workItem, eq(workItem.id, testCaseRequirement.workItemId))
    .innerJoin(
      requirementRevision,
      eq(requirementRevision.id, testCaseRequirement.requirementRevisionId),
    )
    .where(eq(testCaseRequirement.caseRevisionId, revisionId))
    .orderBy(workItem.key);
  return {
    ...value.revision,
    createdAt: value.revision.createdAt.toISOString(),
    requirements,
    authorName: value.authorName,
  };
}
export async function listTestCaseRevisions(
  actor: Actor,
  projectId: string,
  caseId: string,
  raw: unknown = {},
): Promise<{
  items: Array<{
    id: string;
    revisionNo: number;
    title: string;
    createdAt: string;
  }>;
  nextCursor: number | null;
}> {
  const input = parseTesting(
    testCaseListSchema.pick({ limit: true, before: true }),
    raw,
  );
  await readTestProject(actor, projectId);
  await findCase(projectId, caseId);
  const rows = await db
    .select({
      id: testCaseRevision.id,
      revisionNo: testCaseRevision.revisionNo,
      title: testCaseRevision.title,
      createdAt: testCaseRevision.createdAt,
    })
    .from(testCaseRevision)
    .where(
      and(
        eq(testCaseRevision.caseId, caseId),
        input.before
          ? lt(testCaseRevision.revisionNo, input.before)
          : undefined,
      ),
    )
    .orderBy(desc(testCaseRevision.revisionNo))
    .limit(input.limit + 1);
  return {
    items: rows
      .slice(0, input.limit)
      .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    nextCursor:
      rows.length > input.limit ? rows[input.limit - 1]!.revisionNo : null,
  };
}
async function summary(
  actor: Actor,
  projectId: string,
  row: typeof testCase.$inferSelect,
): Promise<TestCaseSummary> {
  if (!row.currentRevisionId)
    throw new DomainError("INTERNAL", "用例缺少正文版本", null);
  const project = await readTestProject(actor, projectId);
  const [revision] = await db
    .select({ revisionNo: testCaseRevision.revisionNo })
    .from(testCaseRevision)
    .where(eq(testCaseRevision.id, row.currentRevisionId));
  if (!revision) throw new DomainError("INTERNAL", "用例正文版本不存在", null);
  const [owner] = row.ownerId
    ? await db
        .select({ name: member.name })
        .from(member)
        .where(eq(member.id, row.ownerId))
    : [];
  const suite = row.suiteId ? await findSuite(projectId, row.suiteId) : null;
  return {
    id: row.id,
    projectId,
    number: row.number,
    key: `${project.key}-TC-${row.number}`,
    title: row.title,
    status: row.status,
    priority: row.priority,
    version: row.version,
    currentRevisionId: row.currentRevisionId,
    revisionNo: revision.revisionNo,
    suiteId: row.suiteId,
    suiteName: suite?.name ?? null,
    ownerId: row.ownerId,
    ownerName: owner?.name ?? null,
    updatedAt: row.updatedAt.toISOString(),
    canManage: await canWriteTesting(actor, projectId, "test_case:manage"),
  };
}
export async function getTestCase(
  actor: Actor,
  projectId: string,
  id: string,
): Promise<TestCaseDetail> {
  await readTestProject(actor, projectId);
  const row = await findCase(projectId, id);
  const info = await summary(actor, projectId, row);
  return {
    ...info,
    revision: await getTestCaseRevision(
      actor,
      projectId,
      id,
      info.currentRevisionId,
    ),
  };
}
export async function listTestCases(
  actor: Actor,
  projectId: string,
  raw: unknown = {},
): Promise<TestCasePage> {
  const input = parseTesting(testCaseListSchema, raw);
  await readTestProject(actor, projectId);
  const rows = await db
    .select()
    .from(testCase)
    .where(
      and(
        eq(testCase.projectId, projectId),
        input.status
          ? eq(testCase.status, input.status)
          : ne(testCase.status, "ARCHIVED"),
        input.suiteId ? eq(testCase.suiteId, input.suiteId) : undefined,
        input.before ? lt(testCase.number, input.before) : undefined,
        input.search
          ? ilike(
              testCase.title,
              `%${input.search.replace(/[\\%_]/gu, "\\$&")}%`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(testCase.number))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit),
    project = await readTestProject(actor, projectId),
    canManage = await canWriteTesting(actor, projectId, "test_case:manage");
  const joined = page.length
    ? await db
        .select({
          id: testCase.id,
          revisionNo: testCaseRevision.revisionNo,
          ownerName: member.name,
          suiteName: testSuite.name,
        })
        .from(testCase)
        .innerJoin(
          testCaseRevision,
          eq(testCaseRevision.id, testCase.currentRevisionId),
        )
        .leftJoin(member, eq(member.id, testCase.ownerId))
        .leftJoin(testSuite, eq(testSuite.id, testCase.suiteId))
        .where(
          inArray(
            testCase.id,
            page.map((row) => row.id),
          ),
        )
    : [];
  const metadata = new Map(joined.map((row) => [row.id, row]));
  const items = page.map((row) => {
    const info = metadata.get(row.id);
    if (!row.currentRevisionId || !info)
      throw new DomainError("INTERNAL", "用例缺少正文版本", null);
    return {
      id: row.id,
      projectId,
      number: row.number,
      key: project.key + "-TC-" + row.number,
      title: row.title,
      status: row.status,
      priority: row.priority,
      version: row.version,
      currentRevisionId: row.currentRevisionId,
      revisionNo: info.revisionNo,
      suiteId: row.suiteId,
      suiteName: info.suiteName,
      ownerId: row.ownerId,
      ownerName: info.ownerName,
      updatedAt: row.updatedAt.toISOString(),
      canManage,
    };
  });
  return {
    items,
    nextCursor:
      rows.length > input.limit ? rows[input.limit - 1]!.number : null,
    canManage,
  };
}
export async function createTestCase(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<TestCaseDetail> {
  const input = parseTesting(createTestCaseSchema, raw);
  return withTestWrite(actor, projectId, "test_case:manage", async () => {
    if (input.status === "READY" && !input.steps.length)
      throw new DomainError("VALIDATION", "就绪用例至少需要一个完整步骤", null);
    if (input.suiteId && (await findSuite(projectId, input.suiteId)).archivedAt)
      throw blocked("套件已归档");
    const ownerId =
      input.ownerId === undefined ? actor.memberId : input.ownerId;
    await validateOwner(projectId, ownerId);
    await validateReferences(actor, projectId, input.requirements);
    const [last] = await db
      .select({ number: testCase.number })
      .from(testCase)
      .where(eq(testCase.projectId, projectId))
      .orderBy(desc(testCase.number))
      .limit(1);
    const [row] = await db
      .insert(testCase)
      .values({
        projectId,
        number: (last?.number ?? 0) + 1,
        title: input.title,
        status: input.status,
        priority: input.priority,
        suiteId: input.suiteId,
        ownerId,
        createdBy: actor.memberId,
      })
      .returning();
    const revision = await appendCaseRevision(actor, row!.id, 1, input);
    await db
      .update(testCase)
      .set({ currentRevisionId: revision.id })
      .where(eq(testCase.id, row!.id));
    await event(actor, projectId, row!.id, "TEST_CASE", "created");
    return getTestCase(actor, projectId, row!.id);
  });
}
export async function updateTestCase(
  actor: Actor,
  projectId: string,
  id: string,
  raw: unknown,
): Promise<TestCaseDetail> {
  const input = parseTesting(updateTestCaseSchema, raw);
  return withTestWrite(actor, projectId, "test_case:manage", async () => {
    const row = await findCase(projectId, id);
    testVersion(row.version, input.expectedVersion);
    if (
      row.status === "ARCHIVED" &&
      (!input.status || input.status === "ARCHIVED")
    )
      throw blocked("请先恢复归档用例");
    const current = await getTestCase(actor, projectId, id),
      status = input.status ?? row.status,
      suiteId = input.suiteId === undefined ? row.suiteId : input.suiteId;
    if (
      suiteId &&
      (status !== "ARCHIVED" || suiteId !== row.suiteId) &&
      (await findSuite(projectId, suiteId)).archivedAt
    )
      throw blocked("套件已归档，请先恢复套件或移动用例");
    const ownerId = input.ownerId === undefined ? row.ownerId : input.ownerId;
    if (input.ownerId !== undefined) await validateOwner(projectId, ownerId);
    const content = {
      title: input.title ?? row.title,
      preconditions: input.preconditions ?? current.revision.preconditions,
      steps: input.steps ?? current.revision.steps,
      requirements:
        input.requirements ??
        current.revision.requirements.map((r) => ({
          workItemId: r.workItemId,
          revisionId: r.revisionId,
        })),
    };
    if (status === "READY" && !content.steps.length)
      throw new DomainError("VALIDATION", "就绪用例至少需要一个完整步骤", null);
    if (input.requirements)
      await validateReferences(actor, projectId, input.requirements);
    const canonical = (refs: RequirementInput[]) =>
      JSON.stringify(
        [...refs]
          .sort((a, b) => a.workItemId.localeCompare(b.workItemId))
          .map((r) => ({ workItemId: r.workItemId, revisionId: r.revisionId })),
      );
    const changed =
      content.title !== current.revision.title ||
      content.preconditions !== current.revision.preconditions ||
      JSON.stringify(content.steps) !==
        JSON.stringify(current.revision.steps) ||
      canonical(content.requirements) !==
        canonical(current.revision.requirements);
    const revision = changed
      ? await appendCaseRevision(
          actor,
          id,
          current.revision.revisionNo + 1,
          content,
        )
      : current.revision;
    await db
      .update(testCase)
      .set({
        title: content.title,
        status,
        suiteId,
        ownerId,
        priority: input.priority ?? row.priority,
        currentRevisionId: revision.id,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(testCase.id, id));
    await event(actor, projectId, id, "TEST_CASE", "updated");
    return getTestCase(actor, projectId, id);
  });
}
