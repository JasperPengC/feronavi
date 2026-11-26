import assert from "node:assert/strict";
import { backupFixture } from "./system-backup-fixture.ts";
import { manifestSchema } from "../../src/shared/schemas/system-backup.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";
import { importDatasets } from "../../src/server/services/system-backup/import-data.ts";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
const { db, sql, inTransaction } = await import("../../src/db/index.ts");
const { organization, member, role, roleAssignment } =
  await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { hashPassword } = await import("../../src/server/auth/password.ts");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
await (
  await import("../../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { createProject } =
  await import("../../src/server/services/project.service.ts");
const library = await import("../../src/server/services/test-case.service.ts");
const revisions =
  await import("../../src/server/services/requirement-revision.service.ts");
const { createWorkItem } =
  await import("../../src/server/services/work-item.service.ts");
const rows: Record<string, Record<string, unknown>[]> = {};
const rollback = new Error("fixture rollback");
const features = [
  "persistent-collaboration-and-conversations",
  "requirement-history",
  "document-folders",
  "product-attribution",
  "requirement-changes",
];
const datasets = [
  "projects.test_suite",
  "projects.test_case",
  "projects.test_case_revision",
  "projects.test_case_requirement", "projects.test_plan", "projects.test_plan_case", "projects.test_run", "projects.test_run_defect", "projects.release_candidate", "projects.release_verification", "projects.release_feedback",
];
try {
  await assert.rejects(
    inTransaction(async () => {
      await db.insert(organization).values({ name: "用例恢复" });
      const [admin] = await db
        .insert(member)
        .values({
          username: "restore-cases",
          name: "用例验收",
          status: "ACTIVE",
          passwordHash: await hashPassword("fixture-only-password"),
        })
        .returning();
      const [adminRole] = await db
        .select()
        .from(role)
        .where(eq(role.key, "ADMIN"));
      await db
        .insert(roleAssignment)
        .values({
          memberId: admin!.id,
          roleId: adminRole!.id,
          scopeType: "ORG",
          scopeId: null,
        });
      const actor = (await loadActor(admin!.id))!;
      const project = await createProject(actor, {
        key: "RESTORET",
        name: "用例备份",
      });
      const req = (await createWorkItem(actor, project.id, {
        type: "REQUIREMENT",
        title: "原需求",
        description: "原正文",
      }))!;
      const baseline = (await revisions.listRequirementRevisions(actor, req.id))
        .items[0]!;
      const suite = await library.createTestSuite(actor, project.id, {
        name: "验收套件",
      });
      const item = await library.createTestCase(actor, project.id, {
        title: "登录",
        status: "READY",
        suiteId: suite.id,
        steps: [{ action: "登录", expected: "成功" }],
        requirements: [{ workItemId: req.id, revisionId: baseline.id }],
      });
      await library.updateTestCase(actor, project.id, item.id, {
        expectedVersion: item.version,
        title: "完整登录",
        steps: [
          { action: "登录", expected: "成功" },
          { action: "退出", expected: "会话结束" },
        ],
      });
      for (const dataset of orderedDatasets("safe"))
        rows[dataset.name] = (
          await sql`select * from ${sql(dataset.tableName)}`
        )
          .map((row) =>
            dataset.encodeRow(row, { mode: "safe", purpose: "migration" }),
          )
          .filter((row): row is Record<string, unknown> => row !== null);
      assert.equal(rows["projects.test_case"]?.length, 1, "用例必须登记进备份");
      throw rollback;
    }),
    (e) => e === rollback,
  );
  for (const legacy of [false, true]) {
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: rows,
      omitDatasets: legacy ? datasets : [],
      manifest: {
        requiredFeatures: [
          ...features,
          ...(legacy ? [] : ["test-case-library"]),
        ],
      },
    });
    await assert.rejects(
      inTransaction(async () => {
        await importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        );
        const restored =
          await sql`select c.title,r.revision_no,r.steps from test_case c join test_case_revision r on r.id=c.current_revision_id`;
        assert.equal(restored.length, legacy ? 0 : 1);
        if (!legacy) {
          assert.equal(restored[0]!.title, "完整登录");
          assert.equal(restored[0]!.revision_no, 2);
          assert.equal(restored[0]!.steps.length, 2);
          assert.equal(
            (await sql`select count(*)::int n from test_case_requirement`)[0]!
              .n,
            2,
          );
        }
        throw rollback;
      }),
      (e) => e === rollback,
    );
  }
  for (const damage of [
    "current-title",
    "empty-ready",
    "steps",
    "revision-sequence",
    "suite-project",
  ]) {
    const broken = structuredClone(rows),
      item = broken["projects.test_case"]![0]!,
      latest = broken["projects.test_case_revision"]!.find(
        (r) => r.id === item.current_revision_id,
      )!;
    if (damage === "current-title") item.title = "篡改标题";
    if (damage === "empty-ready") latest.steps = [];
    if (damage === "steps") latest.steps = [{ action: "缺少预期" }];
    if (damage === "revision-sequence") latest.revision_no = 99;
    if (damage === "suite-project") {
      const p = {
        ...broken["projects.project"]![0]!,
        id: crypto.randomUUID(),
        key: "FOREIGN",
      };
      broken["projects.project"]!.push(p);
      broken["projects.test_suite"]![0]!.project_id = p.id;
    }
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: broken,
      manifest: { requiredFeatures: [...features, "test-case-library"] },
    });
    await assert.rejects(
      inTransaction(() =>
        importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        ),
      ),
      (e) => (e as { code?: string }).code === "INVALID_BACKUP",
      damage,
    );
  }
  console.log("test case library restore passed");
} finally {
  await sql.end({ timeout: 5 });
}
