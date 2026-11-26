import { z } from "zod";
import type { ToolDef } from "./tools.ts";
import {
  createTestCaseSchema,
  updateTestCaseSchema,
  createTestSuiteSchema,
  updateTestSuiteSchema,
  testCaseListSchema,
} from "../../../shared/schemas/test-management.ts";
import * as library from "../../services/test-case.service.ts";
import { assertWriteTesting } from "../../services/test-access.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";
const project = { projectId: z.uuid() },
  caseRef = { ...project, caseId: z.uuid() },
  suiteRef = { ...project, suiteId: z.uuid() },
  confirmed = { userConfirmed: z.literal(true) },
  idempotent = { idempotencyKey: z.string().min(1).max(200).optional() };
const tool = (
  name: string,
  kind: ToolDef["kind"],
  description: string,
  input: z.ZodType,
  handler: ToolDef["handler"],
): ToolDef => ({
  name,
  kind,
  description,
  inputSchema: z.toJSONSchema(input, {
    target: "draft-7",
    io: "input",
  }) as Record<string, unknown>,
  handler,
});
export const TEST_MANAGEMENT_TOOLS: ToolDef[] = [
  tool(
    "testSuite.list",
    "read",
    "读取项目测试套件、有效用例数及管理能力。归档套件需includeArchived=true。",
    z.object({ ...project, includeArchived: z.boolean().optional() }).strict(),
    (ctx, a) =>
      library.listTestSuites(
        ctx.actor,
        String(a.projectId),
        a.includeArchived === true,
      ),
  ),
  tool(
    "testSuite.get",
    "read",
    "读取同项目测试套件与当前version。",
    z.object(suiteRef).strict(),
    (ctx, a) =>
      library.getTestSuite(ctx.actor, String(a.projectId), String(a.suiteId)),
  ),
  tool(
    "testSuite.create",
    "write",
    "创建正式测试套件，支持幂等键；需test_case:manage，重放重新校验权限。",
    createTestSuiteSchema.extend({ ...project, ...confirmed, ...idempotent }),
    async (ctx, a) => {
      const {
        projectId,
        userConfirmed: _confirmed,
        idempotencyKey,
        ...input
      } = a;
      const id = String(projectId);
      await assertWriteTesting(ctx.actor, id, "test_case:manage");
      const result = await withIdempotency(
        {
          actorId: ctx.actor.memberId,
          key: idempotencyKey as string | undefined,
          scope: "testSuite.create",
          body: a,
        },
        () => library.createTestSuite(ctx.actor, id, input),
      );
      return library.getTestSuite(ctx.actor, id, result.value.id);
    },
  ),
  tool(
    "testSuite.update",
    "write",
    "修改或归档/恢复套件，需expectedVersion；有有效用例时不能归档。",
    updateTestSuiteSchema.safeExtend({ ...suiteRef, ...confirmed }),
    (ctx, a) => {
      const { projectId, suiteId, userConfirmed: _confirmed, ...input } = a;
      return library.updateTestSuite(
        ctx.actor,
        String(projectId),
        String(suiteId),
        input,
      );
    },
  ),
  tool(
    "testCase.list",
    "read",
    "分页读取正式用例；默认排除ARCHIVED，可按套件、状态和标题筛选。nextCursor用于before。",
    testCaseListSchema.extend(project),
    (ctx, a) => {
      const { projectId, ...query } = a;
      return library.listTestCases(ctx.actor, String(projectId), query);
    },
  ),
  tool(
    "testCase.get",
    "read",
    "读取用例当前version、固定revision、步骤/预期、套件、负责人及需求正文版本引用。",
    z.object(caseRef).strict(),
    (ctx, a) =>
      library.getTestCase(ctx.actor, String(a.projectId), String(a.caseId)),
  ),
  tool(
    "testCase.revisions",
    "read",
    "按版本倒序分页读取不可变用例历史。",
    testCaseListSchema.pick({ limit: true, before: true }).extend(caseRef),
    (ctx, a) => {
      const { projectId, caseId, ...query } = a;
      return library.listTestCaseRevisions(
        ctx.actor,
        String(projectId),
        String(caseId),
        query,
      );
    },
  ),
  tool(
    "testCase.getRevision",
    "read",
    "读取指定caseId/revisionId的历史步骤和需求基线，旧执行使用这个固定版本。",
    z.object({ ...caseRef, revisionId: z.uuid() }).strict(),
    (ctx, a) =>
      library.getTestCaseRevision(
        ctx.actor,
        String(a.projectId),
        String(a.caseId),
        String(a.revisionId),
      ),
  ),
  tool(
    "testCase.create",
    "write",
    "创建独立测试用例。步骤含action/expected；requirements为同项目workItemId+revisionId。READY至少一步；支持idempotencyKey。",
    createTestCaseSchema.extend({ ...project, ...confirmed, ...idempotent }),
    async (ctx, a) => {
      const {
        projectId,
        userConfirmed: _confirmed,
        idempotencyKey,
        ...input
      } = a;
      const id = String(projectId);
      await assertWriteTesting(ctx.actor, id, "test_case:manage");
      const result = await withIdempotency(
        {
          actorId: ctx.actor.memberId,
          key: idempotencyKey as string | undefined,
          scope: "testCase.create",
          body: a,
        },
        () => library.createTestCase(ctx.actor, id, input),
      );
      return library.getTestCase(ctx.actor, id, result.value.id);
    },
  ),
  tool(
    "testCase.update",
    "write",
    "更新用例，需expectedVersion。标题/前置/步骤/需求关联变化创建新revision；元数据只增加version。ARCHIVED保留历史，恢复须套件有效。",
    updateTestCaseSchema.safeExtend({ ...caseRef, ...confirmed }),
    (ctx, a) => {
      const { projectId, caseId, userConfirmed: _confirmed, ...input } = a;
      return library.updateTestCase(
        ctx.actor,
        String(projectId),
        String(caseId),
        input,
      );
    },
  ),
];
