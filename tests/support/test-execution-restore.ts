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
const library = await import("../../src/server/services/test-case.service.ts"),
  execution = await import("../../src/server/services/test-run.service.ts");
const rows: Record<string, Record<string, unknown>[]> = {},
  rollback = new Error("fixture rollback");
const features = [
  "persistent-collaboration-and-conversations",
  "requirement-history",
  "document-folders",
  "product-attribution",
  "requirement-changes",
  "test-case-library",
];
const datasets = [
  "projects.test_plan",
  "projects.test_plan_case",
  "projects.test_run",
  "projects.test_run_defect", "projects.release_candidate", "projects.release_verification", "projects.release_feedback",
];
try {
  await assert.rejects(
    inTransaction(async () => {
      await db.insert(organization).values({ name: "执行恢复" });
      const [admin] = await db
        .insert(member)
        .values({
          username: "restore-execution",
          name: "执行恢复",
          status: "ACTIVE",
          passwordHash: await hashPassword("fixture-only-password"),
        })
        .returning();
      const [r] = await db.select().from(role).where(eq(role.key, "ADMIN"));
      await db.insert(roleAssignment).values({
        memberId: admin!.id,
        roleId: r!.id,
        scopeType: "ORG",
        scopeId: null,
      });
      const actor = (await loadActor(admin!.id))!;
      const p = await createProject(actor, {
        key: "RESTORER",
        name: "执行恢复",
      });
      const c = await library.createTestCase(actor, p.id, {
        title: "验收",
        status: "READY",
        steps: [{ action: "操作", expected: "成功" }],
      });
      let plan = await execution.createTestPlan(actor, p.id, {
        title: "固定构建",
        build: "restore-build",
        environment: "isolated",
        cases: [{ caseId: c.id, revisionId: c.currentRevisionId }],
      });
      plan = await execution.transitionTestPlan(actor, p.id, plan.id, {
        action: "START",
        expectedVersion: plan.version,
      });
      let run = await execution.startTestRun(actor, p.id, plan.id, {
        planCaseId: plan.cases[0]!.id,
        source: "AUTOMATION",
        sourceReference: "restore-fixture",
      });
      run = await execution.recordTestRun(actor, p.id, run.id, {
        expectedVersion: run.version,
        results: [{ stepIndex: 0, status: "FAILED", actual: "失败" }],
      });
      run = await execution.completeTestRun(actor, p.id, run.id, {
        expectedVersion: run.version,
      });
      await execution.createTestRunDefect(actor, p.id, run.id, {
        title: "恢复fixture缺陷",
      });
      let retest = await execution.startTestRun(actor, p.id, plan.id, {
        planCaseId: plan.cases[0]!.id,
        retestOf: run.id,
        build: "fixed-build",
        environment: "local-fixed",
      });
      retest = await execution.recordTestRun(actor, p.id, retest.id, {
        expectedVersion: retest.version,
        results: [{ stepIndex: 0, status: "PASSED", actual: "复测通过" }],
      });
      await execution.completeTestRun(actor, p.id, retest.id, {
        expectedVersion: retest.version,
      });
      assert.equal(
        (await execution.getTestPlanReport(actor, p.id, plan.id)).passed,
        false,
        "完成计划前不能标记报告通过",
      );
      await execution.transitionTestPlan(actor, p.id, plan.id, {
        action: "COMPLETE",
        expectedVersion: plan.version,
      });
      assert.equal(
        (await execution.getTestPlanReport(actor, p.id, plan.id)).passed,
        true,
      );
      for (const d of orderedDatasets("safe"))
        rows[d.name] = (await sql`select * from ${sql(d.tableName)}`)
          .map((row) =>
            d.encodeRow(row, { mode: "safe", purpose: "migration" }),
          )
          .filter((r): r is Record<string, unknown> => r !== null);
      assert.equal(rows["projects.test_run"]!.length, 2);
      throw rollback;
    }),
    (e) => e === rollback,
  );
  for (const legacy of [false, true]) {
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: rows,
      omitDatasets: legacy ? datasets : [],
      manifest: {
        requiredFeatures: [...features, ...(legacy ? [] : ["test-execution", "test-execution-builds"])],
      },
    });
    await assert.rejects(
      inTransaction(async () => {
        await importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        );
        const runs =
          await sql`select status,retest_of from test_run order by attempt`;
        assert.equal(runs.length, legacy ? 0 : 2);
        if (!legacy) {
          assert.equal(runs[0]!.status, "FAILED");
          assert.equal(runs[1]!.status, "PASSED");
          assert.ok(runs[1]!.retest_of);
          assert.equal(
            (await sql`select status from test_plan`)[0]!.status,
            "COMPLETED",
          );
        }
        throw rollback;
      }),
      (e) => e === rollback,
    );
  }
  const oldRows=structuredClone(rows);for(const r of oldRows["projects.test_run"]!){delete r.build;delete r.environment;}
  const oldFixture=await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!,{datasetRows:oldRows,manifest:{requiredFeatures:[...features,"test-execution"]}});
  await assert.rejects(inTransaction(async()=>{await importDatasets(oldFixture.innerPath,manifestSchema.parse(oldFixture.manifest));const saved=await sql`select build,environment from test_run`;assert.equal(saved.length,2);assert.equal(saved.every(r=>r.build==="restore-build"&&r.environment==="isolated"),true);throw rollback;}),e=>e===rollback);
  for (const damage of [
    "cycle",
    "cross-project",
    "result",
    "missing-step",
    "defect",
    "source",
    "scope",
  ]) {
    const broken = structuredClone(rows),
      runs = broken["projects.test_run"]!.sort(
        (a, b) => Number(a.attempt) - Number(b.attempt),
      );
    if (damage === "cycle") runs[1]!.retest_of = runs[1]!.id;
    if (damage === "cross-project") runs[1]!.project_id = crypto.randomUUID();
    if (damage === "result") runs[1]!.status = "FAILED";
    if (damage === "missing-step") runs[1]!.results = [];
    if (damage === "defect")
      broken["projects.test_run_defect"]![0]!.run_id = runs[1]!.id;
    if (damage === "source") runs[0]!.source_reference = null;
    if (damage === "scope") broken["projects.test_plan_case"]![0]!.position = 3;
    const fixture = await backupFixture(process.env.FERONAVI_TEST_DIRECTORY!, {
      datasetRows: broken,
      manifest: { requiredFeatures: [...features, "test-execution", "test-execution-builds"] },
    });
    await assert.rejects(
      inTransaction(() =>
        importDatasets(
          fixture.innerPath,
          manifestSchema.parse(fixture.manifest),
        ),
      ),
      undefined,
      damage,
    );
    assert.equal(
      (await sql`select count(*)::int n from test_run`)[0]!.n,
      0,
      "损坏恢复必须整体回滚",
    );
  }
  console.log("test execution restore passed");
} finally {
  await sql.end({ timeout: 5 });
}
